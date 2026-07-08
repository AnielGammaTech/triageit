/**
 * G.711 μ-law codec (8 kHz telephony audio).
 *
 * The OpenAI Realtime API speaks `audio/pcmu` (μ-law @ 8 kHz) natively and
 * 3CX call-control streams are PCM 16-bit 8 kHz mono — same sample rate, so
 * bridging the two is a pure per-sample companding transform with no
 * resampling. Standard ITU-T G.711 tables/algorithm.
 */

const BIAS = 0x84;
const CLIP = 32_635;

const SEG_END = [0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff, 0x1fff, 0x3fff, 0x7fff];

function linearToUlawSample(sample: number): number {
  let pcm = sample;
  const sign = pcm < 0 ? 0x80 : 0;
  if (pcm < 0) pcm = -pcm;
  if (pcm > CLIP) pcm = CLIP;
  pcm += BIAS;

  let segment = 7;
  for (let i = 0; i < 8; i++) {
    if (pcm <= SEG_END[i]) {
      segment = i;
      break;
    }
  }

  const mantissa = (pcm >> (segment + 3)) & 0x0f;
  return ~(sign | (segment << 4) | mantissa) & 0xff;
}

function ulawToLinearSample(ulaw: number): number {
  const u = ~ulaw & 0xff;
  const sign = u & 0x80;
  const segment = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let pcm = ((mantissa << 3) + BIAS) << segment;
  pcm -= BIAS;
  return sign ? -pcm : pcm;
}

/** 16-bit LE mono PCM → μ-law bytes (1 byte per sample). Returns a NEW buffer. */
export function pcm16ToUlaw(pcm: Buffer): Buffer {
  const samples = Math.floor(pcm.length / 2);
  const out = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = linearToUlawSample(pcm.readInt16LE(i * 2));
  }
  return out;
}

/** μ-law bytes → 16-bit LE mono PCM. Returns a NEW buffer. */
export function ulawToPcm16(ulaw: Buffer): Buffer {
  const out = Buffer.alloc(ulaw.length * 2);
  for (let i = 0; i < ulaw.length; i++) {
    out.writeInt16LE(ulawToLinearSample(ulaw[i]), i * 2);
  }
  return out;
}
