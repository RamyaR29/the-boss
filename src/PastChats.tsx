import { useEffect, useState } from "react";
import {
  deleteSession,
  listSessions,
  loadSession,
  type Session,
  type SessionSummary,
} from "./chat";

const whenFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Read-only list of earlier chats saved on this Mac. */
export function PastChats({ currentId }: { currentId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [list, setList] = useState<SessionSummary[]>([]);
  const [viewing, setViewing] = useState<Session | null>(null);
  const [error, setError] = useState("");

  const refresh = () =>
    listSessions()
      .then((all) => setList(all.filter((s) => s.id !== currentId)))
      .catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const open = async (id: string) => {
    setError("");
    try {
      setViewing(await loadSession(id));
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async (id: string) => {
    setError("");
    try {
      await deleteSession(id);
      if (viewing?.id === id) setViewing(null);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section>
      <h2>
        <button className="link" onClick={() => setExpanded((x) => !x)}>
          {expanded ? "▾" : "▸"} Past chats ({list.length})
        </button>
      </h2>
      {expanded && (
        <>
          {list.length === 0 && <p className="hint">No earlier chats yet.</p>}
          {viewing ? (
            <div className="past-view">
              <div className="past-view-header">
                <span>{whenFmt.format(viewing.startedAt)}</span>
                <button onClick={() => setViewing(null)}>Back</button>
              </div>
              <div className="thread">
                {viewing.messages.map((m) => (
                  <div key={m.id} className={`msg msg-${m.role}${m.error ? " msg-error" : ""}`}>
                    {m.text}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <ul className="past-list">
              {list.map((s) => (
                <li key={s.id}>
                  <button className="past-open" onClick={() => open(s.id)}>
                    <span className="past-title">{s.title}</span>
                    <span className="time">
                      {whenFmt.format(s.lastAt)} · {s.count} messages
                    </span>
                  </button>
                  <button title="Delete this chat" onClick={() => remove(s.id)}>
                    🗑
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {error && <p className="hint error">{error}</p>}
    </section>
  );
}
