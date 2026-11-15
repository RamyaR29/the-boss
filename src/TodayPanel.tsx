import { useState } from "react";
import { CHARACTER_STATES, type CharacterState } from "./Elephant";
import {
  mockNeedsYou,
  mockRecently,
  mockToday,
  sourceLabel,
  type TodayItem,
} from "./mockData";

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** Rough guess for the "detected language" label; real detection comes with the agent. */
function guessLanguage(text: string): string {
  if (!text.trim()) return "";
  if (/[஀-௿]/.test(text)) return "Tamil";
  const tanglish = /\b(pannu|pannanum|naalaiku|innaiku|enna|illa|seri|venum|romba|epdi|inga|anga|sollu|paaru)\b/i;
  if (tanglish.test(text)) return "Tanglish";
  return "English";
}

interface Props {
  state: CharacterState;
  onStateChange: (s: CharacterState) => void;
}

export function TodayPanel({ state, onStateChange }: Props) {
  const [needsYou, setNeedsYou] = useState(mockNeedsYou);
  const [today, setToday] = useState<(TodayItem & { done?: boolean })[]>(mockToday);
  const [ask, setAsk] = useState("");
  const [idea, setIdea] = useState("");
  const [parked, setParked] = useState<string[]>([]);
  const [muted, setMuted] = useState(false);
  const [quietHours, setQuietHours] = useState(false);

  const resolve = (id: string) => setNeedsYou((items) => items.filter((i) => i.id !== id));
  const markDone = (id: string) =>
    setToday((items) => items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
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

  const lang = guessLanguage(ask);

  return (
    <div className="panel" role="dialog" aria-label="Today">
      <header className="panel-header">
        <h1>Today</h1>
        <span className="mock-tag">mock data</span>
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
                  <button className="btn-primary" onClick={() => resolve(n.id)}>
                    {n.primary}
                  </button>
                  <button onClick={() => resolve(n.id)}>{n.secondary}</button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section>
          <h2>Today</h2>
          <ul className="today-list">
            {today.map((t) => (
              <li key={t.id} className={t.done ? "done" : ""}>
                <span className="time">{timeFmt.format(t.at)}</span>
                <span className="title">
                  {t.title}
                  <span className={`source source-${t.source}`}>{sourceLabel[t.source]}</span>
                </span>
                <span className="row-actions">
                  <button title={t.done ? "Undo" : "Done"} onClick={() => markDone(t.id)}>
                    {t.done ? "↺" : "✓"}
                  </button>
                  <button title="Snooze 1 hour" onClick={() => snooze(t.id)} disabled={t.done}>
                    ⏰
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Ask</h2>
          <div className="input-row">
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder="English, தமிழ், or Tanglish…"
            />
            <button title="Voice comes in a later slice" disabled>
              🎤
            </button>
          </div>
          <p className="hint">
            {lang ? `Detected: ${lang}. ` : ""}Chat with The Boss arrives in a later slice.
          </p>
        </section>

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
            {mockRecently.map((r) => (
              <li key={r.id}>
                <span className="time">{timeFmt.format(r.at)}</span> {r.text}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Controls</h2>
          <label className="toggle">
            <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
            Mute
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={quietHours}
              onChange={(e) => setQuietHours(e.target.checked)}
            />
            Quiet hours
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
