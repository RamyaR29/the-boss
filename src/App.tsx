import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import {
  askBoss,
  isStale,
  listSessions,
  loadSession,
  newSession,
  saveSession,
  SESSION_IDLE_MS,
  type ChatMessage,
  type Session,
} from "./chat";
import { invoke } from "@tauri-apps/api/core";
import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { Elephant, type CharacterState } from "./Elephant";
import { voiceFor } from "./language";
import { useCalendar } from "./calendar";
import { dayLabel, dueSoon, itemTime, openCanvasLink, useCanvas } from "./canvas";
import { undoChange, useMemory } from "./memory";
import type { NeedsYouItem } from "./needsYou";
import { TodayPanel } from "./TodayPanel";
import "./App.css";
import "./Elephant.css";

// Window geometry, in logical (point) units.
const CHAR_W = 160;
const CHAR_H = 180;
const PANEL_W = 340;
const PANEL_H = 560;
const GAP = 8;
const OPEN_W = CHAR_W + GAP + PANEL_W;
const DRAG_THRESHOLD = 4;
const SLEEP_AFTER_MS = 15 * 60 * 1000;
const STARE_EVERY_MS = 20 * 60 * 1000;

type Side = "left" | "right";

const lastId = (msgs: ChatMessage[]) => (msgs.length ? msgs[msgs.length - 1].id : 0);

// Small per-device preferences (mute, quiet) survive restarts via localStorage.
function usePref(key: string, initial: boolean) {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? initial : v === "1";
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, value ? "1" : "0");
    } catch {
      /* storage unavailable: keep it for this run only */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

const speak = (text: string, voice: string) => invoke<void>("speak", { text, voice });
const stopSpeaking = () => invoke<void>("stop_speaking");

export default function App() {
  const [state, setState] = useState<CharacterState>("idle");
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<Side>("left");
  const [charTop, setCharTop] = useState(0);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const [session, setSession] = useState<Session>(newSession);
  const [pending, setPending] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const moodTimer = useRef<number | undefined>(undefined);
  const messages = session.messages;

  // ---------- moods ----------
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /** Show a mood for a while, then go back to idle (unless something else took over). */
  const flash = useCallback((mood: CharacterState, ms: number) => {
    window.clearTimeout(moodTimer.current);
    setState(mood);
    moodTimer.current = window.setTimeout(
      () => setState((s) => (s === mood ? "idle" : s)),
      ms,
    );
  }, []);

  // Any interaction counts as activity and wakes a sleeping elephant.
  const lastActivity = useRef(Date.now());
  const touch = useCallback(() => {
    lastActivity.current = Date.now();
    if (stateRef.current === "sleeping") setState("idle");
  }, []);

  const celebrate = useCallback(() => {
    touch();
    flash("celebrating", 2200);
  }, [flash, touch]);

  // What The Boss remembers about the user (memory.json on this Mac).
  const memory = useMemory();

  // Events from the Mac's Calendar app, refreshed every 5 minutes and whenever the panel opens.
  const calendar = useCalendar();
  const refreshCalendar = calendar.refresh;
  useEffect(() => {
    if (open) refreshCalendar();
  }, [open, refreshCalendar]);

  // Real Canvas deadlines, refreshed hourly even while the panel is closed.
  const canvas = useCanvas();
  // A clock that ticks every minute, so deadlines move into the 24-hour alert window on time.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const canvasAlerts = useMemo<NeedsYouItem[]>(
    () =>
      dueSoon(canvas, now).map((i) => ({
        id: `canvas:${i.uid}`,
        canvasUid: i.uid,
        kind: "alert",
        text: `${i.title}${i.course ? ` (${i.course})` : ""} is due ${dayLabel(new Date(i.startMs)).toLowerCase()}${i.allDay ? "" : ` at ${itemTime(i)}`}.`,
        primary: i.url ? "Open in Canvas" : "Got it",
        secondary: "Dismiss",
      })),
    [canvas, now],
  );

  const needsYou = canvasAlerts;
  const resolveNeed = useCallback(
    (id: string, accepted: boolean) => {
      const alert = canvasAlerts.find((a) => a.id === id);
      if (alert?.canvasUid) {
        const item = canvas.items.find((i) => i.uid === alert.canvasUid);
        // "Open in Canvas" keeps the alert until you tick the item done or dismiss it.
        if (accepted && item?.url) openCanvasLink(item.url);
        else canvas.dismiss(alert.canvasUid);
      }
    },
    [canvas, canvasAlerts],
  );
  const [muted, setMuted] = usePref("boss.muted", false);
  const [quiet, setQuiet] = usePref("boss.quiet", false);
  const silent = muted || quiet;

  // Turning on mute or quiet stops any reply that is being spoken.
  useEffect(() => {
    if (silent) {
      stopSpeaking().catch(() => {});
      setState((s) => (s === "talking" ? "idle" : s));
    }
  }, [silent]);
  useEffect(() => {
    if (quiet) setBubble(null);
  }, [quiet]);

  // Fall asleep after a quiet stretch while the panel is closed.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (
        stateRef.current === "idle" &&
        !openRef.current &&
        Date.now() - lastActivity.current > SLEEP_AFTER_MS
      ) {
        setState("sleeping");
      }
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // "You forgot something": when an urgent alert is waiting and the panel is closed,
  // stare straight at the user for a few seconds, at most once every 20 minutes.
  const lastStare = useRef(0);
  const hasAlert = needsYou.some((n) => n.kind === "alert");
  useEffect(() => {
    if (!hasAlert) return;
    const check = () => {
      if (
        stateRef.current === "idle" &&
        !openRef.current &&
        Date.now() - lastStare.current > STARE_EVERY_MS
      ) {
        lastStare.current = Date.now();
        flash("staring", 6000);
      }
    };
    const first = window.setTimeout(check, 5000);
    const id = window.setInterval(check, 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [hasAlert, flash]);

  // On launch, continue the most recent chat if it was active in the last 30 minutes.
  useEffect(() => {
    listSessions()
      .then(async (all) => {
        const latest = all[0];
        if (latest && Date.now() - latest.lastAt <= SESSION_IDLE_MS) {
          setSession(await loadSession(latest.id));
        }
      })
      .catch((e) => console.error("Couldn't load chats:", e));
  }, []);

  // Save the current chat after every change, so quitting never loses it.
  useEffect(() => {
    if (session.messages.length === 0) return;
    saveSession(session).catch((e) => console.error("Couldn't save chat:", e));
  }, [session]);

  const startNewChat = useCallback(() => {
    setSession(newSession());
    setBubble(null);
    stopSpeaking().catch(() => {});
  }, []);

  const ask = useCallback(
    async (text: string, context: string) => {
      // After 30 quiet minutes, this question starts a fresh chat.
      const base = isStale(session) ? newSession() : session;
      const nextId = lastId(base.messages) + 1;
      const userMsg: ChatMessage = { id: nextId, role: "user", text };
      const withUser = [...base.messages, userMsg];
      const add = (msg: Omit<ChatMessage, "id">) =>
        setSession((s) => ({
          ...s,
          lastAt: Date.now(),
          messages: [...s.messages, { ...msg, id: lastId(s.messages) + 1 }],
        }));

      setSession({ ...base, lastAt: Date.now(), messages: withUser });
      setPending(true);
      setBubble(null);
      touch();
      window.clearTimeout(moodTimer.current);
      setState("thinking");
      // After talking, look pleased for a moment, then settle.
      const afterTalking = () => {
        if (stateRef.current === "talking") flash("happy", 1800);
      };
      try {
        const { text: reply, memory: changes } = await askBoss(withUser, context, [...calendar.hidden]);
        add({ role: "model", text: reply, ...(changes.length ? { memory: changes } : {}) });
        if (changes.length) memory.reload();
        if (!quiet) setBubble(reply);
        setState("talking");
        if (silent) {
          // No voice: talk for roughly as long as it takes to read the reply.
          const ms = Math.min(8000, 1500 + reply.length * 40);
          moodTimer.current = window.setTimeout(afterTalking, ms);
        } else {
          // Talk exactly while the voice speaks: Samantha for English, Vani for Tamil/Tanglish.
          speak(reply, voiceFor(reply))
            .catch((e) => console.error("Voice failed:", e))
            .finally(afterTalking);
        }
      } catch (e) {
        add({ role: "model", text: String(e), error: true });
        flash("confused", 3000);
      } finally {
        setPending(false);
        lastActivity.current = Date.now();
      }
    },
    [session, quiet, silent, touch, flash, memory, calendar.hidden],
  );

  /** Undo one memory change shown under a reply, and mark it undone in the chat. */
  const undoMemory = useCallback(
    async (messageId: number, index: number) => {
      const change = session.messages.find((m) => m.id === messageId)?.memory?.[index];
      if (!change || change.undone) return;
      await undoChange(change);
      await memory.reload();
      setSession((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === messageId && m.memory
            ? { ...m, memory: m.memory.map((c, i) => (i === index ? { ...c, undone: true } : c)) }
            : m,
        ),
      }));
    },
    [session, memory],
  );

  // Where the character window sat before the panel opened, so closing puts it back.
  const closedPos = useRef<{ x: number; y: number } | null>(null);
  const pointer = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  const busy = useRef(false);

  const openPanel = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const win = getCurrentWindow();
      const sf = await win.scaleFactor();
      const pos = (await win.outerPosition()).toLogical(sf);
      const mon = await currentMonitor();
      const monX = mon ? mon.position.x / sf : 0;
      const monY = mon ? mon.position.y / sf : 0;
      const monH = mon ? mon.size.height / sf : 900;

      // Open toward whichever side has room; prefer the left.
      const nextSide: Side = pos.x - GAP - PANEL_W >= monX ? "left" : "right";
      const x = nextSide === "left" ? pos.x - GAP - PANEL_W : pos.x;
      // Keep the panel on screen vertically; the character stays where it was.
      const y = Math.max(monY, Math.min(pos.y, monY + monH - PANEL_H));
      const height = Math.max(PANEL_H, pos.y - y + CHAR_H);

      closedPos.current = { x: pos.x, y: pos.y };
      // Coming back after 30 quiet minutes shows a fresh chat.
      setSession((s) => (isStale(s) ? newSession() : s));
      setSide(nextSide);
      setCharTop(pos.y - y);
      await win.setSize(new LogicalSize(OPEN_W, height));
      await win.setPosition(new LogicalPosition(x, y));
      setOpen(true);
    } finally {
      busy.current = false;
    }
  }, []);

  const closePanel = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const win = getCurrentWindow();
      setOpen(false);
      setBubble(null);
      const sf = await win.scaleFactor();
      const pos = (await win.outerPosition()).toLogical(sf);
      // If the user dragged while open, keep the character where it now is.
      const x = side === "left" ? pos.x + GAP + PANEL_W : pos.x;
      const y = pos.y + charTop;
      await win.setSize(new LogicalSize(CHAR_W, CHAR_H));
      await win.setPosition(new LogicalPosition(x, y));
      closedPos.current = null;
      setCharTop(0);
    } finally {
      busy.current = false;
    }
  }, [side, charTop]);

  const toggle = useCallback(() => (open ? closePanel() : openPanel()), [open, openPanel, closePanel]);

  // Escape or clicking another app closes the panel. While a question is pending the
  // panel stays open, so a macOS Keychain prompt taking focus doesn't hide the answer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closePanel();
    window.addEventListener("keydown", onKey);
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused && !pending) closePanel();
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      unlisten.then((f) => f());
    };
  }, [open, closePanel, pending]);

  // Right-click: the native macOS menu.
  const onContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    pointer.current = null;
    const menu = await Menu.new({
      items: [
        await CheckMenuItem.new({
          text: "Mute voice",
          checked: muted,
          action: () => setMuted(!muted),
        }),
        await CheckMenuItem.new({
          text: "Quiet mode",
          checked: quiet,
          action: () => setQuiet(!quiet),
        }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await MenuItem.new({ text: "New chat", action: startNewChat }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await MenuItem.new({ text: "Quit The Boss", action: () => invoke("quit_app") }),
      ],
    });
    await menu.popup();
  };

  // Click opens/closes the panel; dragging moves the character without opening it.
  const onPointerDown = (e: React.PointerEvent) => {
    touch();
    if (e.button !== 0) return;
    pointer.current = { x: e.screenX, y: e.screenY, dragged: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointer.current;
    if (!p || p.dragged) return;
    if (Math.hypot(e.screenX - p.x, e.screenY - p.y) > DRAG_THRESHOLD) {
      p.dragged = true;
      getCurrentWindow().startDragging();
    }
  };
  const onPointerUp = () => {
    const p = pointer.current;
    pointer.current = null;
    if (p && !p.dragged) toggle();
  };

  return (
    <div className={`app ${open ? "is-open" : ""} side-${side}`}>
      {open && (
        <TodayPanel
          state={state}
          onStateChange={(s) => {
            window.clearTimeout(moodTimer.current);
            setState(s);
          }}
          onCelebrate={celebrate}
          messages={messages}
          pending={pending}
          onAsk={ask}
          sessionId={session.id}
          onNewChat={startNewChat}
          needsYou={needsYou}
          onResolve={resolveNeed}
          canvas={canvas}
          calendar={calendar}
          memory={memory}
          onUndoMemory={undoMemory}
          muted={muted}
          onMutedChange={setMuted}
          quiet={quiet}
          onQuietChange={setQuiet}
        />
      )}
      <div className="character-column" style={{ marginTop: open ? charTop : 0 }}>
        <div
          className="character"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onContextMenu={onContextMenu}
          title="Click to open Today · drag to move · right-click for menu"
        >
          <Elephant state={state} />
          {needsYou.length > 0 && (
            <span className="badge" aria-label={`${needsYou.length} items need you`}>
              {needsYou.length}
            </span>
          )}
        </div>
        {open && bubble && (
          <div className="bubble" onClick={() => setBubble(null)} title="Click to dismiss">
            {bubble}
          </div>
        )}
      </div>
    </div>
  );
}
