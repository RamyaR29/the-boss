import { useState } from "react";
import type { CanvasState } from "./canvas";

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** Paste-once box for the Canvas calendar feed link. The link goes straight to the macOS Keychain. */
export function CanvasSettings({ canvas }: { canvas: CanvasState }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    try {
      await canvas.connect(draft);
      setDraft("");
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async () => {
    setError("");
    try {
      await canvas.disconnect();
    } catch (e) {
      setError(String(e));
    }
  };

  const shown = error || canvas.error;

  return (
    <div className="api-key">
      <span className="label">Canvas calendar feed</span>
      {canvas.connected === null ? (
        <p className="hint">Checking…</p>
      ) : canvas.connected ? (
        <div className="input-row">
          <span className="key-saved">
            ✓ Connected
            {canvas.checking
              ? " · checking…"
              : canvas.checkedAt
                ? ` · checked ${timeFmt.format(canvas.checkedAt)}`
                : ""}
          </span>
          <button onClick={() => canvas.refresh()} disabled={canvas.checking}>
            Refresh
          </button>
          <button onClick={remove} disabled={canvas.checking}>
            Remove
          </button>
        </div>
      ) : (
        <>
          <div className="input-row">
            <input
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && draft.trim() && save()}
              placeholder="Paste your Calendar Feed link"
            />
            <button onClick={save} disabled={!draft.trim() || canvas.checking}>
              {canvas.checking ? "Checking…" : "Save"}
            </button>
          </div>
          <p className="hint">
            In Canvas, open Calendar and click "Calendar Feed" (bottom right). Copy that link. It's
            private, so it's kept in your Keychain. Read-only.
          </p>
        </>
      )}
      {shown && <p className="hint error">{shown}</p>}
    </div>
  );
}
