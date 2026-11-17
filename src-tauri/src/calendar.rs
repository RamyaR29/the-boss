//! Reads events from the Mac's Calendar app (EventKit). Read-only: The Boss
//! never creates, changes or deletes events. macOS asks the user once for
//! access. Event notes are never read; titles and locations are data only.

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarInfo {
    id: String,
    title: String,
    /// The account it belongs to, e.g. "iCloud" or a Google address.
    account: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    /// Unique per occurrence (repeating events share an EventKit id).
    uid: String,
    title: String,
    calendar_id: String,
    start_ms: i64,
    end_ms: i64,
    all_day: bool,
    location: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarData {
    calendars: Vec<CalendarInfo>,
    events: Vec<CalendarEvent>,
}

/// Longest time span one fetch may cover.
const MAX_SPAN_MS: i64 = 31 * 24 * 60 * 60 * 1000;
const MAX_EVENTS: usize = 500;

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_event_kit::{EKAuthorizationStatus, EKEntityType, EKEventStore};
    use objc2_foundation::{NSDate, NSError};

    pub fn status() -> &'static str {
        let s = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };
        match s {
            EKAuthorizationStatus::FullAccess => "granted",
            EKAuthorizationStatus::Denied => "denied",
            EKAuthorizationStatus::Restricted => "restricted",
            EKAuthorizationStatus::WriteOnly => "writeOnly",
            _ => "notDetermined",
        }
    }

    /// Shows the macOS permission prompt (only the first time) and waits for the answer.
    pub fn request() -> Result<&'static str, String> {
        let store = unsafe { EKEventStore::new() };
        let (tx, rx) = mpsc::channel::<bool>();
        let block = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
            let _ = tx.send(granted.as_bool());
        });
        unsafe { store.requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&block)) };
        // The user may take a while to answer the prompt.
        match rx.recv_timeout(Duration::from_secs(300)) {
            Ok(_) => Ok(status()),
            Err(_) => Err("No answer to the calendar permission prompt.".into()),
        }
    }

    pub fn fetch(from_ms: i64, to_ms: i64) -> Result<CalendarData, String> {
        if status() != "granted" {
            return Err("The Boss doesn't have calendar access yet.".into());
        }
        let store = unsafe { EKEventStore::new() };
        let mut calendars = Vec::new();
        for cal in unsafe { store.calendarsForEntityType(EKEntityType::Event) }.iter() {
            let account = unsafe { cal.source() }
                .map(|s| unsafe { s.title() }.to_string())
                .unwrap_or_default();
            calendars.push(CalendarInfo {
                id: unsafe { cal.calendarIdentifier() }.to_string(),
                title: unsafe { cal.title() }.to_string(),
                account,
            });
        }

        let start = NSDate::dateWithTimeIntervalSince1970(from_ms as f64 / 1000.0);
        let end = NSDate::dateWithTimeIntervalSince1970(to_ms as f64 / 1000.0);
        let predicate =
            unsafe { store.predicateForEventsWithStartDate_endDate_calendars(&start, &end, None) };
        let mut events = Vec::new();
        for ev in unsafe { store.eventsMatchingPredicate(&predicate) }.iter() {
            let ms = |d: &NSDate| (d.timeIntervalSince1970() * 1000.0).round() as i64;
            let start_ms = ms(&*unsafe { ev.startDate() });
            let end_ms = ms(&*unsafe { ev.endDate() });
            let id = unsafe { ev.eventIdentifier() }.map(|s| s.to_string()).unwrap_or_default();
            let calendar_id = unsafe { ev.calendar() }
                .map(|c| unsafe { c.calendarIdentifier() }.to_string())
                .unwrap_or_default();
            let title = clip(unsafe { ev.title() }.to_string(), 200);
            let location = unsafe { ev.location() }
                .map(|l| clip(l.to_string(), 120))
                .filter(|l| !l.trim().is_empty());
            events.push(CalendarEvent {
                uid: format!("{id}@{start_ms}"),
                title: if title.trim().is_empty() { "(no title)".into() } else { title },
                calendar_id,
                start_ms,
                end_ms,
                all_day: unsafe { ev.isAllDay() },
                location,
            });
        }
        events.sort_by_key(|e| e.start_ms);
        events.truncate(MAX_EVENTS * 4);
        Ok(CalendarData { calendars, events })
    }

    fn clip(s: String, max: usize) -> String {
        let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
        if s.chars().count() <= max { s } else { s.chars().take(max).collect::<String>() + "…" }
    }
}

/// Calendar events between two moments, as lines for Gemini, skipping hidden calendars.
/// None when calendar access isn't allowed.
pub async fn lines_between(from_ms: i64, to_ms: i64, hidden: Vec<String>) -> Result<Option<Vec<String>>, String> {
    #[cfg(target_os = "macos")]
    {
        if mac::status() != "granted" {
            return Ok(None);
        }
        let data = tauri::async_runtime::spawn_blocking(move || mac::fetch(from_ms, to_ms))
            .await
            .map_err(|e| e.to_string())??;
        let title = |id: &str| {
            data.calendars.iter().find(|c| c.id == id).map(|c| c.title.as_str()).unwrap_or("Calendar")
        };
        return Ok(Some(
            data.events
                .iter()
                .filter(|e| !hidden.contains(&e.calendar_id))
                .map(|e| {
                    let place = e.location.as_deref().map(|l| format!(" @ {l}")).unwrap_or_default();
                    format!(
                        "- {} · Calendar event ({}) · {}{place}",
                        crate::lookup::when(e.start_ms, Some(e.end_ms), e.all_day),
                        title(&e.calendar_id),
                        e.title
                    )
                })
                .collect(),
        ));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (from_ms, to_ms, hidden);
        Ok(None)
    }
}

/// "notDetermined", "granted", "denied", "restricted" or "writeOnly".
#[tauri::command]
pub async fn calendar_status() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    return Ok(mac::status().to_string());
    #[cfg(not(target_os = "macos"))]
    Err("The calendar only works on macOS.".into())
}

#[tauri::command]
pub async fn request_calendar_access() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(mac::request)
        .await
        .map_err(|e| e.to_string())?
        .map(String::from);
    #[cfg(not(target_os = "macos"))]
    Err("The calendar only works on macOS.".into())
}

/// Calendars and events between two moments (ms since 1970).
#[tauri::command]
pub async fn fetch_calendar(from_ms: i64, to_ms: i64) -> Result<CalendarData, String> {
    if to_ms <= from_ms || to_ms - from_ms > MAX_SPAN_MS {
        return Err("Invalid date range.".into());
    }
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(move || mac::fetch(from_ms, to_ms))
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    Err("The calendar only works on macOS.".into())
}

/// Opens System Settings at Privacy & Security → Calendars, to turn access back on.
#[tauri::command]
pub fn open_calendar_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars")
        .status()
        .map(|_| ())
        .map_err(|_| "Couldn't open System Settings.".to_string())
}
