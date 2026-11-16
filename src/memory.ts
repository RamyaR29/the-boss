import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** One fact The Boss remembers (stored by the Rust side in memory.json). */
export interface Memory {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

/** A memory change that came with a chat reply, shown under it with an Undo. */
export interface MemoryChange {
  kind: "added" | "updated" | "forgot" | "skipped";
  memory: Memory | null;
  /** Text before an update. */
  before: string | null;
  /** Why it was skipped. */
  note: string | null;
  undone?: boolean;
}

const listMemories = () => invoke<Memory[]>("list_memories");
const addMemory = (text: string) => invoke<Memory>("add_memory", { text });
const updateMemory = (id: string, text: string) => invoke<Memory>("update_memory", { id, text });
const deleteMemory = (id: string) => invoke<void>("delete_memory", { id });
const restoreMemory = (memory: Memory) => invoke<void>("restore_memory", { memory });
const clearMemories = () => invoke<void>("clear_memories");

/** Reverses a change made through chat. */
export async function undoChange(c: MemoryChange) {
  if (!c.memory) return;
  if (c.kind === "added") await deleteMemory(c.memory.id);
  else if (c.kind === "updated" && c.before !== null) await updateMemory(c.memory.id, c.before);
  else if (c.kind === "forgot") await restoreMemory(c.memory);
}

/** The line shown under a reply, e.g. "Noted: Exam is in Room 204". */
export function changeLabel(c: MemoryChange) {
  const text = c.memory?.text ?? "";
  switch (c.kind) {
    case "added":
      return `Noted: ${text}`;
    case "updated":
      return `Updated: ${text}`;
    case "forgot":
      return `Forgot: ${text}`;
    default:
      return `Not saved. ${c.note ?? ""}`;
  }
}

export interface MemoryState {
  items: Memory[];
  error: string;
  reload: () => Promise<void>;
  add: (text: string) => Promise<void>;
  update: (id: string, text: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
}

export function useMemory(): MemoryState {
  const [items, setItems] = useState<Memory[]>([]);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      setItems(await listMemories());
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Each action reloads the list; errors are thrown so the caller can show them.
  const add = useCallback(async (text: string) => void (await addMemory(text), await reload()), [reload]);
  const update = useCallback(
    async (id: string, text: string) => void (await updateMemory(id, text), await reload()),
    [reload],
  );
  const remove = useCallback(async (id: string) => void (await deleteMemory(id), await reload()), [reload]);
  const clear = useCallback(async () => void (await clearMemories(), await reload()), [reload]);

  return { items, error, reload, add, update, remove, clear };
}
