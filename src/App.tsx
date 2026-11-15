import { useCallback, useEffect, useRef, useState } from "react";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import { Elephant, type CharacterState } from "./Elephant";
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

export default function App() {
  const [state, setState] = useState<CharacterState>("idle");
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<Side>("left");
  const [charTop, setCharTop] = useState(0);

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

  // Escape or clicking another app closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closePanel();
    window.addEventListener("keydown", onKey);
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) closePanel();
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      unlisten.then((f) => f());
    };
  }, [open, closePanel]);

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
      {open && <TodayPanel state={state} onStateChange={setState} />}
      <div
        className="character"
        style={{ marginTop: open ? charTop : 0 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Click to open Today · drag to move"
      >
        <Elephant state={state} />
      </div>
    </div>
  );
}
