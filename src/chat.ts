import { invoke } from "@tauri-apps/api/core";

export interface ChatMessage {
  id: number;
  role: "user" | "model";
  text: string;
  /** True when this "model" message is an error shown to the user, not a real reply. */
  error?: boolean;
}

/** How many earlier messages to send with each question. */
const HISTORY_LIMIT = 12;

export async function askBoss(messages: ChatMessage[], context: string): Promise<string> {
  const history = messages
    .filter((m) => !m.error)
    .slice(-HISTORY_LIMIT)
    .map(({ role, text }) => ({ role, text }));
  return invoke<string>("ask", { history, context });
}

// ---------- sessions (saved as local files by the Rust side) ----------

/** A chat starts fresh after this long with no messages. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;

export interface Session {
  id: string;
  startedAt: number;
  lastAt: number;
  messages: ChatMessage[];
}

export interface SessionSummary {
  id: string;
  startedAt: number;
  lastAt: number;
  title: string;
  count: number;
}

export function newSession(): Session {
  const now = Date.now();
  return { id: crypto.randomUUID(), startedAt: now, lastAt: now, messages: [] };
}

export const isStale = (s: Session) =>
  s.messages.length > 0 && Date.now() - s.lastAt > SESSION_IDLE_MS;

export const saveSession = (session: Session) => invoke<void>("save_session", { session });
export const loadSession = (id: string) => invoke<Session>("load_session", { id });
export const listSessions = () => invoke<SessionSummary[]>("list_sessions");
export const deleteSession = (id: string) => invoke<void>("delete_session", { id });

// ---------- API key ----------

export const hasApiKey = () => invoke<boolean>("has_api_key");
export const saveApiKey = (key: string) => invoke<void>("save_api_key", { key });
export const deleteApiKey = () => invoke<void>("delete_api_key");
