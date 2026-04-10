"use client";

import { AgentChat } from "@/components/chat/agent-chat";

const TOBY_CONFIG = {
  name: "Toby Flenderson",
  subtitle: "Analytics & Learning Agent — HR of Ticket Data",
  avatarUrl: "/toby.png",
  accentColor: "#2563eb",
  apiEndpoint: "/api/toby/chat",
  conversationsEndpoint: "/api/toby/conversations",
  skillsEndpoint: "/api/michael/skills",
  conversationsTable: "toby_conversations",
  messagesTable: "toby_messages",
  thinkingText: "Toby is analyzing the data...",
  placeholder: "Ask Toby about analytics, trends, or tech performance...",
  emptyTitle: "Talk to Toby",
  emptyDescription: "Ask about tech performance, customer patterns, ticket trends, or triage accuracy. Toby sees everything and has the data to back it up.",
  skillLearnHint: "Toby shares learned skills with Prison Mike",
  suggestions: [
    "Which techs are falling behind this week?",
    "What are the top 5 clients by ticket volume?",
    "Show me the team overview for the last 7 days",
    "Are there any recurring issues we should investigate?",
  ],
} as const;

export default function TobyPage() {
  return (
    <div className="-m-4 sm:-m-6 lg:-m-8">
      <AgentChat config={TOBY_CONFIG} />
    </div>
  );
}
