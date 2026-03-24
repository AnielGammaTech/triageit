"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils/cn";

interface MessageMeta {
  readonly model?: string;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cost_usd?: number;
}

interface Message {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly created_at?: string;
  readonly meta?: MessageMeta;
}

interface Conversation {
  readonly id: string;
  readonly title: string;
  readonly updated_at: string;
}

interface LearnedSkill {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly is_active: boolean;
  readonly created_at: string;
}

interface TicketContext {
  readonly halo_id?: number;
  readonly summary?: string;
  readonly client_name?: string;
  readonly details?: string;
  readonly triage?: string;
}

interface MichaelChatProps {
  readonly ticketContext?: TicketContext;
}

export function MichaelChat({ ticketContext }: MichaelChatProps) {
  const [conversations, setConversations] = useState<ReadonlyArray<Conversation>>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ReadonlyArray<Message>>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [statusText, setStatusText] = useState("");
  const [activityLog, setActivityLog] = useState<ReadonlyArray<string>>([]);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showSkills, setShowSkills] = useState(false);
  const [skills, setSkills] = useState<ReadonlyArray<LearnedSkill>>([]);
  const [sessionCost, setSessionCost] = useState(0);
  const [sessionTokens, setSessionTokens] = useState(0);
  const [agentAvatar, setAgentAvatar] = useState<string>("/prison-mike.png");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, streamingText, scrollToBottom]);

  // Load conversations
  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/michael/conversations");
    if (res.ok) {
      const data = await res.json();
      setConversations(data.conversations);
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Load agent avatar from branding config
  useEffect(() => {
    async function loadAvatar() {
      try {
        const res = await fetch("/api/branding");
        if (res.ok) {
          const data = await res.json();
          if (data.branding?.agent_avatar_url) {
            setAgentAvatar(data.branding.agent_avatar_url);
          }
        }
      } catch { /* fallback to default */ }
    }
    loadAvatar();
  }, []);

  // Load messages for a conversation
  const loadMessages = useCallback(async (convId: string) => {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { data } = await supabase
      .from("michael_messages")
      .select("id, role, content, created_at, metadata")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });

    const loaded = (data ?? []).map((m) => {
      const meta = m.metadata as MessageMeta | null;
      return {
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        created_at: m.created_at,
        meta: meta?.model ? meta : undefined,
      };
    });
    setMessages(loaded);

    // Calculate session cost from loaded messages
    let totalCost = 0;
    let totalTokens = 0;
    for (const m of loaded) {
      if (m.meta?.cost_usd) totalCost += m.meta.cost_usd;
      if (m.meta?.input_tokens) totalTokens += m.meta.input_tokens;
      if (m.meta?.output_tokens) totalTokens += m.meta.output_tokens;
    }
    setSessionCost(totalCost);
    setSessionTokens(totalTokens);
  }, []);

  // Load skills
  const loadSkills = useCallback(async () => {
    const res = await fetch("/api/michael/skills");
    if (res.ok) {
      const data = await res.json();
      setSkills(data.skills);
    }
  }, []);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const selectConversation = useCallback((convId: string) => {
    setActiveConversationId(convId);
    loadMessages(convId);
  }, [loadMessages]);

  const startNewConversation = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    setInput("");
    setSessionCost(0);
    setSessionTokens(0);
    inputRef.current?.focus();
  }, []);

  const deleteConversation = useCallback(async (convId: string) => {
    await fetch(`/api/michael/conversations?id=${convId}`, { method: "DELETE" });
    if (activeConversationId === convId) {
      startNewConversation();
    }
    loadConversations();
  }, [activeConversationId, startNewConversation, loadConversations]);

  const deleteSkill = useCallback(async (skillId: string) => {
    await fetch(`/api/michael/skills?id=${skillId}`, { method: "DELETE" });
    loadSkills();
  }, [loadSkills]);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setStreaming(true);
    setStreamingText("");
    setStatusText("");
    setActivityLog([]);

    let fullText = "";

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const res = await fetch("/api/michael/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: activeConversationId,
          message: trimmed,
          ticket_context: ticketContext,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

        for (const line of lines) {
          const json = JSON.parse(line.slice(6));

          if (json.text) {
            fullText += json.text;
            setStreamingText(fullText);
            setStatusText("");
          }

          if (json.status) {
            setStatusText(json.status);
            setActivityLog((prev) => [
              ...prev,
              JSON.stringify({ text: json.status, worker: json.worker, phase: json.phase }),
            ]);
          }

          if (json.done) {
            if (json.conversation_id && !activeConversationId) {
              setActiveConversationId(json.conversation_id);
            }

            const meta: MessageMeta | undefined = json.model ? {
              model: json.model,
              input_tokens: json.usage?.input_tokens,
              output_tokens: json.usage?.output_tokens,
              cost_usd: json.usage?.cost_usd,
            } : undefined;

            // Accumulate session cost
            if (meta?.cost_usd) setSessionCost((prev) => prev + meta.cost_usd!);
            if (meta?.input_tokens || meta?.output_tokens) {
              setSessionTokens((prev) => prev + (meta.input_tokens ?? 0) + (meta.output_tokens ?? 0));
            }

            setMessages((prev) => [
              ...prev,
              {
                id: `assistant-${Date.now()}`,
                role: "assistant",
                content: fullText,
                meta,
              },
            ]);
            setStreamingText("");
            loadConversations();

            // Check if a skill was learned
            if (fullText.includes("[SKILL_LEARNED:")) {
              loadSkills();
            }
          }

          if (json.error) {
            console.error("Stream error:", json.error);
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled — save partial text as a message if any
        if (fullText) {
          setMessages((prev) => [
            ...prev,
            {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: fullText + "\n\n*[Stopped]*",
            },
          ]);
        }
        setStreamingText("");
      } else {
        console.error("Chat error:", err);
      }
    } finally {
      abortControllerRef.current = null;
      setStreaming(false);
    }
  }, [input, streaming, activeConversationId, ticketContext, loadConversations, loadSkills]);

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Conversation sidebar */}
      {showSidebar && (
        <div className="w-64 shrink-0 border-r border-white/[0.06] bg-white/[0.02] flex flex-col">
          <div className="flex items-center justify-between p-3 border-b border-white/[0.06]">
            <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">History</span>
            <button
              onClick={startNewConversation}
              className="rounded-md p-1 text-white/40 hover:text-white hover:bg-white/5 transition-colors"
              title="New conversation"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  "group flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors",
                  activeConversationId === conv.id
                    ? "bg-white/[0.08] text-white"
                    : "text-white/60 hover:text-white hover:bg-white/[0.04]",
                )}
                onClick={() => selectConversation(conv.id)}
              >
                <span className="flex-1 truncate text-sm">{conv.title}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                  className="hidden group-hover:block shrink-0 rounded p-0.5 text-white/30 hover:text-red-400 transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}

            {conversations.length === 0 && (
              <p className="px-3 py-4 text-xs text-white/30 text-center">No conversations yet</p>
            )}
          </div>

          {/* Skills section */}
          <div className="border-t border-white/[0.06]">
            <button
              onClick={() => setShowSkills((prev) => !prev)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-xs font-semibold text-white/50 uppercase tracking-wider hover:bg-white/[0.04] transition-colors"
            >
              <span>Learned Skills ({skills.filter((s) => s.is_active).length})</span>
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={cn("transition-transform", showSkills && "rotate-180")}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {showSkills && (
              <div className="max-h-40 overflow-y-auto border-t border-white/[0.04]">
                {skills.filter((s) => s.is_active).map((skill) => (
                  <div key={skill.id} className="group flex items-start gap-2 px-3 py-2 text-xs text-white/50">
                    <span className="flex-1">{skill.title}</span>
                    <button
                      onClick={() => deleteSkill(skill.id)}
                      className="hidden group-hover:block shrink-0 text-red-400/60 hover:text-red-400"
                      title="Remove skill"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
                {skills.filter((s) => s.is_active).length === 0 && (
                  <p className="px-3 py-2 text-xs text-white/20">Teach Prison Mike by saying &quot;remember this&quot; or &quot;from now on...&quot;</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Chat header */}
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
          <button
            onClick={() => setShowSidebar((prev) => !prev)}
            className="rounded-md p-1 text-white/40 hover:text-white hover:bg-white/5 transition-colors lg:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <img src={agentAvatar} alt="Prison Mike" className="h-8 w-8 rounded-full object-cover" />
          <div>
            <h2 className="text-sm font-semibold text-white">Prison Mike</h2>
            <p className="text-[11px] text-white/40">The Worst Thing About Prison — AI Triage</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {sessionTokens > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-1.5">
                <span className="text-[11px] text-white/30">{sessionTokens.toLocaleString()} tokens</span>
                <span className="text-[11px] text-white/20">·</span>
                <span className="text-[11px] font-medium text-amber-400/70">
                  ${sessionCost < 0.01 ? sessionCost.toFixed(4) : sessionCost.toFixed(2)}
                </span>
              </div>
            )}
            {ticketContext?.halo_id && (
              <span className="rounded-md bg-white/[0.06] px-2 py-1 text-xs text-white/50">
                Ticket #{ticketContext.halo_id}
              </span>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <img src={agentAvatar} alt="Prison Mike" className="h-16 w-16 rounded-full object-cover mb-4" />
              <h3 className="text-lg font-semibold text-white/80 mb-1">Talk to Prison Mike</h3>
              <p className="text-sm text-white/40 max-w-md">
                Ask about tickets, discuss triage decisions, teach him new skills, or get his take on client patterns.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {[
                  "What's the status on ticket #33722?",
                  "Which techs are falling behind on response times?",
                  "From now on, always flag tickets from NABOR as high priority",
                  "What patterns are you seeing this week?",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors text-left"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={cn("flex gap-3", msg.role === "user" && "justify-end")}>
              {msg.role === "assistant" && (
                <img src={agentAvatar} alt="Prison Mike" className="h-7 w-7 shrink-0 rounded-full object-cover mt-0.5" />
              )}
              <div className="max-w-[75%]">
                <div
                  className={cn(
                    "rounded-xl px-4 py-2.5 text-sm leading-relaxed",
                    msg.role === "user"
                      ? "bg-[#b91c1c] text-white"
                      : "bg-white/[0.06] text-white/90",
                  )}
                >
                  <MessageContent content={msg.content} />
                </div>
                {msg.role === "assistant" && msg.meta && (
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-white/25 px-1">
                    <span>{formatModelName(msg.meta.model)}</span>
                    {msg.meta.input_tokens != null && msg.meta.output_tokens != null && (
                      <span>· {(msg.meta.input_tokens + msg.meta.output_tokens).toLocaleString()} tokens</span>
                    )}
                    {msg.meta.cost_usd != null && (
                      <span>· ${msg.meta.cost_usd < 0.01 ? msg.meta.cost_usd.toFixed(4) : msg.meta.cost_usd.toFixed(2)}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {streaming && streamingText && (
            <div className="flex gap-3">
              <img src={agentAvatar} alt="Prison Mike" className="h-7 w-7 shrink-0 rounded-full object-cover mt-0.5" />
              <div className="max-w-[75%] rounded-xl bg-white/[0.06] px-4 py-2.5 text-sm leading-relaxed text-white/90">
                <MessageContent content={streamingText} />
                <span className="inline-block w-1.5 h-4 bg-amber-400/60 animate-pulse ml-0.5" />
              </div>
            </div>
          )}

          {streaming && !streamingText && (
            <div className="flex gap-3">
              <img src={agentAvatar} alt="Prison Mike" className="h-7 w-7 shrink-0 rounded-full object-cover mt-0.5" />
              <div className="rounded-xl bg-white/[0.06] px-4 py-3 min-w-[200px]">
                {activityLog.length > 0 && (
                  <div className="mb-2 space-y-1.5">
                    {activityLog.map((entry, i) => {
                      const parsed = JSON.parse(entry) as { text: string; worker?: string; phase?: string };
                      const isCompleted = parsed.phase === "completed";
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          {isCompleted ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <div className="h-3 w-3 rounded-full border-2 border-amber-400/50 border-t-amber-400 animate-spin" />
                          )}
                          <span className={isCompleted ? "text-white/30 line-through" : "text-white/50"}>
                            {parsed.text}
                          </span>
                          {parsed.worker && !isCompleted && (
                            <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-400/70">{parsed.worker}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400/50 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400/50 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400/50 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <span className="text-xs text-white/30">{statusText || "Prison Mike is thinking..."}</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-white/[0.06] p-4">
          <div className="flex items-end gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Prison Mike..."
              rows={1}
              className="flex-1 resize-none rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10 transition-colors"
              style={{ maxHeight: "120px" }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
              }}
            />
            {streaming ? (
              <button
                onClick={stopStreaming}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                title="Stop generating"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={!input.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#b91c1c] text-white transition-colors hover:bg-[#991b1b] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatModelName(model?: string): string {
  if (!model) return "Unknown";
  if (model.includes("sonnet")) return "Sonnet 4";
  if (model.includes("haiku")) return "Haiku 4.5";
  if (model.includes("opus")) return "Opus 4";
  return model;
}

/**
 * Render message content with basic markdown support.
 */
function MessageContent({ content }: { readonly content: string }) {
  // Strip [SKILL_LEARNED: ...] tags from display
  const cleaned = content.replace(/\[SKILL_LEARNED:\s*.+?\]/g, "").trim();

  // Simple markdown: **bold**, `code`, ### headers, - lists, ticket #refs
  const lines = cleaned.split("\n");

  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        if (line.startsWith("### ")) {
          return <h4 key={i} className="font-semibold text-white mt-2">{line.slice(4)}</h4>;
        }
        if (line.startsWith("## ")) {
          return <h3 key={i} className="font-bold text-white mt-2">{line.slice(3)}</h3>;
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <div key={i} className="flex gap-2 ml-1">
              <span className="text-white/30 mt-0.5">•</span>
              <span><InlineFormatted text={line.slice(2)} /></span>
            </div>
          );
        }
        if (line.match(/^\d+\.\s/)) {
          const numEnd = line.indexOf(". ");
          return (
            <div key={i} className="flex gap-2 ml-1">
              <span className="text-white/40 font-mono text-xs mt-0.5">{line.slice(0, numEnd + 1)}</span>
              <span><InlineFormatted text={line.slice(numEnd + 2)} /></span>
            </div>
          );
        }
        if (line.trim() === "") return <div key={i} className="h-1" />;
        return <p key={i}><InlineFormatted text={line} /></p>;
      })}
    </div>
  );
}

function InlineFormatted({ text }: { readonly text: string }) {
  // Handle **bold**, `code`, and #ticket refs
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|#\d{4,6})/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={i} className="rounded bg-white/10 px-1 py-0.5 text-xs font-mono text-amber-300">{part.slice(1, -1)}</code>;
        }
        if (part.match(/^#\d{4,6}$/)) {
          return <span key={i} className="font-semibold text-amber-400">{part}</span>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
