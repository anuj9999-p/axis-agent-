# SETUP — Getting AXIS Running With Your Own Context

This is a from-scratch guide for going from this folder to a running,
fully-yours version of AXIS. No prior context needed.

## 1. What this project actually is

A Next.js app with one page. That page renders a full-screen Three.js orb
(`lib/orbScene.ts`) and layers a HUD on top of it (`components/AxisOrb.tsx`).
A webcam-driven hand tracker (`lib/handTracker.ts`) optionally feeds gesture
input into the same rotate/zoom controls the mouse and keyboard already use.
An "ASK AXIS" panel (`components/AxisConsole.tsx`) lets you actually talk to
it — by text or voice — backed by a server-side API route that calls Claude.
See `PROMPTS.md` for the exact system prompt and how the console works.

## 2. Prerequisites

| Tool | Version | Get it from |
|---|---|---|
| Node.js | 20.x LTS or newer | https://nodejs.org |
| npm | comes with Node | — |
| A webcam | any | only needed for the hand-gesture controls; everything else works without one |
| An AI API key | — | **Anthropic**: console.anthropic.com → API Keys, key starts `sk-ant-`. **Or OpenAI**: platform.openai.com/api-keys, key starts `sk-`. You only need ONE — the app auto-detects whichever you set. Only needed if you want the "ASK AXIS" chat panel to work; the orb/gestures/controls all work without it |

Check with:
```bash
node -v
```

## 3. Install & configure

```bash
npm install
cp .env.example .env
```
Open `.env` and paste **whichever key you have** — you only need one:
```
ANTHROPIC_API_KEY=sk-ant-...
```
or
```
OPENAI_API_KEY=sk-...
```
The app auto-detects which one is set. Skip this entirely if you only want
the visual orb with no chat — the app runs fine without it, "ASK AXIS" will
just show a clear error if you try to use it before adding a key.

```bash
npm run dev
```
Open **http://localhost:3000**. That's it — no environment variables, no
external services, no API keys required for what's here today.

Other scripts available:
```bash
npm run build   # production build
npm run start   # run the production build locally
```

## 4. Verify it's actually working

- [ ] Page loads with a black background and a glowing orb
- [ ] Dragging the orb spins it
- [ ] Scrolling zooms in/out
- [ ] Top-left HUD reads `A.X.I.S.` with `ANUJ SHUKLA // AI INTERFACE` beneath it
- [ ] Pressing `G` (or clicking the button) prompts for camera access and, once
      granted, shows a small mirrored camera preview bottom-right
- [ ] Pinching one hand and moving it spins the orb; pinching both hands and
      spreading them zooms
- [ ] Clicking "ASK AXIS" (bottom-left) opens the console panel
- [ ] Typing a question and pressing ASK (or Enter) returns an answer within
      a few seconds, and the HUD title briefly shows "THINKING…"
- [ ] Clicking the 🎙 button, speaking, then pausing auto-submits your speech as a question
- [ ] Asking the exact same question again answers instantly with no delay (served from saved history)
- [ ] The history list under the input shows past questions; clicking one re-shows its saved answer

If camera access is denied or unavailable, the HUD now shows a specific
reason (see below) rather than crashing — everything else keeps working with
mouse/keyboard either way.

## 5. Troubleshooting

### "Port 3000 is in use, using available port ..."
Not an error — just Next.js telling you something else is already on 3000
and it picked the next free port instead. Check the terminal output for the
actual port (e.g. `http://localhost:3001`) and open that.

To force a specific port instead:
```bash
npm run dev -- -p 3000
```
and stop whatever else is using it first.

### "TRACKING INIT FAILED" (or any camera/tracking error)
This message used to be generic — it's now specific about which stage
failed, and the full underlying error is always logged to the browser
console (`F12` → Console tab). Open the console first; the messages below
tell you what to do next:

| HUD message | What it means | Fix |
|---|---|---|
| `CAMERA ACCESS DENIED` | Browser permission prompt was denied | Click the camera icon in the address bar → allow, then retry |
| `NO CAMERA FOUND` | No webcam detected | Check the device actually has/exposes one; try a different browser |
| `CAMERA IN USE BY ANOTHER APP` | Another app/tab has the camera open | Close Zoom/Teams/other tabs using the camera, retry |
| `RUNTIME LOAD BLOCKED` | Failed to fetch the MediaPipe wasm runtime from `cdn.jsdelivr.net` | Almost always a firewall, antivirus, corporate network, or ad-blocker blocking the CDN. Try a different network, temporarily disable the blocker, or check the browser console for the exact failed URL |
| `MODEL LOAD BLOCKED` | Failed to fetch the hand-landmark model from `storage.googleapis.com` | Same as above — this domain is commonly blocked on restrictive networks. Also possible: the browser genuinely lacks WebGL/WASM support (rare on modern browsers) |

Both of the "blocked" cases are almost always a **network/firewall issue**,
not a bug in the app — this app relies on two external CDNs at runtime for
the hand-tracking model (there's no way around that without self-hosting the
model files, which is a reasonable follow-up if this keeps happening on your
network — see section 7).

The gesture feature is fully optional — mouse drag, scroll-to-zoom, and all
keyboard shortcuts work with zero network dependency regardless of whether
gestures ever initialize.

### `npm audit` reporting vulnerabilities after install
Expected on a fresh install of most Next.js projects — these are almost
always in transitive dev dependencies, not code that ships to the browser.
Run `npm audit` to see specifics before assuming anything's actually
exploitable in this app; `npm audit fix` resolves what it safely can.

### "AXIS ERROR: No AI key configured"
You skipped or mistyped step 3. Confirm `.env` exists in the project root
(not `.env.example`) and contains a real key — either `ANTHROPIC_API_KEY`
(starts `sk-ant-`) or `OPENAI_API_KEY` (starts `sk-`), just one is fine —
then restart `npm run dev`. Next.js only reads `.env` on server start,
editing it while the dev server is running won't take effect until you
restart.

### "AXIS couldn't reach its AI backend just now"
The server-side call to the AI provider failed — check the terminal running
`npm run dev` for the actual logged error (`[api/chat] AI request failed:`).
Most common causes: invalid/expired API key, or no billing/credits on the
account for whichever provider you're using.

### Mic button doesn't appear
Voice input uses the browser's built-in Web Speech API, which isn't
universally supported (Firefox's support is inconsistent). The button is
feature-detected and simply hidden if your browser doesn't support it — text
input always works as a fallback regardless.

### History disappeared / doesn't show old questions
History is saved via `localStorage` in the specific browser you asked from
— it doesn't sync across browsers, devices, or incognito/private windows,
and clears if you clear that site's browsing data. This is a deliberate
tradeoff for zero-infra persistence (see `PROMPTS.md` for the reasoning and
what a synced version would require).

## 6. Making it more "yours" beyond the rename

The branding pass (name, HUD title, subtitle, meta title/description) is
already done — this section is for going further if you want to:

- **Swap the accent color.** It's currently a warm orange/amber, set via the
  `rgba(255, 170, 48, ...)` values scattered through `app/globals.css` and
  the `C_BRIGHT` / `C_MID` / `C_DIM` / `C_FAINT` / `C_HOT` hex constants
  near the top of `createOrbScene` in `lib/orbScene.ts`. Change those
  consistently across both files to re-theme the whole thing.
- **Change the floating status text.** `lib/orbScene.ts` has a
  `codeSnippets` array — short strings that float around the orb as tiny
  sprites. Already includes a couple of personal touches (`axis.init()`,
  `anuj.sh`); add or swap in whatever fits.
- **Add your own screenshot.** `docs/screenshot.png` was removed since the
  original showed Sagar's branding — drop a new screenshot of your running
  version in `docs/` with the same filename and the README's image link will
  pick it up automatically.
- **Rename the HUD strings further.** Everything user-visible lives in
  `components/AxisOrb.tsx` — the `MODE_LABEL` map (`STANDBY`/`SPIN`/`ZOOM`),
  the hint text, and button labels are all plain strings, easy to edit
  without touching any logic.

## 7. Where this could go next (if you want to actually wire up "my AI")

Right now this is a UI shell — genuinely impressive on its own, but if the
goal is for it to be the front-end of an actual AI you talk to, the natural
next additions (not built yet, listed here so it's an intentional roadmap
rather than a vague someday):

1. **A text input** — a simple prompt box (styled to match the HUD) that
   sends what you type to an LLM API (Claude API is the natural fit given
   the rest of this ecosystem) and shows the response as HUD text.
2. **Voice input** — Web Speech API or a hosted transcription service, so
   you can talk to it instead of typing, closer to the "AI that talks in
   real time" framing from the original ULTRON project this was based on.
3. **Reactive orb states** — right now the orb's `mode` only reflects
   gesture state (`idle`/`spin`/`zoom`). Adding a `thinking`/`responding`
   state driven by actual AI request lifecycle would make the orb feel like
   it's *doing* something when you talk to it, not just a controllable
   visual toy.
4. **Deploy it** — Vercel is the natural host for a Next.js app like this
   (`vercel deploy` from the project root, no config needed beyond what's
   already here) if you want a live link to share rather than just running
   it locally.

None of this is required for what exists today to work — it already runs
fully standalone. This section is here so the "make it my AI" part of the
idea has a clear, honest next step instead of implying it's already wired up.

