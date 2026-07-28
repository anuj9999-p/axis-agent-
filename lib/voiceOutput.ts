/**
 * Voice output for AXIS, via the browser's built-in Web Speech API
 * (`speechSynthesis` — the TTS half; `SpeechRecognition` in AxisConsole.tsx
 * is the STT half). Same tradeoffs as voice input: no external service, no
 * extra API key, entirely client-side, quality depends on the browser/OS's
 * installed voices rather than a studio-quality model.
 */

const PREF_KEY = "axis-voice-output-enabled";

export function isVoiceOutputSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Defaults to ON — voice-in/voice-out is the point of the feature; text
 * stays the fallback/parallel channel, same as it already is for input. */
export function loadVoiceOutputPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

export function saveVoiceOutputPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(PREF_KEY, String(enabled));
  } catch {
    /* ignore */
  }
}

let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesReady = false;

/** Voice lists load async in most browsers (fires `voiceschanged`), so pick
 * lazily rather than once at import time. Simple heuristic: prefer an
 * English voice, ideally one that sounds less like default-robot (many
 * platforms ship a "Google"/"Microsoft"-branded one that's noticeably
 * clearer than the bundled default) — falls back to whatever's first. */
function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const english = voices.filter((v) => v.lang.startsWith("en"));
  const pool = english.length ? english : voices;
  const preferred =
    pool.find((v) => /google|microsoft/i.test(v.name)) ?? pool[0];

  cachedVoice = preferred;
  voicesReady = true;
  return preferred;
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    voicesReady = false;
    cachedVoice = null;
  };
}

/** Cancels whatever AXIS might currently be saying — call before speaking
 * something new so answers never overlap or queue up. */
export function stopSpeaking(): void {
  if (isVoiceOutputSupported()) window.speechSynthesis.cancel();
}

export interface SpeakHandlers {
  onStart?: () => void;
  onEnd?: () => void;
}

/** Speaks `text` aloud. No-ops quietly if unsupported — voice output is a
 * bonus channel, never a hard requirement (text answer is always shown
 * regardless of whether this succeeds). */
export function speak(text: string, handlers: SpeakHandlers = {}): void {
  if (!isVoiceOutputSupported() || !text.trim()) return;

  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  else if (!voicesReady) {
    // Voice list wasn't ready yet (common on first speak in a session) —
    // retry once the browser reports voices are loaded.
    window.speechSynthesis.onvoiceschanged = () => {
      voicesReady = false;
      cachedVoice = null;
    };
  }

  utterance.onstart = () => handlers.onStart?.();
  utterance.onend = () => handlers.onEnd?.();
  utterance.onerror = () => handlers.onEnd?.();

  window.speechSynthesis.speak(utterance);
}
