/**
 * Two kinds of memory, both client-side (localStorage), both separate from
 * the exact-match Q&A cache in lib/history.ts:
 *
 * 1. Conversation memory — the last N exchanges, sent with each new
 *    question so AXIS can handle follow-ups ("what about in Python?")
 *    instead of treating every question as a cold start.
 * 2. Long-term memory — a short running text summary of durable facts
 *    about Anuj, built up one line at a time as AXIS notices something
 *    worth keeping. Small on purpose: this is a running summary, not a
 *    transcript, so it stays cheap to inject into every request.
 *
 * Same tradeoff as history.ts: per-browser, no server persistence, zero
 * infra. If cross-device memory is ever needed, this is the file to swap
 * for `/api/memory` + a DB, same as noted for history.ts.
 */

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

const CONVERSATION_KEY = "axis-conversation-v1";
const FACTS_KEY = "axis-facts-v1";

// How many turns live in storage vs. how many get sent to the API per
// request are deliberately different: keep more locally (so the visible
// "recent context" can be longer / reviewable) but only send the last few
// exchanges upstream to keep each request's token cost small.
const MAX_STORED_TURNS = 40; // ~20 exchanges
const TURNS_SENT_TO_API = 12; // ~6 exchanges of context
const MAX_FACTS_CHARS = 1200; // keeps the injected memory block small & cheap

export function loadConversation(): ConversationTurn[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CONVERSATION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Appends a user/assistant turn pair and trims to the storage cap. */
export function appendTurns(turns: ConversationTurn[]): ConversationTurn[] {
  const current = loadConversation();
  const next = [...current, ...turns].slice(-MAX_STORED_TURNS);
  try {
    window.localStorage.setItem(CONVERSATION_KEY, JSON.stringify(next));
  } catch {
    // storage full/unavailable — fail silently, chat still works without recency context
  }
  return next;
}

/** The slice actually sent with the next request — recent, not everything stored. */
export function recentTurnsForRequest(): ConversationTurn[] {
  return loadConversation().slice(-TURNS_SENT_TO_API);
}

export function clearConversation(): void {
  try {
    window.localStorage.removeItem(CONVERSATION_KEY);
  } catch {
    /* ignore */
  }
}

export function loadFacts(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(FACTS_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Appends one new fact line to the running summary. Naive de-dupe (skip if
 * already present) plus a hard char cap — once the cap is hit, oldest
 * lines are dropped first. This is intentionally simple: no re-summarization
 * pass, since that would mean another AI call just to tidy memory.
 */
export function appendFact(fact: string): string {
  const trimmed = fact.trim();
  if (!trimmed) return loadFacts();

  const current = loadFacts();
  const lines = current ? current.split("\n").filter(Boolean) : [];
  if (lines.some((l) => l.toLowerCase() === trimmed.toLowerCase())) {
    return current; // already known, don't duplicate
  }
  lines.push(`- ${trimmed}`);

  let combined = lines.join("\n");
  while (combined.length > MAX_FACTS_CHARS && lines.length > 1) {
    lines.shift(); // drop oldest fact first
    combined = lines.join("\n");
  }

  try {
    window.localStorage.setItem(FACTS_KEY, combined);
  } catch {
    /* ignore */
  }
  return combined;
}

export function clearFacts(): void {
  try {
    window.localStorage.removeItem(FACTS_KEY);
  } catch {
    /* ignore */
  }
}
