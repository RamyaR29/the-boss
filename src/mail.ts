import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Reminder } from "./reminders";

/** One email The Boss has seen (text stays on the Rust side). */
export interface MailItem {
  key: string;
  from: string;
  subject: string;
  dateMs: number;
  account: string;
  triaged: boolean;
  needsAttention: boolean;
  urgent: boolean;
  summary: string;
  reminders: Reminder[];
  skipped: string[];
  done: boolean;
}

export type MailStatus = "ok" | "never" | "noPermission" | "error";

interface MailStateData {
  status: MailStatus;
  error: string | null;
  lastCheckedMs: number;
  newCount: number;
  items: MailItem[];
}

/** Check mail this often while the app runs. */
const CHECK_EVERY_MS = 60 * 60 * 1000;

export interface MailState {
  status: MailStatus | null;
  error: string;
  checking: boolean;
  lastChecked: Date | null;
  newCount: number;
  items: MailItem[];
  /** Emails that need the user and aren't marked done. */
  attention: MailItem[];
  checkNow: () => Promise<void>;
  markDone: (key: string, done: boolean) => Promise<void>;
  open: (key: string) => Promise<void>;
  openSettings: () => Promise<void>;
  /** Removes a reminder made from an email (Undo). */
  undoReminder: (key: string, reminderId: string) => Promise<void>;
}

/** "Prof Lee <lee@school.edu>" → "Prof Lee". */
export function senderName(from: string) {
  const name = from.replace(/<[^>]*>/, "").replace(/"/g, "").trim();
  return name || from.replace(/[<>]/g, "").trim();
}

export function useMail(onChecked?: () => void): MailState {
  const [data, setData] = useState<MailStateData | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const onCheckedRef = useRef(onChecked);
  onCheckedRef.current = onChecked;

  const lastChecked = useRef(0);
  const apply = (d: MailStateData) => {
    setData(d);
    setError(d.error ?? "");
    lastChecked.current = d.lastCheckedMs;
  };

  const checkNow = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      apply(await invoke<MailStateData>("check_mail"));
      onCheckedRef.current?.();
    } catch (e) {
      setError(String(e));
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }, []);

  // Show what's saved right away; check whenever the last check is an hour old.
  useEffect(() => {
    const checkIfDue = () => {
      if (Date.now() - lastChecked.current >= CHECK_EVERY_MS) checkNow();
    };
    invoke<MailStateData>("mail_state")
      .then((d) => {
        apply(d);
        checkIfDue();
      })
      .catch((e) => setError(String(e)));
    const id = window.setInterval(checkIfDue, 60_000);
    return () => window.clearInterval(id);
  }, [checkNow]);

  const markDone = useCallback(async (key: string, done: boolean) => {
    try {
      apply(await invoke<MailStateData>("mark_mail_done", { key, done }));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const open = useCallback(async (key: string) => {
    await invoke("open_mail", { key }).catch((e) => setError(String(e)));
  }, []);

  const openSettings = useCallback(async () => {
    await invoke("open_full_disk_settings").catch((e) => setError(String(e)));
  }, []);

  const undoReminder = useCallback(async (key: string, reminderId: string) => {
    try {
      await invoke("delete_reminder", { id: reminderId }).catch(() => {
        /* already gone from Reminders: just forget it */
      });
      apply(await invoke<MailStateData>("forget_mail_reminder", { key, reminderId }));
      onCheckedRef.current?.();
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const items = data?.items ?? [];
  return {
    status: data?.status ?? null,
    error,
    checking,
    lastChecked: data && data.lastCheckedMs > 0 ? new Date(data.lastCheckedMs) : null,
    newCount: data?.newCount ?? 0,
    items,
    attention: items.filter((i) => i.needsAttention && !i.done),
    checkNow,
    markDone,
    open,
    openSettings,
    undoReminder,
  };
}
