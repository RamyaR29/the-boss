//! Reads Canvas deadlines and course events from the user's private Canvas
//! calendar feed link (an iCalendar .ics URL). Read-only.
//!
//! The link works like a password, so it lives in the macOS Keychain, is read
//! only here, is never sent back to the web view and is never logged. Feed text
//! is treated purely as data.

use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use reqwest::Url;
use serde::Serialize;

use crate::keychain::{delete_secret, read_secret, save_secret};

const ACCOUNT: &str = "canvas-feed-url";
/// Refuse feeds bigger than this (a normal student feed is well under 1 MB).
const MAX_BYTES: usize = 5 * 1024 * 1024;
/// Only items from this far back (to cover earlier today) ...
const KEEP_PAST: chrono::Duration = chrono::Duration::days(2);
/// ... up to this far ahead are sent to the web view, which picks the exact window.
const KEEP_AHEAD: chrono::Duration = chrono::Duration::days(15);
const MAX_ITEMS: usize = 300;

/// The link, kept in memory after the first Keychain read so macOS doesn't
/// ask again on every hourly refresh. `Some(None)` means "checked: no link saved".
static CACHED: Mutex<Option<Option<String>>> = Mutex::new(None);

const RESET_HINT: &str = "Canvas didn't accept the feed link. It may have been reset. \
Copy a fresh one from Canvas → Calendar → Calendar Feed and paste it again.";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasItem {
    uid: String,
    /// "assignment" (something due) or "event" (a course calendar event)
    kind: &'static str,
    title: String,
    course: Option<String>,
    /// Due time or start time, in milliseconds since 1970 (UTC).
    /// For all-day items, local midnight of that day.
    start_ms: i64,
    all_day: bool,
    /// Link to the item in Canvas (same site as the feed), if the feed gave one.
    url: Option<String>,
}

// ---------- the link ----------

/// Turns what the user pasted into a checked https feed URL.
fn normalize(raw: &str) -> Result<Url, String> {
    let raw = raw.trim();
    let fixed = match raw.strip_prefix("webcal://") {
        Some(rest) => format!("https://{rest}"),
        None => raw.to_string(),
    };
    let url = Url::parse(&fixed).map_err(|_| {
        "That doesn't look like a link. Copy it from Canvas → Calendar → Calendar Feed.".to_string()
    })?;
    if url.scheme() != "https" {
        return Err("The feed link should start with https://.".into());
    }
    let path = url.path();
    if !path.contains("/feeds/calendars/") && !path.ends_with(".ics") {
        return Err("That doesn't look like a Canvas calendar feed link. In Canvas, open Calendar, \
click \"Calendar Feed\" and copy the link shown there."
            .into());
    }
    Ok(url)
}

async fn saved_link() -> Result<Option<String>, String> {
    if let Some(cached) = CACHED.lock().unwrap().clone() {
        return Ok(cached);
    }
    // Keychain reads can block on a macOS permission prompt, so keep them off the async runtime.
    let link = tauri::async_runtime::spawn_blocking(|| read_secret(ACCOUNT))
        .await
        .map_err(|e| format!("Keychain read failed: {e}"))??;
    *CACHED.lock().unwrap() = Some(link.clone());
    Ok(link)
}

// ---------- download ----------

async fn download(url: &Url) -> Result<String, String> {
    // Canvas refuses requests that don't name their app (403), so say who we are.
    let client = reqwest::Client::builder()
        .user_agent(concat!("TheBoss/", env!("CARGO_PKG_VERSION"), " (calendar feed reader)"))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Couldn't start the network connection.".to_string())?;
    let resp = client.get(url.clone()).send().await.map_err(network_error)?;
    let status = resp.status().as_u16();
    eprintln!("[canvas] feed answered {status}");
    if matches!(status, 401 | 403 | 404 | 410) {
        return Err(RESET_HINT.into());
    }
    if !resp.status().is_success() {
        return Err(format!("Canvas answered with an error ({status}). Try Refresh in a bit."));
    }
    if resp.content_length().is_some_and(|n| n as usize > MAX_BYTES) {
        return Err("The Canvas feed is unexpectedly large, so The Boss skipped it.".into());
    }
    let bytes = resp.bytes().await.map_err(network_error)?;
    if bytes.len() > MAX_BYTES {
        return Err("The Canvas feed is unexpectedly large, so The Boss skipped it.".into());
    }
    let text = String::from_utf8_lossy(&bytes).into_owned();
    if !text.contains("BEGIN:VCALENDAR") {
        return Err("That link didn't return a calendar. Check it's the Calendar Feed link from Canvas.".into());
    }
    Ok(text)
}

/// A friendly message for a network failure. Never includes the link itself.
fn network_error(e: reqwest::Error) -> String {
    let e = e.without_url();
    eprintln!("[canvas] network error: {e}");
    if e.is_timeout() {
        "Canvas took too long to answer. Check your internet and try Refresh.".into()
    } else if e.is_connect() {
        "Couldn't reach Canvas. Check your internet connection.".into()
    } else {
        "Couldn't download the Canvas feed. Try Refresh in a bit.".into()
    }
}

async fn fetch_items(url: &Url) -> Result<Vec<CanvasItem>, String> {
    let text = download(url).await?;
    let items = parse_feed(&text, url.host_str().unwrap_or(""), Utc::now());
    eprintln!("[canvas] read {} upcoming item(s)", items.len());
    Ok(items)
}

// ---------- commands ----------

/// Checks the pasted link by reading it once, then saves it in the Keychain.
#[tauri::command]
pub async fn save_canvas_feed(link: String) -> Result<Vec<CanvasItem>, String> {
    let url = normalize(&link)?;
    let items = fetch_items(&url).await?;
    let value = url.to_string();
    let to_save = value.clone();
    tauri::async_runtime::spawn_blocking(move || save_secret(ACCOUNT, &to_save))
        .await
        .map_err(|e| format!("Keychain write failed: {e}"))??;
    *CACHED.lock().unwrap() = Some(Some(value));
    Ok(items)
}

#[tauri::command]
pub async fn delete_canvas_feed() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| delete_secret(ACCOUNT))
        .await
        .map_err(|e| format!("Keychain write failed: {e}"))??;
    *CACHED.lock().unwrap() = Some(None);
    Ok(())
}

/// Upcoming Canvas items, or None when no feed link is saved yet.
#[tauri::command]
pub async fn fetch_canvas() -> Result<Option<Vec<CanvasItem>>, String> {
    let Some(link) = saved_link().await? else {
        return Ok(None);
    };
    let url = normalize(&link)?;
    fetch_items(&url).await.map(Some)
}

/// Opens a Canvas item in the default browser. Only https links on the same
/// Canvas site as the saved feed are allowed.
#[tauri::command]
pub async fn open_canvas_link(url: String) -> Result<(), String> {
    let target = Url::parse(&url).map_err(|_| "That isn't a valid link.".to_string())?;
    let feed = saved_link()
        .await?
        .and_then(|l| Url::parse(&l).ok())
        .ok_or("Connect Canvas first.")?;
    if target.scheme() != "https" || target.host_str() != feed.host_str() {
        return Err("The Boss only opens links on your Canvas site.".into());
    }
    Command::new("open")
        .arg(target.as_str())
        .status()
        .map_err(|_| "Couldn't open the browser.".to_string())?;
    Ok(())
}

// ---------- parsing (.ics) ----------

/// Joins folded lines: a line that starts with a space or tab continues the previous one.
fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if let (Some(rest), Some(last)) = (
            line.strip_prefix(' ').or_else(|| line.strip_prefix('\t')),
            lines.last_mut(),
        ) {
            last.push_str(rest);
        } else {
            lines.push(line.to_string());
        }
    }
    lines
}

struct Prop {
    name: String,
    params: Vec<(String, String)>,
    value: String,
}

impl Prop {
    fn param(&self, key: &str) -> Option<&str> {
        self.params
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v.as_str())
    }
}

/// Splits `NAME;PARAM=x;PARAM2="y":value`, ignoring `:` and `;` inside quotes.
fn parse_prop(line: &str) -> Option<Prop> {
    let mut in_quote = false;
    let mut colon = None;
    for (i, c) in line.char_indices() {
        match c {
            '"' => in_quote = !in_quote,
            ':' if !in_quote => {
                colon = Some(i);
                break;
            }
            _ => {}
        }
    }
    let colon = colon?;
    let (head, value) = (&line[..colon], &line[colon + 1..]);
    let mut parts = Vec::new();
    let mut cur = String::new();
    in_quote = false;
    for c in head.chars() {
        match c {
            '"' => in_quote = !in_quote,
            ';' if !in_quote => parts.push(std::mem::take(&mut cur)),
            _ => cur.push(c),
        }
    }
    parts.push(cur);
    let name = parts.remove(0).to_ascii_uppercase();
    let params = parts
        .into_iter()
        .filter_map(|p| {
            let (k, v) = p.split_once('=')?;
            Some((k.to_string(), v.to_string()))
        })
        .collect();
    Some(Prop { name, params, value: value.to_string() })
}

/// Undoes iCalendar text escaping (`\n`, `\,`, `\;`, `\\`).
fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') | Some('N') => out.push(' '),
                Some(other) => out.push(other),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out.trim().to_string()
}

enum When {
    At(DateTime<Utc>),
    Day(NaiveDate),
}

fn in_zone<Tz: TimeZone>(tz: &Tz, naive: NaiveDateTime) -> Option<DateTime<Utc>> {
    // A time skipped by a daylight-saving jump: use the hour after.
    tz.from_local_datetime(&naive)
        .earliest()
        .or_else(|| tz.from_local_datetime(&(naive + chrono::Duration::hours(1))).earliest())
        .map(|d| d.with_timezone(&Utc))
}

fn parse_when(prop: &Prop) -> Option<When> {
    let v = prop.value.trim();
    let date_only = prop.param("VALUE").is_some_and(|x| x.eq_ignore_ascii_case("DATE")) || v.len() == 8;
    if date_only {
        return NaiveDate::parse_from_str(v, "%Y%m%d").ok().map(When::Day);
    }
    if let Some(utc) = v.strip_suffix('Z') {
        let naive = NaiveDateTime::parse_from_str(utc, "%Y%m%dT%H%M%S").ok()?;
        return Some(When::At(naive.and_utc()));
    }
    let naive = NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S").ok()?;
    let zone = prop
        .param("TZID")
        .and_then(|id| id.trim_start_matches('/').parse::<chrono_tz::Tz>().ok());
    match zone {
        Some(tz) => in_zone(&tz, naive),
        // No zone (or one we don't know): treat as this Mac's local time.
        None => in_zone(&Local, naive),
    }
    .map(When::At)
}

/// "Homework 3 [CS 101]" → ("Homework 3", Some("CS 101")).
fn split_course(summary: &str) -> (String, Option<String>) {
    if let Some(body) = summary.strip_suffix(']') {
        if let Some(i) = body.rfind(" [") {
            let course = body[i + 2..].trim();
            if !course.is_empty() {
                return (body[..i].trim().to_string(), Some(course.to_string()));
            }
        }
    }
    (summary.to_string(), None)
}

fn clip(s: String, max: usize) -> String {
    if s.chars().count() <= max { s } else { s.chars().take(max).collect::<String>() + "…" }
}

#[derive(Default)]
struct RawEvent {
    uid: String,
    summary: String,
    start: Option<Prop>,
    url: Option<String>,
}

fn finish(ev: RawEvent, feed_host: &str) -> Option<CanvasItem> {
    let when = parse_when(ev.start.as_ref()?)?;
    let (start, all_day) = match when {
        When::At(t) => (t, false),
        When::Day(d) => (in_zone(&Local, d.and_hms_opt(0, 0, 0)?)?, true),
    };
    let (title, course) = split_course(&unescape(&ev.summary));
    let title = if title.is_empty() { "(untitled)".to_string() } else { clip(title, 200) };
    let url = ev.url.and_then(|u| {
        let parsed = Url::parse(u.trim()).ok()?;
        (parsed.scheme() == "https" && parsed.host_str() == Some(feed_host)).then(|| parsed.to_string())
    });
    let kind = if ev.uid.contains("assignment") { "assignment" } else { "event" };
    Some(CanvasItem {
        uid: clip(ev.uid, 200),
        kind,
        title,
        course: course.map(|c| clip(c, 120)),
        start_ms: start.timestamp_millis(),
        all_day,
        url,
    })
}

/// Reads every VEVENT and keeps the ones near `now`, sorted by time.
fn parse_feed(text: &str, feed_host: &str, now: DateTime<Utc>) -> Vec<CanvasItem> {
    let mut items = Vec::new();
    let mut current: Option<RawEvent> = None;
    // Depth of components nested inside an event (e.g. VALARM), whose fields we skip.
    let mut nested = 0;
    for line in unfold(text) {
        let Some(prop) = parse_prop(&line) else { continue };
        match (prop.name.as_str(), prop.value.trim().to_ascii_uppercase().as_str()) {
            ("BEGIN", "VEVENT") if current.is_none() => current = Some(RawEvent::default()),
            ("BEGIN", _) if current.is_some() => nested += 1,
            ("END", "VEVENT") if nested == 0 => {
                if let Some(item) = current.take().and_then(|ev| finish(ev, feed_host)) {
                    items.push(item);
                }
            }
            ("END", _) if current.is_some() && nested > 0 => nested -= 1,
            _ => {
                let Some(ev) = current.as_mut().filter(|_| nested == 0) else { continue };
                match prop.name.as_str() {
                    "UID" => ev.uid = prop.value.trim().to_string(),
                    "SUMMARY" => ev.summary = prop.value.clone(),
                    "URL" => ev.url = Some(prop.value.clone()),
                    "DTSTART" => ev.start = Some(prop),
                    _ => {}
                }
            }
        }
    }
    let from = (now - KEEP_PAST).timestamp_millis();
    let to = (now + KEEP_AHEAD).timestamp_millis();
    items.retain(|i| i.start_ms >= from && i.start_ms <= to);
    items.sort_by_key(|i| i.start_ms);
    items.dedup_by(|a, b| a.uid == b.uid && !a.uid.is_empty());
    items.truncate(MAX_ITEMS);
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = "BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Instructure//Canvas//EN\r\n\
BEGIN:VEVENT\r\n\
UID:event-assignment-101\r\n\
DTSTART:20261116T045900Z\r\n\
DTEND:20261116T045900Z\r\n\
SUMMARY:Lab report\\, draft 2 [CHEM 110 Section\r\n  A]\r\n\
URL;VALUE=URI:https://school.instructure.com/courses/1/assignments/101\r\n\
BEGIN:VALARM\r\n\
SUMMARY:ignore me\r\n\
END:VALARM\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:event-calendar-event-7\r\n\
DTSTART;TZID=America/New_York:20261117T140000\r\n\
SUMMARY:Office hours [MATH 201]\r\n\
URL:https://evil.example.com/x\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:event-calendar-event-8\r\n\
DTSTART;VALUE=DATE:20261118\r\n\
SUMMARY:Reading day\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:event-assignment-old\r\n\
DTSTART:20250101T000000Z\r\n\
SUMMARY:Long gone\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

    #[test]
    fn parses_canvas_feed() {
        let now = Utc.with_ymd_and_hms(2026, 11, 15, 12, 0, 0).unwrap();
        let items = parse_feed(FEED, "school.instructure.com", now);
        assert_eq!(items.len(), 3, "old item dropped");

        let a = &items[0];
        assert_eq!(a.kind, "assignment");
        assert_eq!(a.title, "Lab report, draft 2");
        assert_eq!(a.course.as_deref(), Some("CHEM 110 Section A"));
        assert_eq!(a.start_ms, Utc.with_ymd_and_hms(2026, 11, 16, 4, 59, 0).unwrap().timestamp_millis());
        assert!(a.url.as_deref().unwrap().starts_with("https://school.instructure.com/"));

        let e = &items[1];
        assert_eq!(e.kind, "event");
        assert_eq!(e.title, "Office hours");
        // 2 pm in New York in November is 7 pm UTC.
        assert_eq!(e.start_ms, Utc.with_ymd_and_hms(2026, 11, 17, 19, 0, 0).unwrap().timestamp_millis());
        assert_eq!(e.url, None, "links to other sites are dropped");

        assert!(items[2].all_day);
        assert_eq!(items[2].course, None);
    }

    #[test]
    fn checks_links() {
        assert!(normalize("webcal://school.instructure.com/feeds/calendars/user_abc.ics").is_ok());
        assert!(normalize("http://school.instructure.com/feeds/calendars/user_abc.ics").is_err());
        assert!(normalize("https://example.com/hello").is_err());
        assert!(normalize("not a link").is_err());
    }
}
