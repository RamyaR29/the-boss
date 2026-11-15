import { useEffect, useState } from "react";
import { deleteApiKey, hasApiKey, saveApiKey } from "./chat";

/** Paste-once box for the Gemini key. The key goes straight to the macOS Keychain. */
export function ApiKeySettings() {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    hasApiKey()
      .then(setSaved)
      .catch((e) => setError(String(e)));
  }, []);

  const save = async () => {
    setError("");
    try {
      await saveApiKey(draft);
      setDraft("");
      setSaved(true);
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async () => {
    setError("");
    try {
      await deleteApiKey();
      setSaved(false);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="api-key">
      <span className="label">Gemini API key</span>
      {saved ? (
        <div className="input-row">
          <span className="key-saved">✓ Saved in Keychain</span>
          <button onClick={remove}>Remove</button>
        </div>
      ) : (
        <div className="input-row">
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="Paste key from aistudio.google.com"
          />
          <button onClick={save} disabled={!draft.trim()}>
            Save
          </button>
        </div>
      )}
      <p className="hint">
        Free tier: Google may use what you ask to improve its products.
      </p>
      {error && <p className="hint error">{error}</p>}
    </div>
  );
}
