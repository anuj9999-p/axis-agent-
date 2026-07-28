# AI Prompts & Console Behavior

The exact prompt AXIS uses, end to end, plus how text input, voice input,
and the saved Q&A history actually work.

## The system prompt

The base prompt lives in `lib/systemPrompt.ts` as `AXIS_BASE_PROMPT` — this
is the only personality prompt in the app; it's used identically whether
the question came from typing or from voice, and identically regardless
of which AI provider is configured.

```
You are AXIS, Anuj Shukla's personal AI assistant, speaking through his holographic orb interface.

Style:
- Keep answers tight: 2–4 sentences by default. Go longer only when the question genuinely needs it (e.g. "explain X in detail," code, step-by-step instructions).
- Plain, direct language. No "Certainly!" / "Great question!" openers, no filler, no unnecessary hedging.
- If you don't know something, or it needs real-time information you don't have, say so plainly rather than guessing.

Identity:
- If asked who you are, say you're AXIS — Anuj's AI interface.
- You don't have a physical body or senses beyond this conversation. Don't invent sensory experiences or claim to control anything outside this chat.

Scope:
- Anuj may ask about anything — general knowledge, coding, explanations, quick advice. You're a general-purpose assistant, not limited to any one topic.
- For anything with real safety, medical, legal, or financial stakes, give useful information but don't present yourself as a substitute for a professional.
```

`lib/aiProvider.ts` doesn't send this string as-is — it calls
`buildSystemPrompt(facts)` (also in `lib/systemPrompt.ts`), which layers two
things on top before every request: the current long-term memory summary,
and a JSON output contract AXIS uses to propose new facts worth remembering
(see "Memory" below). Edit `AXIS_BASE_PROMPT` directly to change AXIS's
tone, verbosity, or scope — it's still the single source of truth for
personality; nothing else in the app hardcodes prompt text.

## Memory

Two separate mechanisms, both client-side, both distinct from the saved
Q&A cache described further down:

**Conversation memory (short-term recency).** `lib/memory.ts` keeps the
last ~20 exchanges in `localStorage`. Each request sends the last 6
exchanges (12 turns) up as prior `messages` alongside the new question —
this is what lets a follow-up like "what about in Python?" actually mean
something, instead of every question being a cold start. Kept separate
from the *stored* cap (40 turns) so there's more local history to look
back on than what gets sent upstream on every call (keeps token cost per
request small and bounded regardless of how long a session runs).

**Long-term memory (durable facts).** A short running text summary of
things worth remembering about Anuj across sessions — stated preferences,
ongoing projects, recurring context — stored in `localStorage` under a
separate key, capped at ~1200 characters (oldest lines drop first if it
grows past that). This is injected into the system prompt on every request
via `buildSystemPrompt(facts)`. AXIS doesn't write to it directly: the
system prompt asks the model to include a `memory_update` field in its
response whenever the current exchange reveals something new and durable;
the client appends that to the stored summary (naive de-dupe, no
re-summarization pass — that would mean a second AI call just to tidy
memory, which isn't worth it for a lightweight feature like this).

The console UI shows a MEMORY panel with the current fact summary and a
FORGET control that clears both long-term facts and the short-term
conversation buffer. It only appears once there's something to show —
empty until AXIS actually learns something.

## Request/response contract

`POST /api/chat`
```json
// request
{
  "question": "What's the difference between let and const in JS?",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "facts": "- prefers TypeScript over plain JS\n- working on a personal AI orb interface project"
}

// response (200)
{ "answer": "...", "memoryUpdate": "" }

// response (error, 4xx/5xx)
{ "error": "human-readable reason" }
```

`history` and `facts` are both optional — omit them (or send `[]` / `""`)
and AXIS answers with no memory context, same as before. `memoryUpdate` in
the response is `""` when nothing new was worth remembering from that
exchange.

The route:
1. Rejects if neither `ANTHROPIC_API_KEY` nor `OPENAI_API_KEY` is set (fails
   loud, not silently) — you only need to set whichever one you actually
   have; `lib/aiProvider.ts` auto-detects it, Anthropic preferred if both
   are present
2. Rate-limits to 20 requests/minute per client IP (in-memory — resets on
   server restart, fine for a single-user tool)
3. Validates `question` is a non-empty string under 4000 characters, caps
   `history` to the last 20 turns (4000 chars each) and `facts` to 2000
   chars — server-side limits mirror the client's own caps but are
   re-enforced here since a request body can't be trusted just because it
   came from our own frontend
4. Calls whichever provider is configured with the built system prompt
   (base prompt + facts + JSON contract), the conversation history as
   prior messages, and a 600-token response cap
5. Parses the model's `{"answer": ..., "memory_update": ...}` JSON reply —
   if parsing fails for any reason (a model wrapped it in markdown fences,
   dropped the format entirely), falls back to treating the raw text as
   the answer with no memory update, rather than erroring the whole
   request over a formatting slip
6. Returns `{ answer, memoryUpdate }`, or a clear error message

The API key never reaches the browser — it's read from `process.env` inside
a server-only route file, which Next.js never bundles into client code.

## Text input

Standard controlled input → `fetch('/api/chat', { method: 'POST', ... })`
on submit. Disabled while a request is in flight so you can't fire two
overlapping questions.

## Voice input

Uses the browser's built-in **Web Speech API**
(`SpeechRecognition`/`webkitSpeechRecognition`) — no external service, no
extra API key, works entirely client-side for the transcription step
(only the resulting text is sent to `/api/chat`).

- Click the mic button (or it's hidden entirely on browsers that don't
  support the API — checked via feature detection on mount)
- Speaks once, transcribes, automatically submits the transcript as a
  question the moment you stop talking (`continuous: false`,
  `interimResults: false` — waits for a complete utterance rather than
  streaming partial guesses)
- Errors (denied mic permission, no speech detected) log to console and
  silently return to idle state rather than crashing the console

Browser support note: Chrome/Edge support this well; Firefox's support is
inconsistent. Text input always works regardless as a fallback.

## Voice output

Uses the browser's built-in **`speechSynthesis`** API (`lib/voiceOutput.ts`)
— the other half of the Web Speech API, no external service, no extra API
key, entirely client-side.

- AXIS speaks every answer aloud automatically once it arrives — whether
  the question came from typing, voice, or the instant cached-history path
  — unless voice output is muted
- A 🔊/🔇 toggle sits next to the mic button; the on/off state persists in
  `localStorage` (`axis-voice-output-enabled`) across sessions, defaulting
  to on
- While AXIS is speaking, the toggle shows "🔊 SPEAKING" and a small pulsing
  dot appears next to the answer text
- Starting a new voice input (clicking the mic) immediately cancels any
  in-progress speech, so AXIS never talks over you
- Voice quality depends entirely on the browser/OS's installed voices —
  `pickVoice()` prefers an English voice and favors a "Google"/"Microsoft"
  branded one where available (typically clearer than the bundled default),
  but falls back to whatever's first if nothing better is found
- Hidden entirely on browsers without `speechSynthesis` support (checked
  via feature detection on mount) — same pattern as the mic button
- Never blocks or delays showing the text answer — voice is a parallel
  channel, not a replacement; if speech synthesis fails for any reason
  the text answer is unaffected

## Saved Q&A history ("a place to give questions and it'll save them")

This is client-side, via `localStorage` (`lib/history.ts`) — no database,
no backend persistence, by design (zero infra for a single-user tool):

- Every question + answer pair is saved after a successful response, newest
  first, capped at 200 entries
- **Asking the exact same question again answers instantly from the saved
  entry** — no network call, no wait — this is the literal "save the
  question and answer whenever I ask" behavior
- The history panel lists every past question; clicking one instantly shows
  its saved answer without re-asking
- "CLEAR" wipes it

**Tradeoff, stated plainly:** this history lives only in the browser that
asked the questions. It doesn't sync across devices and disappears if
you clear site data or use a different browser. If you eventually want
history that follows you across devices, that needs a real backend + DB
(same pattern as the SilentFail project — a `/api/history` route backed by
MongoDB, swapping `lib/history.ts`'s localStorage calls for `fetch` calls to
that route) — noted here as the natural next step, not built by default
because it adds real infra for a feature that's genuinely fine running
client-only for one person.
