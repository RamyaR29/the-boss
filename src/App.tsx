import { useCallback, useEffect, useRef, useState } from "react";
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
import { mockNeedsYou } from "./mockData";
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
  const [session, setSession] = useState<Session>(newSession);
  const [pending, setPending] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const talkTimer = useRef<number | undefined>(undefined);
  const messages = session.messages;
  const [needsYou, setNeedsYou] = useState(mockNeedsYou);
  const resolveNeed = useCallback(
    (id: string) => setNeedsYou((items) => items.filter((i) => i.id !== id)),
    [],
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
      window.clearTimeout(talkTimer.current);
      setState("thinking");
      try {
        const reply = await askBoss(withUser, context);
        add({ role: "model", text: reply });
        if (!quiet) setBubble(reply);
        setState("talking");
        if (silent) {
          // No voice: talk for roughly as long as it takes to read the reply.
          const ms = Math.min(8000, 1500 + reply.length * 40);
          talkTimer.current = window.setTimeout(() => setState("idle"), ms);
        } else {
          // Talk exactly while the voice speaks: Samantha for English, Vani for Tamil/Tanglish.
          speak(reply, voiceFor(reply))
            .catch((e) => console.error("Voice failed:", e))
            .finally(() => setState((s) => (s === "talking" ? "idle" : s)));
        }
      } catch (e) {
        add({ role: "model", text: String(e), error: true });
        setState("idle");
      } finally {
        setPending(false);
      }
    },
    [session, quiet, silent],
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
          onStateChange={setState}
          messages={messages}
          pending={pending}
          onAsk={ask}
          sessionId={session.id}
          onNewChat={startNewChat}
          needsYou={needsYou}
          onResolve={resolveNeed}
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
