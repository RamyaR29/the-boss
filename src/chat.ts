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

export const hasApiKey = () => invoke<boolean>("has_api_key");
export const saveApiKey = (key: string) => invoke<void>("save_api_key", { key });
export const deleteApiKey = () => invoke<void>("delete_api_key");
