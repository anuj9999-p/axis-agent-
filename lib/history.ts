export interface QAEntry {
  id: string;
  question: string;
  answer: string;
  askedAt: number; // epoch ms
}

const STORAGE_KEY = "axis-history-v1";

/** All history is stored per-browser via localStorage — there is no server-side
 * database. It doesn't sync across devices and clears if the user wipes site
 * data. That tradeoff is intentional: it means zero setup (no DB, no auth
 * beyond what's already here) for a single-user personal tool. */
export function loadHistory(): QAEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveEntry(entry: QAEntry): QAEntry[] {
  const current = loadHistory();
  const next = [entry, ...current].slice(0, 200); // cap so localStorage never bloats unbounded
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage full or unavailable (private browsing) — fail silently, chat still works
  }
  return next;
}

export function clearHistory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
