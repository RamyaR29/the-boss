import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DAYS_AHEAD, startOfDay } from "./canvas";

export interface CalendarInfo {
  id: string;
  title: string;
  /** The account, e.g. "iCloud" or a Google address. */
  account: string;
}

/** One occurrence of an event from the Mac's Calendar app (read by the Rust side). */
export interface CalendarEvent {
  uid: string;
  title: string;
  calendarId: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  location: string | null;
}

export type CalendarAccess = "notDetermined" | "granted" | "denied" | "restricted" | "writeOnly";

/** Re-read the calendar this often (it's local, so this is cheap). */
const REFRESH_MS = 5 * 60 * 1000;
const HIDDEN_KEY = "boss.calendar.hidden";

export interface CalendarState {
  /** null while the first check runs */
  access: CalendarAccess | null;
  calendars: CalendarInfo[];
  /** Events in calendars that aren't hidden. */
  events: CalendarEvent[];
  checkedAt: Date | null;
  error: string;
  hidden: Set<string>;
  toggleHidden: (calendarId: string) => void;
  refresh: () => Promise<void>;
  requestAccess: () => Promise<void>;
  openSettings: () => Promise<void>;
  calendarTitle: (id: string) => string;
}

export function useCalendar(): CalendarState {
  const [access, setAccess] = useState<CalendarAccess | null>(null);
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [allEvents, setAllEvents] = useState<CalendarEvent[]>([]);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
    } catch {
      /* storage unavailable: keep it for this run only */
    }
  }, [hidden]);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const status = await invoke<CalendarAccess>("calendar_status");
      setAccess(status);
      if (status !== "granted") {
        setCalendars([]);
        setAllEvents([]);
        return;
      }
      // Today plus the next DAYS_AHEAD days, in local time.
      const from = startOfDay(new Date());
      const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + DAYS_AHEAD + 1);
      const data = await invoke<{ calendars: CalendarInfo[]; events: CalendarEvent[] }>(
        "fetch_calendar",
        { fromMs: from.getTime(), toMs: to.getTime() },
      );
      setCalendars(data.calendars);
      setAllEvents(data.events);
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
      setAccess(await invoke<CalendarAccess>("request_calendar_access"));
    } catch (e) {
      setError(String(e));
    }
    await refresh();
  }, [refresh]);

  const openSettings = useCallback(async () => {
    await invoke("open_calendar_settings").catch((e) => setError(String(e)));
  }, []);

  const toggleHidden = useCallback(
    (id: string) =>
      setHidden((h) => {
        const next = new Set(h);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const calendarTitle = useCallback(
    (id: string) => calendars.find((c) => c.id === id)?.title ?? "Calendar",
    [calendars],
  );

  return {
    access,
    calendars,
    events: allEvents.filter((e) => !hidden.has(e.calendarId)),
    checkedAt,
    error,
    hidden,
    toggleHidden,
    refresh,
    requestAccess,
    openSettings,
    calendarTitle,
  };
}

// ---------- display ----------

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export const eventTime = (e: CalendarEvent) => (e.allDay ? "All day" : timeFmt.format(e.startMs));

/** "until 11:30 AM" for timed events. */
export const eventUntil = (e: CalendarEvent) => (e.allDay ? "" : `until ${timeFmt.format(e.endMs)}`);

/**
 * Which items clash: timed events that overlap each other, and Canvas deadlines that fall
 * inside a timed event. All-day events never clash. Returns uid → titles it clashes with.
 */
export function findClashes(
  events: CalendarEvent[],
  deadlines: { uid: string; title: string; atMs: number }[],
) {
  const clashes = new Map<string, string[]>();
  const add = (uid: string, title: string) => clashes.set(uid, [...(clashes.get(uid) ?? []), title]);
  const timed = events.filter((e) => !e.allDay && e.endMs > e.startMs);
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      if (a.startMs < b.endMs && b.startMs < a.endMs) {
        add(a.uid, b.title);
        add(b.uid, a.title);
      }
    }
    for (const d of deadlines) {
      const e = timed[i];
      if (d.atMs > e.startMs && d.atMs < e.endMs) {
        add(e.uid, d.title);
        add(d.uid, e.title);
      }
    }
  }
  return clashes;
}
