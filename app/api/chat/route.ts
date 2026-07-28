import { NextRequest, NextResponse } from "next/server";
import { askAxis, detectProvider, type ChatTurn } from "@/lib/aiProvider";

// Basic in-memory rate limit per server instance — resets on restart/redeploy.
// Good enough for a single-user personal tool; swap for Redis if this ever
// needs to survive multiple server instances or serverless cold starts.
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const hits = new Map<string, number[]>();

// Caps on the client-supplied context fields — these mirror the client's
// own limits (see lib/memory.ts) but are re-enforced here since a request
// body can't be trusted just because it came from our own frontend.
const MAX_HISTORY_TURNS = 20;
const MAX_TURN_CHARS = 4000;
const MAX_FACTS_CHARS = 2000;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const timestamps = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  hits.set(key, timestamps);
  return timestamps.length > MAX_REQUESTS_PER_WINDOW;
}

function parseHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: ChatTurn[] = [];
  for (const item of value.slice(-MAX_HISTORY_TURNS)) {
    if (
      item &&
      typeof item === "object" &&
      (item as { role?: unknown }).role &&
      typeof (item as { content?: unknown }).content === "string"
    ) {
      const role = (item as { role: unknown }).role;
      if (role !== "user" && role !== "assistant") continue;
      const content = (item as { content: string }).content.slice(0, MAX_TURN_CHARS);
      turns.push({ role, content });
    }
  }
  return turns;
}

export async function POST(req: NextRequest) {
  if (!detectProvider()) {
    return NextResponse.json(
      {
        error:
          "No AI key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env — whichever you have. See .env.example.",
      },
      { status: 500 },
    );
  }

  const ip = req.headers.get("x-forwarded-for") ?? "local";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests — slow down a little." },
      { status: 429 },
    );
  }

  let body: { question?: unknown; history?: unknown; facts?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "Missing 'question' string." }, { status: 400 });
  }
  if (question.length > 4000) {
    return NextResponse.json(
      { error: "Question is too long (max 4000 characters)." },
      { status: 400 },
    );
  }

  const history = parseHistory(body.history);
  const facts =
    typeof body.facts === "string" ? body.facts.slice(0, MAX_FACTS_CHARS) : "";

  try {
    const { answer, memoryUpdate } = await askAxis(question, history, facts);
    return NextResponse.json({ answer, memoryUpdate });
  } catch (err) {
    console.error("[api/chat] AI request failed:", err);
    return NextResponse.json(
      { error: "AXIS couldn't reach its AI backend just now. Try again in a moment." },
      { status: 502 },
    );
  }
}
