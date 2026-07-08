/**
 * PCM audio utilities for the 3CX voice line.
 *
 * 3CX Call Control audio streams are raw PCM, 16-bit signed LE, 8000 Hz,
 * mono, in BOTH directions (per the 3CX Call Control API Endpoint
 * Specification for /callcontrol/{dn}/participants/{id}/stream:
 * "raw audio stream (PCM 16-bit 8000Hz mono)"). The server sends/expects
 * ~128 kbps (16,000 bytes/sec) with minimal jitter, so outbound playback
 * is paced by AudioPump instead of being written all at once.
 *
 * OpenAI tts-1 with response_format "pcm" returns 24 kHz 16-bit mono LE,
 * which is downsampled to 8 kHz here with a plain linear-interpolation
 * resampler (no native deps).
 */

export const STREAM_SAMPLE_RATE = 8000;
export const TTS_SAMPLE_RATE = 24_000;
export const BYTES_PER_SECOND = STREAM_SAMPLE_RATE * 2; // 16-bit mono

const PUMP_TICK_MS = 100;
const PUMP_BYTES_PER_TICK = (BYTES_PER_SECOND * PUMP_TICK_MS) / 1000; // 1600

/** Wrap raw 16-bit mono PCM in a WAV container (for the whisper upload). */
export function buildWav(pcm: Buffer, sampleRate = STREAM_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Linear-interpolation resampler for 16-bit mono PCM. Returns a NEW buffer. */
export function resamplePcm16(input: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate) return Buffer.from(input);
  const inSamples = Math.floor(input.length / 2);
  if (inSamples === 0) return Buffer.alloc(0);
  const outSamples = Math.max(1, Math.floor((inSamples * toRate) / fromRate));
  const out = Buffer.alloc(outSamples * 2);
  const ratio = (inSamples - 1) / Math.max(1, outSamples - 1);
  for (let i = 0; i < outSamples; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input.readInt16LE(idx * 2);
    const b = idx + 1 < inSamples ? input.readInt16LE((idx + 1) * 2) : a;
    out.writeInt16LE(Math.round(a + (b - a) * frac), i * 2);
  }
  return out;
}

/**
 * OpenAI tts-1 → 8 kHz PCM ready to stream to 3CX.
 * Returns null when synthesis FAILED (logged) — never throws.
 */
export async function synthesizeSpeechPcm8k(text: string): Promise<Buffer | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[VOICE] OPENAI_API_KEY not set — cannot synthesize speech");
    return null;
  }
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: "nova",
        input: text,
        response_format: "pcm", // 24kHz 16-bit mono LE
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`[VOICE] TTS failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const pcm24k = Buffer.from(await res.arrayBuffer());
    return resamplePcm16(pcm24k, TTS_SAMPLE_RATE, STREAM_SAMPLE_RATE);
  } catch (error) {
    console.error("[VOICE] TTS request failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Short 1 kHz record-now beep (8 kHz PCM). */
export function generateBeep(durationMs = 400, freqHz = 1000): Buffer {
  const samples = Math.floor((STREAM_SAMPLE_RATE * durationMs) / 1000);
  const out = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const v = Math.sin((2 * Math.PI * freqHz * i) / STREAM_SAMPLE_RATE) * 0.35 * 32767;
    out.writeInt16LE(Math.round(v), i * 2);
  }
  return out;
}

/**
 * Paces outbound PCM at real-time rate (3CX wants ~128 kbps, low jitter)
 * and supports barge-in: stop() drops everything not yet sent.
 */
export class AudioPump {
  private queue: Buffer = Buffer.alloc(0);
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(private readonly write: (chunk: Buffer) => void) {}

  enqueue(pcm: Buffer): void {
    if (this.closed || pcm.length === 0) return;
    this.queue = Buffer.concat([this.queue, pcm]);
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), PUMP_TICK_MS);
      this.timer.unref?.();
    }
  }

  /** Barge-in: discard all queued (unsent) audio immediately. */
  stop(): void {
    this.queue = Buffer.alloc(0);
  }

  close(): void {
    this.closed = true;
    this.stop();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (this.queue.length === 0) {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      return;
    }
    const chunk = this.queue.subarray(0, PUMP_BYTES_PER_TICK);
    this.queue = this.queue.subarray(chunk.length);
    try {
      this.write(Buffer.from(chunk));
    } catch (error) {
      console.error("[VOICE] Audio write failed:", error instanceof Error ? error.message : error);
      this.close();
    }
  }
}
