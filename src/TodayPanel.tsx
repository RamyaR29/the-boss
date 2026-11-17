import { useEffect, useRef, useState } from "react";
import { ApiKeySettings } from "./ApiKeySettings";
import {
  eventTime,
  eventUntil,
  findClashes,
  type CalendarEvent,
  type CalendarState,
} from "./calendar";
import { AccessSettings } from "./AccessSettings";
import {
  canvasLabel,
  DAYS_AHEAD,
  dayLabel,
  itemTime,
  itemWhen,
  openCanvasLink,
  startOfDay,
  type CanvasItem,
  type CanvasState,
} from "./canvas";
import { CanvasSettings } from "./CanvasSettings";
import { senderName, type MailState } from "./mail";
import { MailSettings } from "./MailSettings";
import { changeLabel, type MemoryState } from "./memory";
import { MemorySection } from "./MemorySection";
import { detectLanguage } from "./language";
import { PastChats } from "./PastChats";
import type { ChatMessage } from "./chat";
import { CHARACTER_STATES, type CharacterState } from "./Elephant";
import type { NeedsYouItem } from "./needsYou";
import {
  dueText,
  isOverdue,
  reminderChangeLabel,
  reminderTime,
  type Reminder,
  type RemindersState,
} from "./reminders";

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const whenFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const dayOnlyFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
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
  calendar: CalendarState;
  reminders: RemindersState;
  mail: MailState;
  memory: MemoryState;
  onUndoMemory: (messageId: number, index: number) => Promise<void>;
  onUndoReminder: (messageId: number, index: number) => Promise<void>;
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
  calendar,
  reminders,
  mail,
  memory,
  onUndoMemory,
  onUndoReminder,
}: Props) {
  const [ask, setAsk] = useState("");
  const [idea, setIdea] = useState("");
  const [parked, setParked] = useState<string[]>([]);

  const parkIdea = () => {
    if (!idea.trim()) return;
    setParked((p) => [idea.trim(), ...p]);
    setIdea("");
  };

  const lang = detectLanguage(ask);

  // Everything with a time, for today and the next 7 days: Canvas, the Mac Calendar and
  // dated reminders. Today's (and overdue reminders) go in Today; later days under "Coming up".
  type Row =
    | { kind: "canvas"; day: number; at: number; allDay: boolean; item: CanvasItem }
    | { kind: "event"; day: number; at: number; allDay: boolean; item: CalendarEvent }
    | { kind: "reminder"; day: number; at: number; allDay: boolean; item: Reminder };
  const now = new Date();
  const today0 = startOfDay(now).getTime();
  const endDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + DAYS_AHEAD + 1).getTime();
  const dayOf = (ms: number) => startOfDay(new Date(ms)).getTime();
  const rows: Row[] = [
    ...canvas.items.map(
      (item): Row => ({ kind: "canvas", day: dayOf(item.startMs), at: item.startMs, allDay: item.allDay, item }),
    ),
    ...calendar.events.map((item): Row => {
      // An event that started before today but is still going shows in Today.
      const ongoing = item.startMs < today0 && item.endMs > today0;
      return {
        kind: "event",
        day: ongoing ? today0 : dayOf(item.startMs),
        at: item.startMs,
        allDay: item.allDay,
        item,
      };
    }),
    ...reminders.items
      .filter((r) => r.dueMs !== null)
      .map((item): Row => {
        const at = item.dueMs!;
        // Overdue reminders stay in Today until they're done or moved.
        return { kind: "reminder", day: at < today0 ? today0 : dayOf(at), at, allDay: item.allDay, item };
      }),
  ]
    .filter((r) => r.day >= today0 && r.day < endDay)
    // By day, all-day items first, then by time.
    .sort((a, b) => a.day - b.day || Number(b.allDay) - Number(a.allDay) || a.at - b.at);
  const todayRows = rows.filter((r) => r.day === today0);
  const todos = reminders.items.filter((r) => r.dueMs === null);
  const laterRows = rows.filter((r) => r.day > today0);
  const groups: { label: string; rows: Row[] }[] = [];
  for (const r of laterRows) {
    const label = dayLabel(new Date(r.day), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(r);
    else groups.push({ label, rows: [r] });
  }

  // Overlapping events, and Canvas deadlines that fall inside an event, get a ⚠ mark.
  const clashes = findClashes(
    calendar.events,
    canvas.items
      .filter((i) => i.kind === "assignment" && !i.allDay)
      .map((i) => ({ uid: i.uid, title: i.title, atMs: i.startMs })),
  );
  const clashNote = (uid: string) => {
    const with_ = clashes.get(uid);
    return with_ ? `Overlaps ${with_.join(", ")}` : "";
  };

  const canvasLine = (i: CanvasItem) =>
    `${i.kind === "assignment" ? "Canvas assignment due" : "Canvas course event"} · ${i.title}` +
    `${i.course ? ` (${i.course})` : ""}${canvas.done.has(i.uid) ? " (marked done)" : ""}`;

  const eventWhen = (e: CalendarEvent, withDay: boolean) => {
    if (e.allDay) return withDay ? `${dayOnlyFmt.format(e.startMs)}, all day` : "All day";
    const start = withDay ? whenFmt.format(e.startMs) : timeFmt.format(e.startMs);
    return `${start}–${timeFmt.format(e.endMs)}`;
  };

  // One line of context for Gemini.
  const reminderLine = (r: Reminder) =>
    `Reminder (${r.listTitle}) [${r.id}] · ${r.title}` +
    `${r.completed ? " (done)" : isOverdue(r, now.getTime()) ? " (overdue)" : ""}`;
  const rowLine = (r: Row, withDay: boolean) => {
    if (r.kind === "reminder") {
      const when = withDay || r.at < today0 ? dueText(r.item) : reminderTime(r.item);
      return `- ${when} · ${reminderLine(r.item)}`;
    }
    const clash = clashNote(r.item.uid);
    const tail = clash ? ` (${clash})` : "";
    if (r.kind === "canvas") {
      return `- ${withDay ? itemWhen(r.item) : itemTime(r.item)} · ${canvasLine(r.item)}${tail}`;
    }
    const e = r.item;
    return (
      `- ${eventWhen(e, withDay)} · Calendar event (${calendar.calendarTitle(e.calendarId)}) · ${e.title}` +
      `${e.location ? ` @ ${e.location}` : ""}${tail}`
    );
  };

  // What The Boss knows about today and the coming week, sent with each question.
  const buildContext = () => {
    const lines = [`Now: ${dateFmt.format(new Date())}`, "", "Today:"];
    for (const r of todayRows) lines.push(rowLine(r, false));
    if (todayRows.length === 0) lines.push("- Nothing.");
    lines.push("", `The next ${DAYS_AHEAD} days after today:`);
    for (const r of laterRows) lines.push(rowLine(r, true));
    if (laterRows.length === 0) lines.push("- Nothing.");
    lines.push("", "To-dos (no date):");
    for (const r of todos.slice(0, 100)) lines.push(`- ${reminderLine(r)}`);
    if (todos.length === 0) lines.push("- None.");
    if (todos.length > 100) lines.push(`- (${todos.length - 100} more not shown)`);
    // Recent mail: the last 3 days, newest first, with The Boss's one-line summaries.
    const recentMail = mail.items.filter((m) => m.dateMs > now.getTime() - 3 * 86_400_000).slice(0, 40);
    lines.push("", "Recent mail (last 3 days, newest first):");
    for (const m of recentMail) {
      const flag = m.needsAttention ? (m.done ? " (needed the user; marked done)" : " (needs the user)") : "";
      lines.push(
        `- ${whenFmt.format(m.dateMs)} · [${m.key}] · From ${m.from} · ${m.subject}${flag}` +
          `${m.summary ? ` · ${m.summary}` : ""}` +
          `${m.reminders.length ? ` · reminders added: ${m.reminders.map((r) => r.title).join(", ")}` : ""}`,
      );
    }
    if (recentMail.length === 0) lines.push("- None.");
    lines.push("", "Sources:");
    if (canvas.connected === false) {
      lines.push("- Canvas isn't connected yet (the user can add the feed link under Controls).");
    } else if (canvas.error && !canvas.checkedAt) {
      lines.push(`- Couldn't check Canvas: ${canvas.error}`);
    } else {
      lines.push(`- Canvas: real, today and the next ${DAYS_AHEAD} days.`);
    }
    if (calendar.access === "granted") {
      lines.push(`- Mac Calendar: real, today and the next ${DAYS_AHEAD} days.`);
    } else {
      lines.push("- Mac Calendar isn't connected yet (the user can allow access under Controls).");
    }
    if (reminders.access === "granted") {
      const defaultList = reminders.lists.find((l) => l.id === reminders.defaultListId)?.title;
      lines.push(
        `- Reminders: real; lists: ${reminders.lists
          .filter((l) => !reminders.hidden.has(l.id))
          .map((l) => l.title)
          .join(", ")}${defaultList ? `; new ones go to "${defaultList}" unless the user names a list` : ""}.`,
      );
    } else {
      lines.push(
        "- Reminders aren't connected yet, so you can't create or read reminders (the user can allow access under Controls).",
      );
    }
    lines.push(
      mail.status === "ok"
        ? "- Mail: real (Apple Mail inbox, all accounts), checked hourly."
        : "- Mail: not checked right now (The Boss may not have Full Disk Access yet).",
    );
    if (needsYou.length) {
      lines.push("", "Waiting on the user:");
      for (const n of needsYou) lines.push(`- ${n.text}`);
    }
    return lines.join("\n");
  };

  const renderRow = (r: Row) => {
    if (r.kind === "reminder") {
      return <ReminderRow key={r.item.id} item={r.item} reminders={reminders} onCelebrate={onCelebrate} />;
    }
    if (r.kind === "canvas") {
      return (
        <CanvasRow
          key={r.item.uid}
          item={r.item}
          canvas={canvas}
          onCelebrate={onCelebrate}
          clash={clashNote(r.item.uid)}
        />
      );
    }
    return (
      <EventRow
        key={r.item.uid}
        event={r.item}
        calendarTitle={calendar.calendarTitle(r.item.calendarId)}
        clash={clashNote(r.item.uid)}
      />
    );
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
          <ul className="today-list">{todayRows.map((r) => renderRow(r))}</ul>
          {todayRows.length === 0 && <p className="hint">Nothing on today.</p>}
          {canvas.connected === false && (
            <p className="hint">Connect Canvas under Controls to see your real deadlines.</p>
          )}
          {calendar.access !== null && calendar.access !== "granted" && (
            <p className="hint">Allow calendar access under Controls to see your real events.</p>
          )}
          {reminders.access !== null && reminders.access !== "granted" && (
            <p className="hint">Allow Reminders access under Controls to see your reminders and to-dos.</p>
          )}
        </section>

        {groups.length > 0 && (
          <section>
            <h2>Coming up</h2>
            {groups.map((g) => (
              <div key={g.label} className="day-group">
                <h3>{g.label}</h3>
                <ul className="today-list">{g.rows.map((r) => renderRow(r))}</ul>
              </div>
            ))}
          </section>
        )}

        {todos.length > 0 && (
          <section>
            <h2>
              To-dos <span className="muted-count">{todos.filter((t) => !t.completed).length}</span>
            </h2>
            <ul className="today-list todo-list">
              {todos.map((t) => (
                <ReminderRow key={t.id} item={t} reminders={reminders} onCelebrate={onCelebrate} />
              ))}
            </ul>
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
                  {m.reminders?.map((c, i) => (
                    <div key={`r${i}`} className={`memory-note${c.undone ? " undone" : ""}`}>
                      🔔 {c.undone ? "Undone: " : ""}
                      {reminderChangeLabel(c)}
                      {c.kind !== "skipped" && c.kind !== "confirmDelete" && !c.undone && (
                        <button
                          className="link"
                          onClick={() => onUndoReminder(m.id, i).catch((e) => console.error(e))}
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
          {!canvas.checkedAt && !calendar.checkedAt && !mail.lastChecked && (
            <p className="hint">Nothing yet.</p>
          )}
          <ul className="recent">
            {mail.lastChecked && (
              <li>
                <span className="time">{timeFmt.format(mail.lastChecked)}</span> Checked mail:{" "}
                {mail.newCount} new, {mail.attention.length} need you
              </li>
            )}
            {mail.items
              .filter((m) => m.reminders.length > 0 && m.dateMs > now.getTime() - 7 * 86_400_000)
              .slice(0, 8)
              .flatMap((m) =>
                m.reminders.map((r) => (
                  <li key={`${m.key}:${r.id}`}>
                    🔔 Added from {senderName(m.from)}'s email: {r.title}
                    {r.dueMs !== null ? ` · ${dueText(r)}` : ""}{" "}
                    <button
                      className="link"
                      onClick={() => mail.undoReminder(m.key, r.id).catch((e) => console.error(e))}
                    >
                      Undo
                    </button>
                  </li>
                )),
              )}
            {canvas.checkedAt && (
              <li>
                <span className="time">{timeFmt.format(canvas.checkedAt)}</span> Checked Canvas:{" "}
                {rows.filter((r) => r.kind === "canvas").length} item
                {rows.filter((r) => r.kind === "canvas").length === 1 ? "" : "s"} in the next{" "}
                {DAYS_AHEAD} days
              </li>
            )}
            {calendar.checkedAt && (
              <li>
                <span className="time">{timeFmt.format(calendar.checkedAt)}</span> Checked calendar:{" "}
                {calendar.events.length} event{calendar.events.length === 1 ? "" : "s"} in the next{" "}
                {DAYS_AHEAD} days
              </li>
            )}
          </ul>
        </section>

        <section>
          <h2>Controls</h2>
          <ApiKeySettings />
          <CanvasSettings canvas={canvas} />
          <MailSettings mail={mail} />
          <AccessSettings
            label="Mac Calendar"
            noun="calendars"
            pane="Calendars"
            hint="Read-only: The Boss never adds, changes or deletes events."
            access={calendar.access}
            groups={calendar.calendars}
            hidden={calendar.hidden}
            toggleHidden={calendar.toggleHidden}
            checkedAt={calendar.checkedAt}
            error={calendar.error}
            requestAccess={calendar.requestAccess}
            openSettings={calendar.openSettings}
            refresh={calendar.refresh}
          />
          <AccessSettings
            label="Reminders"
            noun="lists"
            pane="Reminders"
            hint="The Boss can add, complete and move reminders when you ask. It deletes one only after you confirm."
            access={reminders.access}
            groups={reminders.lists}
            hidden={reminders.hidden}
            toggleHidden={reminders.toggleHidden}
            checkedAt={reminders.checkedAt}
            error={reminders.error}
            requestAccess={reminders.requestAccess}
            openSettings={reminders.openSettings}
            refresh={reminders.refresh}
          />
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
  clash,
}: {
  item: CanvasItem;
  canvas: CanvasState;
  onCelebrate: () => void;
  clash: string;
}) {
  const done = canvas.done.has(item.uid);
  return (
    <li className={done ? "done" : ""}>
      <span className="time">{itemTime(item)}</span>
      <span className="title">
        {item.title}
        <span className="source source-canvas">
          {clash && <Clash note={clash} />}
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

/** One event from the Mac's Calendar app. Read-only, so no actions. */
function EventRow({
  event,
  calendarTitle,
  clash,
}: {
  event: CalendarEvent;
  calendarTitle: string;
  clash: string;
}) {
  const until = eventUntil(event);
  return (
    <li>
      <span className="time">{eventTime(event)}</span>
      <span className="title">
        {event.title}
        <span className="source source-calendar">
          {clash && <Clash note={clash} />}
          {calendarTitle}
          {until ? ` · ${until}` : ""}
          {event.location ? ` · ${event.location}` : ""}
        </span>
      </span>
      <span />
    </li>
  );
}

function Clash({ note }: { note: string }) {
  return (
    <span className="clash" title={note} aria-label={note}>
      ⚠{" "}
    </span>
  );
}

/** A reminder or to-do. ✓ marks it done in the Reminders app; ⏰ moves it an hour (a day if all-day). */
function ReminderRow({
  item,
  reminders,
  onCelebrate,
}: {
  item: Reminder;
  reminders: RemindersState;
  onCelebrate: () => void;
}) {
  const overdue = isOverdue(item, Date.now());
  return (
    <li className={item.completed ? "done" : ""}>
      <span className={`time${overdue ? " overdue" : ""}`}>{reminderTime(item)}</span>
      <span className="title">
        {item.title}
        <span className={`source source-reminder${overdue ? " overdue" : ""}`}>
          {overdue ? `Overdue, was due ${dueText(item)}` : item.dueMs === null ? "To-do" : "Reminder"} ·{" "}
          {item.listTitle}
        </span>
      </span>
      <span className="row-actions">
        <button
          title={item.completed ? "Undo" : "Done"}
          onClick={() => {
            if (!item.completed) onCelebrate();
            reminders.toggleDone(item);
          }}
        >
          {item.completed ? "↺" : "✓"}
        </button>
        {item.dueMs !== null && !item.completed && (
          <button
            title={item.allDay ? "Move to the next day" : "Snooze 1 hour"}
            onClick={() => reminders.snooze(item)}
          >
            ⏰
          </button>
        )}
      </span>
    </li>
  );
}
