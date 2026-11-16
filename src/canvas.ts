import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** One item from the Canvas calendar feed (read by the Rust side). */
export interface CanvasItem {
  uid: string;
  /** "assignment" has a due time; "event" is a course calendar event. */
  kind: "assignment" | "event";
  title: string;
  course: string | null;
  startMs: number;
  allDay: boolean;
  url: string | null;
}

/** Re-read the feed this often while the app runs. */
const REFRESH_MS = 60 * 60 * 1000;
/** Canvas assignments due within this window become "Needs you" alerts. */
export const ALERT_WITHIN_MS = 24 * 60 * 60 * 1000;
/** Today plus this many following days are shown. */
export const DAYS_AHEAD = 7;

// ---------- calls to Rust (the feed link itself never comes back here) ----------

const fetchCanvas = () => invoke<CanvasItem[] | null>("fetch_canvas");
const saveCanvasFeed = (link: string) => invoke<CanvasItem[]>("save_canvas_feed", { link });
const deleteCanvasFeed = () => invoke<void>("delete_canvas_feed");
export const openCanvasLink = (url: string) =>
  invoke<void>("open_canvas_link", { url }).catch((e) => console.error("Couldn't open Canvas:", e));

// ---------- remembered ticks and dismissals (this Mac only) ----------

function useUidSet(key: string) {
  const [set, setSet] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      // Keep only the newest few hundred so this never grows forever.
      localStorage.setItem(key, JSON.stringify([...set].slice(-500)));
    } catch {
      /* storage unavailable: keep it for this run only */
    }
  }, [key, set]);
  const toggle = useCallback(
    (uid: string, on?: boolean) =>
      setSet((s) => {
        const next = new Set(s);
        if (on ?? !next.has(uid)) next.add(uid);
        else next.delete(uid);
        return next;
      }),
    [],
  );
  return [set, toggle] as const;
}

export interface CanvasState {
  /** null while the first check is running */
  connected: boolean | null;
  items: CanvasItem[];
  checking: boolean;
  checkedAt: Date | null;
  error: string;
  refresh: () => Promise<void>;
  connect: (link: string) => Promise<void>;
  disconnect: () => Promise<void>;
  done: Set<string>;
  toggleDone: (uid: string) => void;
  dismissed: Set<string>;
  dismiss: (uid: string) => void;
}

export function useCanvas(): CanvasState {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const [done, toggleDone] = useUidSet("boss.canvas.done");
  const [dismissed, toggleDismissed] = useUidSet("boss.canvas.dismissed");
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      const result = await fetchCanvas();
      setConnected(result !== null);
      setItems(result ?? []);
      setError("");
      if (result) setCheckedAt(new Date());
    } catch (e) {
      // Keep the last good list; just say what went wrong.
      setConnected(true);
      setError(String(e));
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const connect = useCallback(async (link: string) => {
    setChecking(true);
    try {
      const result = await saveCanvasFeed(link);
      setItems(result);
      setConnected(true);
      setCheckedAt(new Date());
      setError("");
    } finally {
      setChecking(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await deleteCanvasFeed();
    setConnected(false);
    setItems([]);
    setCheckedAt(null);
    setError("");
  }, []);

  const dismiss = useCallback((uid: string) => toggleDismissed(uid, true), [toggleDismissed]);

  return {
    connected,
    items,
    checking,
    checkedAt,
    error,
    refresh,
    connect,
    disconnect,
    done,
    toggleDone,
    dismissed,
    dismiss,
  };
}

// ---------- dates ----------

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
const fullFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const fullDayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

/** "Today", "Tomorrow" or "Wednesday, Nov 18". */
export function dayLabel(d: Date, now = new Date()) {
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return dayFmt.format(d);
}

export const itemTime = (i: CanvasItem) => (i.allDay ? "All day" : timeFmt.format(i.startMs));

/** Full date and time, for Gemini. */
export const itemWhen = (i: CanvasItem) =>
  i.allDay ? `${fullDayFmt.format(i.startMs)}, all day` : fullFmt.format(i.startMs);

export const canvasLabel = (i: CanvasItem) => (i.kind === "assignment" ? "Canvas" : "Canvas event");

/** The moment something is due: an all-day assignment counts until the end of its day. */
export const dueMs = (i: CanvasItem) => (i.allDay ? addDays(new Date(i.startMs), 1).getTime() - 1 : i.startMs);

/** Splits items into today and each of the next DAYS_AHEAD days. */
export function splitByDay(items: CanvasItem[], now = new Date()) {
  const today0 = startOfDay(now).getTime();
  const tomorrow0 = addDays(now, 1).getTime();
  const end = addDays(now, DAYS_AHEAD + 1).getTime();
  const today = items.filter((i) => i.startMs >= today0 && i.startMs < tomorrow0);
  const later = items.filter((i) => i.startMs >= tomorrow0 && i.startMs < end);
  const groups: { label: string; items: CanvasItem[] }[] = [];
  for (const i of later) {
    const label = dayLabel(new Date(i.startMs), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(i);
    else groups.push({ label, items: [i] });
  }
  return { today, later, groups };
}

/** Assignments due within the next 24 hours that aren't ticked or dismissed. */
export function dueSoon(c: CanvasState, now: number) {
  return c.items.filter(
    (i) =>
      i.kind === "assignment" &&
      !c.done.has(i.uid) &&
      !c.dismissed.has(i.uid) &&
      dueMs(i) > now &&
      dueMs(i) - now <= ALERT_WITHIN_MS,
  );
}
