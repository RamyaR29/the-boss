import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { startOfDay } from "./canvas";

export interface ReminderList {
  id: string;
  title: string;
  account: string;
}

/** A reminder (has a due date) or a to-do (no date) from the Mac Reminders app. */
export interface Reminder {
  id: string;
  title: string;
  listId: string;
  listTitle: string;
  dueMs: number | null;
  allDay: boolean;
  completed: boolean;
}

export interface Due {
  ms: number;
  allDay: boolean;
}

/** A reminder change that came with a chat reply. */
export interface ReminderChange {
  kind: "created" | "completed" | "rescheduled" | "confirmDelete" | "skipped";
  item: Reminder | null;
  beforeDue: Due | null;
  note: string | null;
  undone?: boolean;
}

export type RemindersAccess = "notDetermined" | "granted" | "denied" | "restricted" | "writeOnly";

const REFRESH_MS = 5 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const HIDDEN_KEY = "boss.reminders.hidden";
const DISMISSED_KEY = "boss.reminders.dismissed";

// ---------- calls to Rust ----------

export const completeReminder = (id: string, done: boolean) =>
  invoke<Reminder>("complete_reminder", { id, done });
export const setReminderDue = (id: string, due: Due | null) =>
  invoke<Reminder>("set_reminder_due", { id, due });
export const deleteReminder = (id: string) => invoke<Reminder>("delete_reminder", { id });
export const restoreReminder = (reminder: Reminder) =>
  invoke<Reminder>("restore_reminder", { reminder });

/** Reverses a change made through chat. */
export async function undoReminderChange(c: ReminderChange) {
  if (!c.item) return;
  if (c.kind === "created") await deleteReminder(c.item.id);
  else if (c.kind === "completed") await completeReminder(c.item.id, false);
  else if (c.kind === "rescheduled") await setReminderDue(c.item.id, c.beforeDue);
}

const fullFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** "Tue, Nov 17, 6:00 PM", "Tue, Nov 17 (all day)" or "no date". */
export function dueText(r: { dueMs: number | null; allDay: boolean }) {
  if (r.dueMs === null) return "no date";
  return r.allDay ? `${dayFmt.format(r.dueMs)} (all day)` : fullFmt.format(r.dueMs);
}

export const reminderTime = (r: Reminder) =>
  r.dueMs === null ? "" : r.allDay ? "All day" : timeFmt.format(r.dueMs);

/** The line shown under a reply. */
export function reminderChangeLabel(c: ReminderChange) {
  const t = c.item?.title ?? "";
  const when = c.item ? dueText(c.item) : "";
  switch (c.kind) {
    case "created":
      return c.item?.dueMs === null ? `To-do added: ${t}` : `Reminder set: ${t} · ${when}`;
    case "completed":
      return `Done: ${t}`;
    case "rescheduled":
      return `Moved: ${t} · ${when}`;
    case "confirmDelete":
      return `Delete "${t}"? Confirm under Needs you`;
    default:
      return `Not changed. ${c.note ?? ""}`;
  }
}

/** Overdue: a timed reminder past its time, or an all-day one from an earlier day. */
export function isOverdue(r: Reminder, now: number) {
  if (r.dueMs === null || r.completed) return false;
  return r.allDay ? r.dueMs < startOfDay(new Date(now)).getTime() : r.dueMs < now;
}

/** Snooze 1 hour: an hour from its time (or from now, if it's already past). All-day ones move a day. */
export function snoozedDue(r: Reminder, now: number): Due {
  if (r.allDay && r.dueMs !== null) {
    const d = new Date(Math.max(r.dueMs, startOfDay(new Date(now)).getTime()));
    return { ms: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(), allDay: true };
  }
  return { ms: Math.max(r.dueMs ?? now, now) + HOUR, allDay: false };
}

function useStoredSet(key: string) {
  const [set, setSet] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify([...set].slice(-500)));
    } catch {
      /* storage unavailable: keep it for this run only */
    }
  }, [key, set]);
  return [set, setSet] as const;
}

export interface RemindersState {
  access: RemindersAccess | null;
  lists: ReminderList[];
  defaultListId: string | null;
  /** Open reminders and to-dos in lists that aren't hidden, plus ones ticked this session. */
  items: Reminder[];
  checkedAt: Date | null;
  error: string;
  hidden: Set<string>;
  toggleHidden: (listId: string) => void;
  refresh: () => Promise<void>;
  requestAccess: () => Promise<void>;
  openSettings: () => Promise<void>;
  toggleDone: (r: Reminder) => Promise<void>;
  snooze: (r: Reminder) => Promise<void>;
  /** Overdue alerts the user dismissed (id + due, so a rescheduled one can alert again). */
  isDismissed: (r: Reminder) => boolean;
  dismiss: (r: Reminder) => void;
}

export function useReminders(): RemindersState {
  const [access, setAccess] = useState<RemindersAccess | null>(null);
  const [lists, setLists] = useState<ReminderList[]>([]);
  const [defaultListId, setDefaultListId] = useState<string | null>(null);
  const [open, setOpen] = useState<Reminder[]>([]);
  // Ticked this session: still shown, struck through, so ↺ can undo.
  const [ticked, setTicked] = useState<Map<string, Reminder>>(new Map());
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const [hidden, setHidden] = useStoredSet(HIDDEN_KEY);
  const [dismissed, setDismissed] = useStoredSet(DISMISSED_KEY);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const status = await invoke<RemindersAccess>("reminders_status");
      setAccess(status);
      if (status !== "granted") {
        setLists([]);
        setOpen([]);
        return;
      }
      const data = await invoke<{
        lists: ReminderList[];
        items: Reminder[];
        defaultListId: string | null;
      }>("fetch_reminders");
      setLists(data.lists);
      setDefaultListId(data.defaultListId);
      setOpen(data.items);
      setCheckedAt(new Date());
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const requestAccess = useCallback(async () => {
    try {
      setAccess(await invoke<RemindersAccess>("request_reminders_access"));
    } catch (e) {
      setError(String(e));
    }
    await refresh();
  }, [refresh]);

  const openSettings = useCallback(async () => {
    await invoke("open_reminders_settings").catch((e) => setError(String(e)));
  }, []);

  const toggleHidden = useCallback(
    (id: string) =>
      setHidden((h) => {
        const next = new Set(h);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [setHidden],
  );

  const run = useCallback(
    async (f: () => Promise<unknown>) => {
      try {
        await f();
        setError("");
      } catch (e) {
        setError(String(e));
      }
      await refresh();
    },
    [refresh],
  );

  const toggleDone = useCallback(
    (r: Reminder) =>
      run(async () => {
        const updated = await completeReminder(r.id, !r.completed);
        setTicked((t) => {
          const next = new Map(t);
          if (updated.completed) next.set(r.id, updated);
          else next.delete(r.id);
          return next;
        });
      }),
    [run],
  );

  const snooze = useCallback(
    (r: Reminder) => run(() => setReminderDue(r.id, snoozedDue(r, Date.now()))),
    [run],
  );

  const keyOf = (r: Reminder) => `${r.id}@${r.dueMs}`;
  const isDismissed = useCallback((r: Reminder) => dismissed.has(keyOf(r)), [dismissed]);
  const dismiss = useCallback(
    (r: Reminder) => setDismissed((d) => new Set(d).add(keyOf(r))),
    [setDismissed],
  );

  const openIds = new Set(open.map((r) => r.id));
  const items = [...open, ...[...ticked.values()].filter((r) => !openIds.has(r.id))].filter(
    (r) => !hidden.has(r.listId),
  );

  return {
    access,
    lists,
    defaultListId,
    items,
    checkedAt,
    error,
    hidden,
    toggleHidden,
    refresh,
    requestAccess,
    openSettings,
    toggleDone,
    snooze,
    isDismissed,
    dismiss,
  };
}
