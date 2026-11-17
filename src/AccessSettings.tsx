import { useState } from "react";

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

type Access = "notDetermined" | "granted" | "denied" | "restricted" | "writeOnly";

interface Props {
  /** "Mac Calendar" or "Reminders" */
  label: string;
  /** "calendars" or "lists" */
  noun: string;
  /** The System Settings pane name, e.g. "Calendars". */
  pane: string;
  hint: string;
  access: Access | null;
  groups: { id: string; title: string; account: string }[];
  hidden: Set<string>;
  toggleHidden: (id: string) => void;
  checkedAt: Date | null;
  error: string;
  requestAccess: () => Promise<void>;
  openSettings: () => Promise<void>;
  refresh: () => Promise<void>;
}

/** Access to a Mac app's data (Calendar, Reminders), plus a list to hide some calendars or lists. */
export function AccessSettings(p: Props) {
  const [showList, setShowList] = useState(false);
  const [asking, setAsking] = useState(false);

  const ask = async () => {
    setAsking(true);
    await p.requestAccess();
    setAsking(false);
  };

  // Group by account (iCloud, Google, …).
  const accounts = new Map<string, typeof p.groups>();
  for (const g of p.groups) accounts.set(g.account, [...(accounts.get(g.account) ?? []), g]);
  const shown = p.groups.filter((g) => !p.hidden.has(g.id)).length;

  return (
    <div className="api-key">
      <span className="label">{p.label}</span>
      {p.access === null ? (
        <p className="hint">Checking…</p>
      ) : p.access === "granted" ? (
        <>
          <div className="input-row">
            <span className="key-saved">
              ✓ Connected · {shown} of {p.groups.length} {p.noun}
              {p.checkedAt ? ` · checked ${timeFmt.format(p.checkedAt)}` : ""}
            </span>
            <button onClick={() => setShowList((s) => !s)}>{showList ? "Done" : "Choose"}</button>
          </div>
          {showList && (
            <div className="calendar-list">
              {[...accounts].map(([account, items]) => (
                <div key={account}>
                  {account && <div className="hint">{account}</div>}
                  {items.map((g) => (
                    <label key={g.id} className="toggle">
                      <input
                        type="checkbox"
                        checked={!p.hidden.has(g.id)}
                        onChange={() => p.toggleHidden(g.id)}
                      />
                      {g.title}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      ) : p.access === "notDetermined" ? (
        <>
          <div className="input-row">
            <button className="btn-primary" onClick={ask} disabled={asking}>
              {asking ? "Waiting for your answer…" : `Allow ${p.label} access`}
            </button>
          </div>
          <p className="hint">{p.hint}</p>
        </>
      ) : (
        <>
          <p className="hint">
            {p.access === "writeOnly"
              ? `The Boss can only add, not read. Switch it to Full Access in System Settings → Privacy & Security → ${p.pane}.`
              : p.access === "restricted"
                ? `${p.label} access is blocked on this Mac (for example by a school or work profile).`
                : `${p.label} access is off. Turn on The Boss (or Terminal, while testing) in System Settings → Privacy & Security → ${p.pane}, then click Check again.`}
          </p>
          <div className="input-row">
            {p.access !== "restricted" && <button onClick={p.openSettings}>Open Settings</button>}
            <button onClick={() => p.refresh()}>Check again</button>
          </div>
        </>
      )}
      {p.error && <p className="hint error">{p.error}</p>}
    </div>
  );
}
