import { useEffect, useRef, useState } from "react";
import { ApiKeySettings } from "./ApiKeySettings";
import {
  canvasLabel,
  DAYS_AHEAD,
  itemTime,
  itemWhen,
  openCanvasLink,
  splitByDay,
  type CanvasItem,
  type CanvasState,
} from "./canvas";
import { CanvasSettings } from "./CanvasSettings";
import { changeLabel, type MemoryState } from "./memory";
import { MemorySection } from "./MemorySection";
import { detectLanguage } from "./language";
import { PastChats } from "./PastChats";
import type { ChatMessage } from "./chat";
import { CHARACTER_STATES, type CharacterState } from "./Elephant";
import {
  mockRecently,
  mockToday,
  sourceLabel,
  type NeedsYouItem,
  type TodayItem,
} from "./mockData";

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });


const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

interface Props {
  state: CharacterState;
  onStateChange: (s: CharacterState) => void;
  messages: ChatMessage[];
  pending: boolean;
  onAsk: (text: string, context: string) => void;
  sessionId: string;
  onNewChat: () => void;
  needsYou: NeedsYouItem[];
  onResolve: (id: string, accepted: boolean) => void;
  onCelebrate: () => void;
  muted: boolean;
  onMutedChange: (v: boolean) => void;
  quiet: boolean;
  onQuietChange: (v: boolean) => void;
  canvas: CanvasState;
  memory: MemoryState;
  onUndoMemory: (messageId: number, index: number) => Promise<void>;
}

export function TodayPanel({
  state,
  onStateChange,
  messages,
  pending,
  onAsk,
  sessionId,
  onNewChat,
  needsYou,
  onResolve: resolve,
  onCelebrate,
  muted,
  onMutedChange,
  quiet,
  onQuietChange,
  canvas,
  memory,
  onUndoMemory,
}: Props) {
  const [today, setToday] = useState<(TodayItem & { done?: boolean })[]>(mockToday);
  const [ask, setAsk] = useState("");
  const [idea, setIdea] = useState("");
  const [parked, setParked] = useState<string[]>([]);

  const markDone = (id: string) => {
    const item = today.find((i) => i.id === id);
    if (item && !item.done) onCelebrate();
    setToday((items) => items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  };
  const snooze = (id: string) =>
    setToday((items) =>
      items
        .map((i) => (i.id === id ? { ...i, at: new Date(i.at.getTime() + 60 * 60 * 1000) } : i))
        .sort((a, b) => a.at.getTime() - b.at.getTime()),
    );
  const parkIdea = () => {
    if (!idea.trim()) return;
    setParked((p) => [idea.trim(), ...p]);
    setIdea("");
  };

  const lang = detectLanguage(ask);

  // Real Canvas items: today's go in the Today list; the next 7 days go under "Coming up".
  const canvasDays = splitByDay(canvas.items);
  type Row =
    | { kind: "mock"; at: number; item: TodayItem & { done?: boolean } }
    | { kind: "canvas"; at: number; item: CanvasItem };
  const todayRows: Row[] = [
    ...today.map((item): Row => ({ kind: "mock", at: item.at.getTime(), item })),
    ...canvasDays.today.map((item): Row => ({ kind: "canvas", at: item.startMs, item })),
  ].sort((a, b) => a.at - b.at);

  const canvasLine = (i: CanvasItem) =>
    `${i.kind === "assignment" ? "Canvas assignment due" : "Canvas course event"} · ${i.title}` +
    `${i.course ? ` (${i.course})` : ""}${canvas.done.has(i.uid) ? " (marked done)" : ""}`;

  // What The Boss knows about today and the coming week, sent with each question.
  const buildContext = () => {
    const lines = [`Now: ${dateFmt.format(new Date())}`, "", "Today:"];
    for (const r of todayRows) {
      if (r.kind === "mock") {
        const t = r.item;
        lines.push(
          `- ${timeFmt.format(t.at)} · ${sourceLabel[t.source]} · ${t.title}${t.done ? " (done)" : ""}`,
        );
      } else {
        lines.push(`- ${itemTime(r.item)} · ${canvasLine(r.item)}`);
      }
    }
    lines.push("", `Canvas, the next ${DAYS_AHEAD} days after today:`);
    if (canvas.connected === false) {
      lines.push("- Canvas isn't connected yet (the user can add the feed link under Controls).");
    } else if (canvas.error && !canvas.checkedAt) {
      lines.push(`- Couldn't check Canvas: ${canvas.error}`);
    } else if (canvasDays.later.length === 0) {
      lines.push("- Nothing on Canvas.");
    } else {
      for (const i of canvasDays.later) lines.push(`- ${itemWhen(i)} · ${canvasLine(i)}`);
    }
    if (canvas.connected) {
      lines.push(
        "(Canvas data covers only today and the next " +
          `${DAYS_AHEAD} days. Calendar, reminder and to-do items are sample data for now.)`,
      );
    }
    if (needsYou.length) {
      lines.push("", "Waiting on the user:");
      for (const n of needsYou) lines.push(`- ${n.text}`);
    }
    return lines.join("\n");
  };

  const send = () => {
    const text = ask.trim();
    if (!text || pending) return;
    onAsk(text, buildContext());
    setAsk("");
  };

  const threadEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "nearest" });
  }, [messages, pending]);

  return (
    <div className="panel" role="dialog" aria-label="Today">
      <header className="panel-header">
        <h1>Today</h1>
        <span className="mock-tag" title="Canvas is real; calendar, reminders and to-dos are sample data">mock: calendar, to-dos</span>
      </header>

      <div className="panel-scroll">
        {needsYou.length > 0 && (
          <section>
            <h2>
              Needs you <span className="count">{needsYou.length}</span>
            </h2>
            {needsYou.map((n) => (
              <div key={n.id} className={`card card-${n.kind}`}>
                <p>{n.text}</p>
                <div className="card-actions">
                  <button className="btn-primary" onClick={() => resolve(n.id, true)}>
                    {n.primary}
                  </button>
                  <button onClick={() => resolve(n.id, false)}>{n.secondary}</button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section>
          <h2>Today</h2>
          <ul className="today-list">
            {todayRows.map((r) =>
              r.kind === "mock" ? (
                <li key={r.item.id} className={r.item.done ? "done" : ""}>
                  <span className="time">{timeFmt.format(r.item.at)}</span>
                  <span className="title">
                    {r.item.title}
                    <span className={`source source-${r.item.source}`}>
                      {sourceLabel[r.item.source]}
                    </span>
                  </span>
                  <span className="row-actions">
                    <button title={r.item.done ? "Undo" : "Done"} onClick={() => markDone(r.item.id)}>
                      {r.item.done ? "↺" : "✓"}
                    </button>
                    <button
                      title="Snooze 1 hour"
                      onClick={() => snooze(r.item.id)}
                      disabled={r.item.done}
                    >
                      ⏰
                    </button>
                  </span>
                </li>
              ) : (
                <CanvasRow key={r.item.uid} item={r.item} canvas={canvas} onCelebrate={onCelebrate} />
              ),
            )}
          </ul>
          {canvas.connected === false && (
            <p className="hint">Connect Canvas under Controls to see your real deadlines.</p>
          )}
        </section>

        {canvasDays.groups.length > 0 && (
          <section>
            <h2>Coming up</h2>
            {canvasDays.groups.map((g) => (
              <div key={g.label} className="day-group">
                <h3>{g.label}</h3>
                <ul className="today-list">
                  {g.items.map((i) => (
                    <CanvasRow key={i.uid} item={i} canvas={canvas} onCelebrate={onCelebrate} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}

        <section>
          <h2 className="h2-row">
            Ask
            {messages.length > 0 && (
              <button className="link" onClick={onNewChat} disabled={pending}>
                + New chat
              </button>
            )}
          </h2>
          {(messages.length > 0 || pending) && (
            <div className="thread">
              {messages.map((m) => (
                <div key={m.id} className="msg-wrap">
                  <div className={`msg msg-${m.role}${m.error ? " msg-error" : ""}`}>{m.text}</div>
                  {m.memory?.map((c, i) => (
                    <div key={i} className={`memory-note${c.undone ? " undone" : ""}`}>
                      🧠 {c.undone ? "Undone: " : ""}
                      {changeLabel(c)}
                      {c.kind !== "skipped" && !c.undone && (
                        <button
                          className="link"
                          onClick={() => onUndoMemory(m.id, i).catch((e) => console.error(e))}
                        >
                          Undo
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              {pending && <div className="msg msg-model msg-pending">…</div>}
              <div ref={threadEnd} />
            </div>
          )}
          <div className="input-row">
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="English, தமிழ், or Tanglish…"
            />
            <button onClick={send} disabled={!ask.trim() || pending}>
              Ask
            </button>
            <button title="Voice comes in a later slice" disabled>
              🎤
            </button>
          </div>
          {lang && <p className="hint">Detected: {lang}</p>}
        </section>

        <PastChats currentId={sessionId} />

        <MemorySection memory={memory} />

        <section>
          <h2>Park an idea</h2>
          <div className="input-row">
            <input
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && parkIdea()}
              placeholder="A trip, a project, a list…"
            />
            <button onClick={parkIdea}>Park</button>
          </div>
          {parked.length > 0 && (
            <ul className="parked">
              {parked.map((p, i) => (
                <li key={i}>💡 {p}</li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>Recently</h2>
          <ul className="recent">
            {canvas.checkedAt && (
              <li>
                <span className="time">{timeFmt.format(canvas.checkedAt)}</span> Checked Canvas:{" "}
                {canvasDays.today.length + canvasDays.later.length} item
                {canvasDays.today.length + canvasDays.later.length === 1 ? "" : "s"} in the next{" "}
                {DAYS_AHEAD} days
              </li>
            )}
            {mockRecently.map((r) => (
              <li key={r.id}>
                <span className="time">{timeFmt.format(r.at)}</span> {r.text}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Controls</h2>
          <ApiKeySettings />
          <CanvasSettings canvas={canvas} />
          <label className="toggle">
            <input type="checkbox" checked={muted} onChange={(e) => onMutedChange(e.target.checked)} />
            Mute voice
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={quiet}
              onChange={(e) => onQuietChange(e.target.checked)}
            />
            Quiet mode (no voice, no speech bubble)
          </label>
          <div className="state-preview">
            <span>Preview character:</span>
            <div className="segmented">
              {CHARACTER_STATES.map((s) => (
                <button
                  key={s}
                  className={s === state ? "active" : ""}
                  onClick={() => onStateChange(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** One real Canvas item. Ticking it is remembered on this Mac only; Canvas itself is never changed. */
function CanvasRow({
  item,
  canvas,
  onCelebrate,
}: {
  item: CanvasItem;
  canvas: CanvasState;
  onCelebrate: () => void;
}) {
  const done = canvas.done.has(item.uid);
  return (
    <li className={done ? "done" : ""}>
      <span className="time">{itemTime(item)}</span>
      <span className="title">
        {item.title}
        <span className="source source-canvas">
          {canvasLabel(item)}
          {item.course ? ` · ${item.course}` : ""}
        </span>
      </span>
      <span className="row-actions">
        <button
          title={done ? "Undo" : "Done"}
          onClick={() => {
            if (!done) onCelebrate();
            canvas.toggleDone(item.uid);
          }}
        >
          {done ? "↺" : "✓"}
        </button>
        {item.url && (
          <button title="Open in Canvas" onClick={() => openCanvasLink(item.url!)}>
            ↗
          </button>
        )}
      </span>
    </li>
  );
}
