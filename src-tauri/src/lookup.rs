//! Lets chat look further than the panel's 7 days: when Gemini needs another
//! date range, The Boss reads that range from the Mac Calendar, Canvas and Reminders and
//! sends it back as data.

use chrono::{Local, NaiveDate, TimeZone};

/// Longest range one lookup may cover.
const MAX_DAYS: i64 = 366;
/// Most lines sent back from one source.
const MAX_LINES: usize = 400;

/// "Thu, Nov 27, 2026, 9:00 AM–10:00 AM", or "Thu, Nov 27, 2026, all day".
pub fn when(start_ms: i64, end_ms: Option<i64>, all_day: bool) -> String {
    let fmt = |ms: i64, f: &str| {
        Local.timestamp_millis_opt(ms).single().map(|d| d.format(f).to_string()).unwrap_or_default()
    };
    if all_day {
        return format!("{}, all day", fmt(start_ms, "%a, %b %-d, %Y"));
    }
    let start = fmt(start_ms, "%a, %b %-d, %Y, %-I:%M %p");
    match end_ms {
        Some(end) if end > start_ms => format!("{start}–{}", fmt(end, "%-I:%M %p")),
        _ => start,
    }
}

fn local_midnight(d: NaiveDate) -> Option<i64> {
    Local.from_local_datetime(&d.and_hms_opt(0, 0, 0)?).earliest().map(|t| t.timestamp_millis())
}

/// Reads calendar events and Canvas items from `from` to `to` (inclusive, YYYY-MM-DD)
/// and returns them as text for Gemini.
pub async fn run(from: &str, to: &str, hidden: Vec<String>, hidden_lists: Vec<String>) -> String {
    let (Ok(start), Ok(end)) = (
        NaiveDate::parse_from_str(from.trim(), "%Y-%m-%d"),
        NaiveDate::parse_from_str(to.trim(), "%Y-%m-%d"),
    ) else {
        return "The lookup dates weren't valid (use YYYY-MM-DD).".into();
    };
    let (start, mut end) = if end < start { (end, start) } else { (start, end) };
    let mut note = String::new();
    if (end - start).num_days() >= MAX_DAYS {
        end = start + chrono::Duration::days(MAX_DAYS - 1);
        note = format!(" (shortened to {MAX_DAYS} days)");
    }
    let (Some(from_ms), Some(to_ms)) = (local_midnight(start), local_midnight(end + chrono::Duration::days(1)))
    else {
        return "The lookup dates weren't valid.".into();
    };
    eprintln!("[ask] lookup {start} to {end}");

    let mut out = vec![format!("Looked up {start} to {end}{note}.")];
    let mut section = |name: &str, result: Result<Option<Vec<String>>, String>, missing: &str| {
        out.push(String::new());
        out.push(format!("{name}:"));
        match result {
            Ok(None) => out.push(format!("- {missing}")),
            Ok(Some(lines)) if lines.is_empty() => out.push("- Nothing in this range.".into()),
            Ok(Some(mut lines)) => {
                if lines.len() > MAX_LINES {
                    lines.truncate(MAX_LINES);
                    lines.push("- (more not shown; ask about a shorter range)".into());
                }
                out.extend(lines);
            }
            Err(e) => out.push(format!("- Couldn't check: {e}")),
        }
    };
    section(
        "Mac Calendar",
        crate::calendar::lines_between(from_ms, to_ms, hidden).await,
        "Calendar access isn't allowed yet.",
    );
    section("Canvas", crate::canvas::lines_between(from_ms, to_ms).await, "Canvas isn't connected yet.");
    section(
        "Reminders (open, with a due date in this range)",
        crate::reminders::lines_between(from_ms, to_ms, hidden_lists).await,
        "Reminders access isn't allowed yet.",
    );
    out.join("\n")
}
