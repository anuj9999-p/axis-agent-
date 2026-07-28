import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { buildSystemPrompt } from "@/lib/systemPrompt";

/**
 * You don't need to decide which AI provider to use ahead of time — just
 * set whichever key you end up getting in .env, and this picks it up
 * automatically. If both are set, Anthropic is preferred. If neither is
 * set, askAxis() throws a clear "no key configured" error the API route
 * turns into a normal error response.
 */

export type Provider = "anthropic" | "openai";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AskAxisResult {
  answer: string;
  /** New fact AXIS flagged as worth remembering long-term, or "" if none. */
  memoryUpdate: string;
}

export function detectProvider(): Provider | null {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}

/**
 * Pulls {"answer": "...", "memory_update": "..."} out of the model's raw
 * text. The system prompt asks for bare JSON, but models occasionally wrap
 * it in markdown fences or add stray whitespace — strip that defensively.
 * If parsing fails for any reason, fall back to treating the whole raw
 * response as the answer with no memory update, rather than erroring out
 * the whole request over a formatting slip.
 */
function parseStructuredResponse(raw: string): AskAxisResult {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    const parsed = JSON.parse(cleaned);
    const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
    const memoryUpdate =
      typeof parsed.memory_update === "string" ? parsed.memory_update.trim() : "";
    if (answer) return { answer, memoryUpdate };
  } catch {
    // fall through to raw-text fallback below
  }
  return { answer: raw.trim(), memoryUpdate: "" };
}

export async function askAxis(
  question: string,
  history: ChatTurn[] = [],
  facts: string = "",
): Promise<AskAxisResult> {
  const provider = detectProvider();
  const system = buildSystemPrompt(facts);
  const messages: ChatTurn[] = [...history, { role: "user", content: question }];

  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 600,
      system,
      messages,
    });
    const raw = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    return parseStructuredResponse(raw);
  }

  if (provider === "openai") {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 600,
      messages: [{ role: "system", content: system }, ...messages],
    });
    const raw = response.choices[0]?.message?.content ?? "";
    return parseStructuredResponse(raw);
  }

  throw new Error(
    "No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env — whichever key you have.",
  );
}
