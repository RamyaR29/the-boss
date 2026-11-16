import { useState } from "react";
import type { MemoryState } from "./memory";

/** "Memory · 12 things": view, edit, delete and add what The Boss remembers. Folded by default. */
export function MemorySection({ memory }: { memory: MemoryState }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState("");

  const run = async (f: () => Promise<void>) => {
    setError("");
    try {
      await f();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  };

  const add = async () => {
    if (await run(() => memory.add(draft))) setDraft("");
  };
  const saveEdit = async () => {
    if (!editing) return;
    if (await run(() => memory.update(editing.id, editing.text))) setEditing(null);
  };

  const n = memory.items.length;

  return (
    <section>
      <h2 className="h2-row">
        <button className="link fold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "▾" : "▸"} Memory · {n} {n === 1 ? "thing" : "things"}
        </button>
      </h2>
      {open && (
        <>
          {n === 0 && (
            <p className="hint">
              Nothing yet. Tell The Boss "remember that…" in Ask, or add something here.
            </p>
          )}
          <ul className="memory-list">
            {memory.items.map((m) =>
              editing?.id === m.id ? (
                <li key={m.id}>
                  <div className="input-row">
                    <input
                      autoFocus
                      value={editing.text}
                      onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit();
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setEditing(null);
                        }
                      }}
                    />
                    <button onClick={saveEdit} disabled={!editing.text.trim()}>
                      Save
                    </button>
                  </div>
                </li>
              ) : (
                <li key={m.id}>
                  <span className="memory-text">{m.text}</span>
                  <span className="row-actions">
                    <button title="Edit" onClick={() => setEditing({ id: m.id, text: m.text })}>
                      ✎
                    </button>
                    <button title="Delete" onClick={() => run(() => memory.remove(m.id))}>
                      ✕
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
          <div className="input-row">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && draft.trim() && add()}
              placeholder="Add something to remember…"
            />
            <button onClick={add} disabled={!draft.trim()}>
              Add
            </button>
          </div>
          {n > 0 &&
            (confirmClear ? (
              <div className="input-row confirm-row">
                <span>Forget all {n}? This can't be undone.</span>
                <button
                  className="btn-danger"
                  onClick={async () => {
                    await run(memory.clear);
                    setConfirmClear(false);
                  }}
                >
                  Forget all
                </button>
                <button onClick={() => setConfirmClear(false)}>Cancel</button>
              </div>
            ) : (
              <button className="link" onClick={() => setConfirmClear(true)}>
                Forget everything
              </button>
            ))}
          <p className="hint">
            Kept on your Mac and sent to Gemini with each question. Passwords, ID or card numbers and
            health details are never saved.
          </p>
          {(error || memory.error) && <p className="hint error">{error || memory.error}</p>}
        </>
      )}
    </section>
  );
}
