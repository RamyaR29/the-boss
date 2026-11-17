import type { MailState } from "./mail";

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** Apple Mail status and a Check now button. */
export function MailSettings({ mail }: { mail: MailState }) {
  const { status } = mail;
  return (
    <div className="api-key">
      <span className="label">Apple Mail</span>
      <div className="input-row">
        <span className="key-saved">
          {mail.checking
            ? "Checking…"
            : status === null
              ? "Loading…"
              : status === "never"
                ? "Not checked yet"
                : status === "noPermission"
                  ? "Needs Full Disk Access"
                    : mail.lastChecked
                      ? `✓ Checked ${timeFmt.format(mail.lastChecked)}`
                      : "Not checked yet"}
        </span>
        <button onClick={() => mail.checkNow()} disabled={mail.checking}>
          Check now
        </button>
      </div>
      {status === "noPermission" && (
        <>
          <p className="hint">
            Turn on The Boss (or Terminal, while testing) in System Settings → Privacy &amp; Security →
            Full Disk Access, then quit and reopen it and click Check now. The Boss only uses this to
            read Mail's files.
          </p>
          <div className="input-row">
            <button onClick={mail.openSettings}>Open Settings</button>
          </div>
        </>
      )}
      <p className="hint">
        Reads new inbox mail from every account in Apple Mail (Mail doesn't need to be open), once
        each, every hour, and adds reminders for deadlines. The full text goes to Gemini's free tier.
        Nothing is sent, moved or deleted.
      </p>
      {mail.error && <p className="hint error">{mail.error}</p>}
    </div>
  );
}
