"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearHistory, loadHistory, makeId, saveEntry, type QAEntry } from "@/lib/history";
import {
  appendFact,
  appendTurns,
  clearConversation,
  clearFacts,
  loadFacts,
  recentTurnsForRequest,
} from "@/lib/memory";
import {
  isVoiceOutputSupported,
  loadVoiceOutputPreference,
  saveVoiceOutputPreference,
  speak,
  stopSpeaking,
} from "@/lib/voiceOutput";

type AskState = "idle" | "listening" | "thinking";

// Minimal shape for the Web Speech API — not in standard TS lib types.
interface SpeechRecognitionResultLike {
  [index: number]: { [index: number]: { transcript: string } };
}
interface SpeechRecognitionEventLike {
  results: SpeechRecognitionResultLike;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export interface AxisConsoleProps {
  /** Called on state transitions so the parent can drive orb visuals (e.g. a "thinking" pulse). */
  onStateChange?: (state: AskState) => void;
}

export default function AxisConsole({ onStateChange }: AxisConsoleProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [state, setState] = useState<AskState>("idle");
  const [history, setHistory] = useState<QAEntry[]>([]);
  const [activeAnswer, setActiveAnswer] = useState<string | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [facts, setFacts] = useState("");
  const [voiceOutputSupported, setVoiceOutputSupported] = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
    setFacts(loadFacts());
    setVoiceOutputSupported(isVoiceOutputSupported());
    setVoiceOutputEnabled(loadVoiceOutputPreference());
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    setVoiceSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  const setStateBoth = useCallback(
    (s: AskState) => {
      setState(s);
      onStateChange?.(s);
    },
    [onStateChange],
  );

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;

      // Answer instantly from history if this exact question was asked before —
      // this is the "save the question and answer whenever I ask" behavior:
      // no network round-trip needed for a repeat question. Still logged as
      // a conversation turn so a follow-up question right after has the
      // right recency context.
      const cached = history.find(
        (h) => h.question.toLowerCase() === trimmed.toLowerCase(),
      );
      if (cached) {
        setActiveAnswer(cached.answer);
        appendTurns([
          { role: "user", content: trimmed },
          { role: "assistant", content: cached.answer },
        ]);
        setInput("");
        if (voiceOutputEnabled) {
          speak(cached.answer, { onStart: () => setSpeaking(true), onEnd: () => setSpeaking(false) });
        }
        return;
      }

      setStateBoth("thinking");
      setActiveAnswer(null);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: trimmed,
            history: recentTurnsForRequest(),
            facts,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Request failed.");

        const answer: string = data.answer;
        setActiveAnswer(answer);
        const entry: QAEntry = { id: makeId(), question: trimmed, answer, askedAt: Date.now() };
        setHistory(saveEntry(entry));
        appendTurns([
          { role: "user", content: trimmed },
          { role: "assistant", content: answer },
        ]);
        if (data.memoryUpdate) {
          setFacts(appendFact(data.memoryUpdate));
        }
        setInput("");
        if (voiceOutputEnabled) {
          speak(answer, { onStart: () => setSpeaking(true), onEnd: () => setSpeaking(false) });
        }
      } catch (err) {
        console.error("[AxisConsole] ask failed:", err);
        setActiveAnswer(
          err instanceof Error ? `AXIS ERROR: ${err.message}` : "AXIS ERROR: something went wrong.",
        );
      } finally {
        setStateBoth("idle");
      }
    },
    [history, facts, voiceOutputEnabled, setStateBoth],
  );

  const startListening = useCallback(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Impl = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Impl) return;

    stopSpeaking();
    setSpeaking(false);

    const recognition = new Impl();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? "";
      if (transcript) void ask(transcript);
    };
    recognition.onerror = (e) => {
      console.error("[AxisConsole] speech recognition error:", e);
      setStateBoth("idle");
    };
    recognition.onend = () => {
      if (state === "listening") setStateBoth("idle");
    };

    recognitionRef.current = recognition;
    setStateBoth("listening");
    recognition.start();
  }, [ask, setStateBoth, state]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setStateBoth("idle");
  }, [setStateBoth]);

  const toggleVoiceOutput = useCallback(() => {
    setVoiceOutputEnabled((prev) => {
      const next = !prev;
      saveVoiceOutputPreference(next);
      if (!next) {
        stopSpeaking();
        setSpeaking(false);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    // Stop any in-progress speech if the console unmounts mid-answer.
    return () => stopSpeaking();
  }, []);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void ask(input);
    },
    [ask, input],
  );

  return (
    <div className={`console ${open ? "console-open" : ""}`}>
      <button
        type="button"
        className="hud-btn console-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "CLOSE" : "ASK AXIS"}
      </button>

      {open && (
        <div className="console-panel">
          <form onSubmit={onSubmit} className="console-form">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={state === "thinking" ? "AXIS IS THINKING…" : "TYPE A QUESTION…"}
              disabled={state === "thinking"}
              className="console-input"
              autoComplete="off"
            />
            {voiceSupported && (
              <button
                type="button"
                className={`console-mic ${state === "listening" ? "active" : ""}`}
                onClick={state === "listening" ? stopListening : startListening}
                disabled={state === "thinking"}
                aria-label="Voice input"
                title="Voice input"
              >
                {state === "listening" ? "● LISTENING" : "🎙"}
              </button>
            )}
            {voiceOutputSupported && (
              <button
                type="button"
                className={`console-mic ${speaking ? "active" : ""}`}
                onClick={toggleVoiceOutput}
                aria-label="Toggle AXIS voice output"
                title={voiceOutputEnabled ? "Voice output on — click to mute" : "Voice output off — click to unmute"}
              >
                {voiceOutputEnabled ? (speaking ? "🔊 SPEAKING" : "🔊") : "🔇"}
              </button>
            )}
            <button type="submit" className="hud-btn" disabled={state === "thinking" || !input.trim()}>
              ASK
            </button>
          </form>

          {activeAnswer && (
            <div className="console-answer">
              {activeAnswer}
              {speaking && <span className="console-speaking-dot" aria-hidden="true" />}
            </div>
          )}

          {facts && (
            <div className="console-memory">
              <div className="console-history-head">
                <span>MEMORY</span>
                <button
                  type="button"
                  className="console-clear"
                  onClick={() => {
                    clearFacts();
                    clearConversation();
                    setFacts("");
                  }}
                  title="Forget long-term facts and recent conversation context"
                >
                  FORGET
                </button>
              </div>
              <pre className="console-memory-body">{facts}</pre>
            </div>
          )}

          {history.length > 0 && (
            <div className="console-history">
              <div className="console-history-head">
                <span>SAVED Q&amp;A ({history.length})</span>
                <button
                  type="button"
                  className="console-clear"
                  onClick={() => {
                    clearHistory();
                    setHistory([]);
                    setActiveAnswer(null);
                  }}
                >
                  CLEAR
                </button>
              </div>
              <ul className="console-history-list">
                {history.map((h) => (
                  <li key={h.id}>
                    <button type="button" onClick={() => setActiveAnswer(h.answer)}>
                      {h.question}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
