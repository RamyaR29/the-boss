import { useState } from "react";
import type { CalendarState } from "./calendar";

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** Calendar access, plus a list to hide calendars you don't want in Today. */
export function CalendarSettings({ calendar }: { calendar: CalendarState }) {
  const [showList, setShowList] = useState(false);
  const [asking, setAsking] = useState(false);
  const { access } = calendar;

  const ask = async () => {
    setAsking(true);
    await calendar.requestAccess();
    setAsking(false);
  };

  // Group calendars by account (iCloud, Google, …).
  const accounts = new Map<string, typeof calendar.calendars>();
  for (const c of calendar.calendars) {
    accounts.set(c.account, [...(accounts.get(c.account) ?? []), c]);
  }
  const shown = calendar.calendars.filter((c) => !calendar.hidden.has(c.id)).length;

  return (
    <div className="api-key">
      <span className="label">Mac Calendar</span>
      {access === null ? (
        <p className="hint">Checking…</p>
      ) : access === "granted" ? (
        <>
          <div className="input-row">
            <span className="key-saved">
              ✓ Connected · {shown} of {calendar.calendars.length} calendars
              {calendar.checkedAt ? ` · checked ${timeFmt.format(calendar.checkedAt)}` : ""}
            </span>
            <button onClick={() => setShowList((s) => !s)}>{showList ? "Done" : "Choose"}</button>
          </div>
          {showList && (
            <div className="calendar-list">
              {[...accounts].map(([account, cals]) => (
                <div key={account}>
                  {account && <div className="hint">{account}</div>}
                  {cals.map((c) => (
                    <label key={c.id} className="toggle">
                      <input
                        type="checkbox"
                        checked={!calendar.hidden.has(c.id)}
                        onChange={() => calendar.toggleHidden(c.id)}
                      />
                      {c.title}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      ) : access === "notDetermined" ? (
        <>
          <div className="input-row">
            <button className="btn-primary" onClick={ask} disabled={asking}>
              {asking ? "Waiting for your answer…" : "Allow calendar access"}
            </button>
          </div>
          <p className="hint">Read-only: The Boss never adds, changes or deletes events.</p>
        </>
      ) : (
        <>
          <p className="hint">
            {access === "writeOnly"
              ? "The Boss can only add events, not read them. Switch it to Full Access in System Settings → Privacy & Security → Calendars."
              : access === "restricted"
                ? "Calendar access is blocked on this Mac (for example by a school or work profile)."
                : "Calendar access is off. Turn on The Boss (or Terminal, while testing) in System Settings → Privacy & Security → Calendars, then click Check again."}
          </p>
          <div className="input-row">
            {access !== "restricted" && <button onClick={calendar.openSettings}>Open Settings</button>}
            <button onClick={() => calendar.refresh()}>Check again</button>
          </div>
        </>
      )}
      {calendar.error && <p className="hint error">{calendar.error}</p>}
    </div>
  );
}
