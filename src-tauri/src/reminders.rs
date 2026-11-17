//! Reminders and to-dos in the Mac's Reminders app (EventKit). A reminder with a
//! due date is a "reminder"; one without is a "to-do". The Boss may create,
//! complete and reschedule them; it deletes one only after the user confirms in
//! the panel. Notes are never read.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReminderList {
    pub id: String,
    pub title: String,
    pub account: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub id: String,
    pub title: String,
    pub list_id: String,
    pub list_title: String,
    /// Due moment in ms since 1970; for all-day reminders, local midnight of that day.
    pub due_ms: Option<i64>,
    pub all_day: bool,
    pub completed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemindersData {
    lists: Vec<ReminderList>,
    items: Vec<Reminder>,
    default_list_id: Option<String>,
}

/// A due date: a moment, or a whole day (local midnight).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Due {
    pub ms: i64,
    pub all_day: bool,
}

const MAX_ITEMS: usize = 1000;
const MAX_TITLE: usize = 200;

#[cfg(target_os = "macos")]
pub(crate) mod mac {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2_event_kit::{
        EKAlarm, EKAuthorizationStatus, EKCalendar, EKEntityType, EKEventStore, EKReminder,
    };
    use objc2_foundation::{
        NSArray, NSCalendar, NSCalendarUnit, NSDate, NSDateComponentUndefined, NSError, NSString,
    };

    pub fn status() -> &'static str {
        let s = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Reminder) };
        match s {
            EKAuthorizationStatus::FullAccess => "granted",
            EKAuthorizationStatus::Denied => "denied",
            EKAuthorizationStatus::Restricted => "restricted",
            EKAuthorizationStatus::WriteOnly => "writeOnly",
            _ => "notDetermined",
        }
    }

    pub fn request() -> Result<&'static str, String> {
        let store = unsafe { EKEventStore::new() };
        let (tx, rx) = mpsc::channel::<bool>();
        let block = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
            let _ = tx.send(granted.as_bool());
        });
        unsafe { store.requestFullAccessToRemindersWithCompletion(RcBlock::as_ptr(&block)) };
        match rx.recv_timeout(Duration::from_secs(300)) {
            Ok(_) => Ok(status()),
            Err(_) => Err("No answer to the Reminders permission prompt.".into()),
        }
    }

    fn ready() -> Result<Retained<EKEventStore>, String> {
        if status() != "granted" {
            return Err("The Boss doesn't have Reminders access yet. Allow it under Controls → Reminders.".into());
        }
        Ok(unsafe { EKEventStore::new() })
    }

    fn ms(d: &NSDate) -> i64 {
        (d.timeIntervalSince1970() * 1000.0).round() as i64
    }

    fn list_info(cal: &EKCalendar) -> ReminderList {
        ReminderList {
            id: unsafe { cal.calendarIdentifier() }.to_string(),
            title: unsafe { cal.title() }.to_string(),
            account: unsafe { cal.source() }.map(|s| unsafe { s.title() }.to_string()).unwrap_or_default(),
        }
    }

    fn snapshot(r: &EKReminder) -> Reminder {
        let (due_ms, all_day) = match unsafe { r.dueDateComponents() } {
            Some(comps) => {
                let all_day = comps.hour() == NSDateComponentUndefined;
                let date = NSCalendar::currentCalendar().dateFromComponents(&comps);
                (date.map(|d| ms(&d)), all_day)
            }
            None => (None, false),
        };
        let list = unsafe { r.calendar() };
        Reminder {
            id: unsafe { r.calendarItemIdentifier() }.to_string(),
            title: unsafe { r.title() }.to_string(),
            list_id: list.as_ref().map(|c| unsafe { c.calendarIdentifier() }.to_string()).unwrap_or_default(),
            list_title: list.as_ref().map(|c| unsafe { c.title() }.to_string()).unwrap_or_default(),
            due_ms,
            all_day: due_ms.is_some() && all_day,
            completed: unsafe { r.isCompleted() },
        }
    }

    /// Open reminders, optionally only those due between two moments.
    fn fetch_open(store: &EKEventStore, range: Option<(i64, i64)>) -> Result<Vec<Reminder>, String> {
        let dates = range.map(|(a, b)| {
            (
                NSDate::dateWithTimeIntervalSince1970(a as f64 / 1000.0),
                NSDate::dateWithTimeIntervalSince1970(b as f64 / 1000.0),
            )
        });
        let predicate = unsafe {
            store.predicateForIncompleteRemindersWithDueDateStarting_ending_calendars(
                dates.as_ref().map(|d| &*d.0),
                dates.as_ref().map(|d| &*d.1),
                None,
            )
        };
        let (tx, rx) = mpsc::channel::<Vec<Reminder>>();
        let block = RcBlock::new(move |found: *mut NSArray<EKReminder>| {
            let mut out = Vec::new();
            if let Some(arr) = unsafe { found.as_ref() } {
                for r in arr.iter() {
                    out.push(snapshot(&r));
                }
            }
            let _ = tx.send(out);
        });
        unsafe { store.fetchRemindersMatchingPredicate_completion(&predicate, &block) };
        let mut items = rx
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| "Reading Reminders took too long.".to_string())?;
        items.sort_by_key(|r| (r.due_ms.is_none(), r.due_ms));
        items.truncate(MAX_ITEMS);
        Ok(items)
    }

    pub fn fetch() -> Result<RemindersData, String> {
        let store = ready()?;
        let lists = unsafe { store.calendarsForEntityType(EKEntityType::Reminder) }
            .iter()
            .map(|c| list_info(&c))
            .collect();
        let default_list_id =
            unsafe { store.defaultCalendarForNewReminders() }.map(|c| unsafe { c.calendarIdentifier() }.to_string());
        let items = fetch_open(&store, None)?;
        Ok(RemindersData { lists, items, default_list_id })
    }

    pub fn open_between(from_ms: i64, to_ms: i64) -> Result<Vec<Reminder>, String> {
        let store = ready()?;
        fetch_open(&store, Some((from_ms, to_ms)))
    }

    fn find(store: &EKEventStore, id: &str) -> Result<Retained<EKReminder>, String> {
        unsafe { store.calendarItemWithIdentifier(&NSString::from_str(id)) }
            .and_then(|item| item.downcast::<EKReminder>().ok())
            .ok_or_else(|| "That reminder is gone (maybe deleted in the Reminders app).".to_string())
    }

    fn save(store: &EKEventStore, r: &EKReminder) -> Result<(), String> {
        unsafe { store.saveReminder_commit_error(r, true) }
            .map_err(|e| format!("Reminders didn't save it: {}", e.localizedDescription()))
    }

    /// Sets the due date and a matching alert (timed reminders only).
    fn apply_due(r: &EKReminder, due: Option<Due>) {
        match due {
            None => unsafe {
                r.setDueDateComponents(None);
                r.setAlarms(None);
            },
            Some(due) => {
                let date = NSDate::dateWithTimeIntervalSince1970(due.ms as f64 / 1000.0);
                let mut units = NSCalendarUnit::Year | NSCalendarUnit::Month | NSCalendarUnit::Day;
                if !due.all_day {
                    units |= NSCalendarUnit::Hour | NSCalendarUnit::Minute;
                }
                let comps = NSCalendar::currentCalendar().components_fromDate(units, &date);
                unsafe {
                    r.setDueDateComponents(Some(&comps));
                    r.setAlarms(None);
                    if !due.all_day {
                        r.addAlarm(&EKAlarm::alarmWithAbsoluteDate(&date));
                    }
                }
            }
        }
    }

    /// The list to put a new reminder in: one named by the user, else the default.
    fn pick_list(store: &EKEventStore, list: Option<&str>) -> Result<Retained<EKCalendar>, String> {
        if let Some(name) = list.map(str::trim).filter(|n| !n.is_empty()) {
            let lists = unsafe { store.calendarsForEntityType(EKEntityType::Reminder) };
            if let Some(found) = lists.iter().find(|c| {
                unsafe { c.calendarIdentifier() }.to_string() == name
                    || unsafe { c.title() }.to_string().eq_ignore_ascii_case(name)
            }) {
                return Ok(found);
            }
            return Err(format!("There's no Reminders list called \"{name}\"."));
        }
        unsafe { store.defaultCalendarForNewReminders() }
            .ok_or_else(|| "Reminders has no default list. Create a list in the Reminders app first.".into())
    }

    pub fn create(title: &str, due: Option<Due>, list: Option<&str>) -> Result<Reminder, String> {
        let title = clean_title(title)?;
        let store = ready()?;
        let cal = pick_list(&store, list)?;
        let r = unsafe { EKReminder::reminderWithEventStore(&store) };
        unsafe {
            r.setTitle(Some(&NSString::from_str(&title)));
            r.setCalendar(Some(&cal));
        }
        apply_due(&r, due);
        save(&store, &r)?;
        Ok(snapshot(&r))
    }

    pub fn set_completed(id: &str, done: bool) -> Result<Reminder, String> {
        let store = ready()?;
        let r = find(&store, id)?;
        unsafe { r.setCompleted(done) };
        save(&store, &r)?;
        Ok(snapshot(&r))
    }

    pub fn set_due(id: &str, due: Option<Due>) -> Result<Reminder, String> {
        let store = ready()?;
        let r = find(&store, id)?;
        apply_due(&r, due);
        save(&store, &r)?;
        Ok(snapshot(&r))
    }

    pub fn get(id: &str) -> Result<Reminder, String> {
        let store = ready()?;
        let r = find(&store, id)?;
        Ok(snapshot(&r))
    }

    pub fn delete(id: &str) -> Result<Reminder, String> {
        let store = ready()?;
        let r = find(&store, id)?;
        let snap = snapshot(&r);
        unsafe { store.removeReminder_commit_error(&r, true) }
            .map_err(|e| format!("Reminders didn't delete it: {}", e.localizedDescription()))?;
        Ok(snap)
    }
}

/// Trims and checks a reminder title.
pub fn clean_title(raw: &str) -> Result<String, String> {
    let t = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() {
        return Err("A reminder needs a title.".into());
    }
    Ok(if t.chars().count() > MAX_TITLE { t.chars().take(MAX_TITLE).collect() } else { t })
}

/// True when a new title has a long word that neither the user nor the reply used,
/// like "appaecosysyem" for "appa": a sign Gemini's output went wrong.
pub fn garbled(title: &str, said: &str) -> bool {
    let said = said.to_lowercase();
    title
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .any(|w| w.chars().count() >= 8 && !said.contains(w))
}

/// The due date Gemini gave, from date + time (or the older single due field).
fn due_of(p: &Proposed) -> Result<Option<Due>, String> {
    let (date, time) = (p.date.trim(), p.time.trim());
    let text = if !date.is_empty() {
        if time.is_empty() { date.to_string() } else { format!("{date}T{time}") }
    } else {
        p.due.trim().to_string()
    };
    if text.is_empty() {
        return Ok(None);
    }
    parse_due(&text).map(Some).ok_or_else(|| format!("Couldn't read the date \"{text}\"."))
}

const TODAY_WORDS: [&str; 7] = ["today", "tonight", "innaiku", "inniku", "innikku", "indru", "இன்று"];
const TOMORROW_WORDS: [&str; 7] = ["tomorrow", "tmrw", "naalaiku", "nalaiku", "naalaikku", "naalai", "நாளை"];
const WEEKDAYS: [&str; 7] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/// Words of `text`, lowercased, with surrounding punctuation removed (":" and "." kept inside).
fn words(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase())
        .filter(|w| !w.is_empty())
        .collect()
}

/// "8", "8:30" or "8.30" → (hour, minute).
fn clock(w: &str) -> Option<(u32, u32)> {
    let (h, m) = match w.split_once([':', '.']) {
        Some((h, m)) => (h.parse().ok()?, m.parse().ok()?),
        None => (w.parse().ok()?, 0),
    };
    (h < 24 && m < 60).then_some((h, m))
}

fn with_meridiem(h: u32, m: u32, pm: bool) -> Option<(u32, u32)> {
    if !(1..=12).contains(&h) {
        return None;
    }
    Some((if pm { h % 12 + 12 } else { h % 12 }, m))
}

/// Finds a time in the words: "8pm", "8:30 am", "8 p.m." or "20:00". Returns it and
/// how many words it used, starting at which index.
fn find_time(ws: &[String]) -> Option<((u32, u32), usize, usize)> {
    for (i, w) in ws.iter().enumerate() {
        for (suffix, pm) in [("pm", true), ("am", false), ("p.m", true), ("a.m", false)] {
            if let Some(num) = w.strip_suffix(suffix) {
                if let Some((h, m)) = clock(num).and_then(|(h, m)| with_meridiem(h, m, pm)) {
                    return Some(((h, m), i, 1));
                }
            }
        }
        if let Some(next) = ws.get(i + 1) {
            let pm = match next.as_str() {
                "pm" | "p.m" => Some(true),
                "am" | "a.m" => Some(false),
                _ => None,
            };
            if let Some(pm) = pm {
                if let Some(t) = clock(w).and_then(|(h, m)| with_meridiem(h, m, pm)) {
                    return Some((t, i, 2));
                }
            }
        }
        if w.contains(':') {
            if let Some(t) = clock(w) {
                return Some((t, i, 1));
            }
        }
    }
    None
}

/// Days from today that a word names (today, naalaiku, friday…).
fn day_offset(w: &str, today: chrono::Weekday) -> Option<i64> {
    if TODAY_WORDS.contains(&w) {
        return Some(0);
    }
    if TOMORROW_WORDS.contains(&w) {
        return Some(1);
    }
    let target = WEEKDAYS.iter().position(|d| *d == w)? as i64;
    let now = today.num_days_from_monday() as i64;
    // The next one after today ("monday" on a Monday means next week).
    Some((target - now + 7 - 1) % 7 + 1)
}

/// Reads a simple day and time from what the user typed ("today 8pm", "naalaiku 6 pm",
/// "friday", "9:30 am"). A time with no day means today, or tomorrow if it's already past.
pub fn guess_due(text: &str, now: chrono::DateTime<chrono::Local>) -> Option<Due> {
    use chrono::{Datelike, Duration, Local, TimeZone};
    let ws = words(text);
    let offset = ws.iter().find_map(|w| day_offset(w, now.weekday()));
    let time = find_time(&ws).map(|(t, _, _)| t);
    let local = |date: chrono::NaiveDate, h: u32, m: u32| {
        Local.from_local_datetime(&date.and_hms_opt(h, m, 0)?).earliest().map(|d| d.timestamp_millis())
    };
    let today = now.date_naive();
    match (offset, time) {
        (Some(days), Some((h, m))) => local(today + Duration::days(days), h, m).map(|ms| Due { ms, all_day: false }),
        (None, Some((h, m))) => {
            let ms = local(today, h, m)?;
            let ms = if ms > now.timestamp_millis() { ms } else { local(today + Duration::days(1), h, m)? };
            Some(Due { ms, all_day: false })
        }
        (Some(days), None) => local(today + Duration::days(days), 0, 0).map(|ms| Due { ms, all_day: true }),
        (None, None) => None,
    }
}

/// Removes day and time words from a title: "Call Appa today at 8pm" → "Call Appa".
pub fn strip_when(title: &str) -> String {
    let raw: Vec<&str> = title.split_whitespace().collect();
    let ws: Vec<String> = raw.iter().map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()).collect();
    let mut drop = vec![false; raw.len()];
    if let Some((_, start, len)) = find_time(&ws) {
        drop[start..start + len].iter_mut().for_each(|d| *d = true);
    }
    for (i, w) in ws.iter().enumerate() {
        if day_offset(w, chrono::Weekday::Mon).is_some() {
            drop[i] = true;
        }
    }
    let mut kept: Vec<&str> = raw.iter().zip(&drop).filter(|(_, d)| !**d).map(|(w, _)| *w).collect();
    while kept.last().is_some_and(|w| ["at", "by", "on", "for", "-", "@"].contains(&w.to_lowercase().as_str())) {
        kept.pop();
    }
    let out = kept.join(" ");
    if out.trim().is_empty() { title.trim().to_string() } else { out }
}

/// Reads "2026-11-17T18:00" (a time) or "2026-11-17" (all day) as local time.
pub fn parse_due(s: &str) -> Option<Due> {
    use chrono::{Local, NaiveDate, NaiveDateTime, TimeZone};
    let s = s.trim();
    let local = |n: NaiveDateTime| Local.from_local_datetime(&n).earliest().map(|d| d.timestamp_millis());
    for f in ["%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(n) = NaiveDateTime::parse_from_str(s, f) {
            return local(n).map(|ms| Due { ms, all_day: false });
        }
    }
    let d = NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()?;
    local(d.and_hms_opt(0, 0, 0)?).map(|ms| Due { ms, all_day: true })
}

// ---------- commands ----------

macro_rules! blocking {
    ($body:expr) => {{
        #[cfg(target_os = "macos")]
        {
            tauri::async_runtime::spawn_blocking(move || $body).await.map_err(|e| e.to_string())?
        }
        #[cfg(not(target_os = "macos"))]
        {
            Err("Reminders only work on macOS.".to_string())
        }
    }};
}

#[tauri::command]
pub async fn reminders_status() -> Result<String, String> {
    blocking!(Ok(mac::status().to_string()))
}

#[tauri::command]
pub async fn request_reminders_access() -> Result<String, String> {
    blocking!(mac::request().map(String::from))
}

#[tauri::command]
pub async fn fetch_reminders() -> Result<RemindersData, String> {
    blocking!(mac::fetch())
}

#[tauri::command]
pub async fn complete_reminder(id: String, done: bool) -> Result<Reminder, String> {
    blocking!(mac::set_completed(&id, done))
}

/// Moves a reminder's due date (snooze, or Undo of a reschedule). `due` None clears it.
#[tauri::command]
pub async fn set_reminder_due(id: String, due: Option<Due>) -> Result<Reminder, String> {
    blocking!(mac::set_due(&id, due))
}

/// Deletes a reminder. Called only from the panel, after the user confirms (or to
/// undo a reminder The Boss itself just created).
#[tauri::command]
pub async fn delete_reminder(id: String) -> Result<Reminder, String> {
    blocking!(mac::delete(&id))
}

/// Recreates a deleted reminder (Undo).
#[tauri::command]
pub async fn restore_reminder(reminder: Reminder) -> Result<Reminder, String> {
    blocking!({
        let due = reminder.due_ms.map(|ms| Due { ms, all_day: reminder.all_day });
        mac::create(&reminder.title, due, Some(&reminder.list_id))
    })
}

#[tauri::command]
pub fn open_reminders_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders")
        .status()
        .map(|_| ())
        .map_err(|_| "Couldn't open System Settings.".to_string())
}

// ---------- changes asked for in chat ----------

/// One reminder change Gemini asked for alongside its reply.
#[derive(Deserialize, Debug, Default)]
pub struct Proposed {
    pub action: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    /// "YYYY-MM-DD", or "" for no date.
    #[serde(default)]
    pub date: String,
    /// "HH:MM" (24-hour), or "" for a whole day.
    #[serde(default)]
    pub time: String,
    /// Older single field: "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD".
    #[serde(default)]
    pub due: String,
    #[serde(default)]
    pub list: String,
}

/// What happened, shown under the reply.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    /// "created", "completed", "rescheduled", "confirmDelete" or "skipped"
    pub kind: &'static str,
    pub item: Option<Reminder>,
    /// The due date before a reschedule, for Undo.
    pub before_due: Option<Due>,
    pub note: Option<String>,
}

fn skipped(note: String) -> Applied {
    Applied { kind: "skipped", item: None, before_due: None, note: Some(note) }
}

/// Applies chat's reminder changes. Deletes are never done here: they come back as
/// "confirmDelete" so the panel can ask the user first.
pub async fn apply(
    proposed: Vec<Proposed>,
    hidden_lists: Vec<String>,
    user_text: String,
    reply: String,
) -> Vec<Applied> {
    if proposed.is_empty() {
        return Vec::new();
    }
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            proposed.into_iter().take(10).map(|p| apply_one(p, &hidden_lists, &user_text, &reply)).collect()
        })
        .await
        .unwrap_or_else(|e| vec![skipped(e.to_string())])
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (hidden_lists, user_text, reply);
        vec![skipped("Reminders only work on macOS.".into())]
    }
}

#[cfg(target_os = "macos")]
fn apply_one(p: Proposed, hidden_lists: &[String], user_text: &str, reply: &str) -> Applied {
    let due = || due_of(&p);
    let said = format!("{user_text}\n{reply}");
    let result = match p.action.as_str() {
        "create" if garbled(&p.title, &said) => Err(format!(
            "The title came out garbled (\"{}\"), so nothing was saved. Please ask again.",
            p.title.trim()
        )),
        "create" => due().and_then(|d| {
            // Backup: if Gemini left the time out, read it from what the user typed.
            let d = d.or_else(|| guess_due(user_text, chrono::Local::now()));
            // A time in the title belongs in the due date instead ("Call Appa today 8pm").
            let title = if d.is_some() { strip_when(&p.title) } else { p.title.clone() };
            let list = Some(p.list.as_str()).filter(|l| !l.trim().is_empty());
            mac::create(&title, d, list)
                .map(|item| Applied { kind: "created", item: Some(item), before_due: None, note: None })
        }),
        "complete" => mac::get(&p.id).and_then(|r| {
            if hidden_lists.contains(&r.list_id) {
                return Err("That reminder is in a hidden list.".into());
            }
            mac::set_completed(&p.id, true)
                .map(|item| Applied { kind: "completed", item: Some(item), before_due: None, note: None })
        }),
        "reschedule" => due().and_then(|d| {
            let before = mac::get(&p.id)?;
            if hidden_lists.contains(&before.list_id) {
                return Err("That reminder is in a hidden list.".into());
            }
            let before_due = before.due_ms.map(|ms| Due { ms, all_day: before.all_day });
            mac::set_due(&p.id, d)
                .map(|item| Applied { kind: "rescheduled", item: Some(item), before_due, note: None })
        }),
        "delete" => mac::get(&p.id)
            .map(|item| Applied { kind: "confirmDelete", item: Some(item), before_due: None, note: None }),
        other => Err(format!("Unknown reminder action \"{other}\".")),
    };
    result.unwrap_or_else(skipped)
}

/// Open reminders due in a range, as lines for Gemini's lookups. None without access.
pub async fn lines_between(from_ms: i64, to_ms: i64, hidden_lists: Vec<String>) -> Result<Option<Vec<String>>, String> {
    #[cfg(target_os = "macos")]
    {
        if mac::status() != "granted" {
            return Ok(None);
        }
        let items = tauri::async_runtime::spawn_blocking(move || mac::open_between(from_ms, to_ms))
            .await
            .map_err(|e| e.to_string())??;
        return Ok(Some(
            items
                .iter()
                .filter(|r| !hidden_lists.contains(&r.list_id))
                .map(|r| {
                    let when = r.due_ms.map(|ms| crate::lookup::when(ms, None, r.all_day)).unwrap_or_default();
                    format!("- {when} · Reminder ({}) [{}] · {}", r.list_title, r.id, r.title)
                })
                .collect(),
        ));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (from_ms, to_ms, hidden_lists);
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_due_dates() {
        let timed = parse_due("2026-11-17T18:00").unwrap();
        assert!(!timed.all_day);
        let day = parse_due("2026-11-17").unwrap();
        assert!(day.all_day);
        assert_eq!(timed.ms - day.ms, 18 * 60 * 60 * 1000);
        assert!(parse_due("tomorrow").is_none());
        assert!(clean_title("  ").is_err());
        assert_eq!(clean_title(" Call   Amma ").unwrap(), "Call Amma");
        let said = "add a todo to call appa today 8pm\nReminder set: call appa, Monday Nov 16, 8:00 PM.";
        assert!(garbled("call appaecosysyem", said));
        assert!(!garbled("Call Appa", said));
        assert!(!garbled("Submit Databases assignment", "remind me to submit the databases assignment"));
        assert!(!garbled("அப்பாவை அழை", "அப்பாவை அழை இன்று 8 மணிக்கு"));
    }

    #[test]
    fn reads_times_the_user_typed() {
        use chrono::{Datelike, Local, TimeZone, Timelike};
        // Monday, Nov 16, 2026, 3:00 PM
        let now = Local.with_ymd_and_hms(2026, 11, 16, 15, 0, 0).unwrap();
        let at = |d: Due| Local.timestamp_millis_opt(d.ms).unwrap();

        let d = guess_due("add a todo to call appa today 8pm", now).unwrap();
        assert!(!d.all_day);
        assert_eq!((at(d).day(), at(d).hour(), at(d).minute()), (16, 20, 0));

        let d = guess_due("remind me naalaiku 6:30 pm to pay fees", now).unwrap();
        assert_eq!((at(d).day(), at(d).hour(), at(d).minute()), (17, 18, 30));

        // 9 am already passed today, so tomorrow.
        let d = guess_due("call the bank at 9 am", now).unwrap();
        assert_eq!((at(d).day(), at(d).hour()), (17, 9));

        let d = guess_due("submit form friday", now).unwrap();
        assert!(d.all_day);
        assert_eq!(at(d).day(), 20);

        assert!(guess_due("add milk to my list", now).is_none());

        assert_eq!(strip_when("Call Appa today 8pm"), "Call Appa");
        assert_eq!(strip_when("Call appa at 8 pm today"), "Call appa");
        assert_eq!(strip_when("Pay fees naalaiku"), "Pay fees");
        assert_eq!(strip_when("Buy milk"), "Buy milk");
    }
}
