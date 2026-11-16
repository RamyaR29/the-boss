//! The Boss's memory: short facts about the user, kept in one JSON file on this
//! Mac (~/Library/Application Support/com.ramyar29.theboss/memory.json).
//!
//! Facts are added, changed or forgotten from the Memory section or through chat.
//! Every change, whoever proposes it, passes `check_text`, which refuses
//! passwords, ID and card numbers and health details.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const MAX_ITEMS: usize = 200;
const MAX_CHARS: usize = 300;

/// Only one read-modify-write of the file at a time.
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub id: String,
    pub text: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MemoryFile {
    next_id: u64,
    items: Vec<Memory>,
}

impl MemoryFile {
    fn find(&self, id: &str) -> Option<usize> {
        self.items.iter().position(|m| m.id == id)
    }

    fn add(&mut self, text: String) -> Result<Memory, String> {
        if self.items.len() >= MAX_ITEMS {
            return Err(format!("Memory is full ({MAX_ITEMS} things). Delete some first."));
        }
        self.next_id += 1;
        let now = now_ms();
        let m = Memory { id: format!("m{}", self.next_id), text, created_at: now, updated_at: now };
        self.items.push(m.clone());
        Ok(m)
    }

    fn has_text(&self, text: &str) -> bool {
        self.items.iter().any(|m| m.text.eq_ignore_ascii_case(text))
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Couldn't find the app data folder: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create the app data folder: {e}"))?;
    Ok(dir.join("memory.json"))
}

fn read(app: &AppHandle) -> Result<MemoryFile, String> {
    match fs::read_to_string(path(app)?) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("The memory file is damaged: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(MemoryFile::default()),
        Err(e) => Err(format!("Couldn't read memory: {e}")),
    }
}

fn write(app: &AppHandle, file: &MemoryFile) -> Result<(), String> {
    let path = path(app)?;
    let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    // Write to a temp file and rename, so a crash never leaves a half-written file.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("Couldn't save memory: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Couldn't save memory: {e}"))
}

/// Runs `f` on the memory file and saves it if `f` succeeds.
fn edit<T>(app: &AppHandle, f: impl FnOnce(&mut MemoryFile) -> Result<T, String>) -> Result<T, String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut file = read(app)?;
    let out = f(&mut file)?;
    write(app, &file)?;
    Ok(out)
}

// ---------- what may be remembered ----------

/// Cleans up a fact and refuses things The Boss must never store.
pub fn check_text(raw: &str) -> Result<String, String> {
    let text = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err("There's nothing to remember.".into());
    }
    if let Some(what) = sensitive(&text) {
        return Err(format!(
            "The Boss doesn't keep {what}, since memories are sent to Gemini with your questions."
        ));
    }
    Ok(if text.chars().count() > MAX_CHARS {
        text.chars().take(MAX_CHARS).collect::<String>() + "…"
    } else {
        text
    })
}

/// What kind of sensitive thing `text` looks like, if any. A backstop: Gemini is
/// also told not to propose these.
fn sensitive(text: &str) -> Option<&'static str> {
    let lower = text.to_lowercase();
    let words: Vec<&str> = lower.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
    let has_word = |list: &[&str]| words.iter().any(|w| list.contains(w));
    let has_phrase = |list: &[&str]| list.iter().any(|p| lower.contains(p));

    if has_word(&["password", "passwords", "passcode", "passwd", "otp", "cvv", "cvc"])
        || has_phrase(&[
            "pin is", "pin:", "pin number", "pin code", "atm pin", "one-time code", "security code",
            "api key", "secret key", "login code", "கடவுச்சொல்",
        ])
    {
        return Some("passwords, PINs or codes");
    }
    if has_word(&["ssn", "aadhaar", "aadhar", "ifsc", "iban"])
        || has_phrase(&[
            "social security", "passport number", "passport no", "pan card", "pan number",
            "license number", "licence number", "bank account", "account number", "routing number",
            "card number", "credit card", "debit card",
        ])
        || long_number(text)
    {
        return Some("ID, bank or card numbers");
    }
    if has_word(&["diagnosed", "diagnosis", "medication", "medications", "prescription", "prescribed", "hiv"])
        || has_phrase(&["mental health", "pregnan"])
    {
        return Some("health details");
    }
    None
}

/// True for a run of 12+ digits (spaces and dashes allowed between), like a card or
/// Aadhaar number, or a US SSN (123-45-6789). A phone number starting with + is fine.
fn long_number(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if !chars[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let phone = i > 0 && chars[..i].iter().rev().find(|c| **c != ' ') == Some(&'+');
        let start = i;
        let mut groups = vec![0usize];
        while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == ' ' || chars[i] == '-') {
            if chars[i].is_ascii_digit() {
                *groups.last_mut().unwrap() += 1;
            } else if i + 1 < chars.len() && chars[i + 1].is_ascii_digit() {
                groups.push(0);
            } else {
                break;
            }
            i += 1;
        }
        let digits: usize = groups.iter().sum();
        let ssn = groups == [3, 2, 4] && chars[start..i].contains(&'-');
        if ssn || (digits >= 12 && !phone) || digits >= 16 {
            return true;
        }
    }
    false
}

// ---------- changes proposed by chat ----------

/// One change Gemini asked for alongside its reply.
#[derive(Deserialize, Debug, Default)]
pub struct Proposed {
    pub action: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub text: String,
}

/// What actually happened, shown under the reply with an Undo.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    /// "added", "updated", "forgot" or "skipped"
    pub kind: &'static str,
    pub memory: Option<Memory>,
    /// The text before an update, so Undo can put it back.
    pub before: Option<String>,
    /// Why a change was skipped.
    pub note: Option<String>,
}

fn skipped(note: String) -> Applied {
    Applied { kind: "skipped", memory: None, before: None, note: Some(note) }
}

/// Applies Gemini's proposed changes, checking each one.
pub fn apply(app: &AppHandle, proposed: Vec<Proposed>) -> Vec<Applied> {
    if proposed.is_empty() {
        return Vec::new();
    }
    let result = edit(app, |file| {
        let mut out = Vec::new();
        for p in proposed.into_iter().take(10) {
            out.push(apply_one(file, p));
        }
        Ok(out.into_iter().flatten().collect::<Vec<_>>())
    });
    result.unwrap_or_else(|e| vec![skipped(e)])
}

fn apply_one(file: &mut MemoryFile, p: Proposed) -> Option<Applied> {
    match p.action.as_str() {
        "add" => {
            let text = match check_text(&p.text) {
                Ok(t) => t,
                Err(e) => return Some(skipped(e)),
            };
            if file.has_text(&text) {
                return None;
            }
            Some(match file.add(text) {
                Ok(m) => Applied { kind: "added", memory: Some(m), before: None, note: None },
                Err(e) => skipped(e),
            })
        }
        "update" => {
            let i = file.find(p.id.trim())?;
            let text = match check_text(&p.text) {
                Ok(t) => t,
                Err(e) => return Some(skipped(e)),
            };
            let m = &mut file.items[i];
            if m.text == text {
                return None;
            }
            let before = std::mem::replace(&mut m.text, text);
            m.updated_at = now_ms();
            Some(Applied { kind: "updated", memory: Some(m.clone()), before: Some(before), note: None })
        }
        "forget" => {
            let i = file.find(p.id.trim())?;
            let m = file.items.remove(i);
            Some(Applied { kind: "forgot", memory: Some(m), before: None, note: None })
        }
        _ => None,
    }
}

/// The memory list as Gemini sees it.
pub fn for_prompt(app: &AppHandle) -> String {
    let items = read(app).map(|f| f.items).unwrap_or_default();
    if items.is_empty() {
        return "(nothing yet)".into();
    }
    items.iter().map(|m| format!("[{}] {}", m.id, m.text)).collect::<Vec<_>>().join("\n")
}

// ---------- commands for the Memory section ----------

#[tauri::command]
pub fn list_memories(app: AppHandle) -> Result<Vec<Memory>, String> {
    Ok(read(&app)?.items)
}

#[tauri::command]
pub fn add_memory(app: AppHandle, text: String) -> Result<Memory, String> {
    let text = check_text(&text)?;
    edit(&app, |f| {
        if f.has_text(&text) {
            return Err("The Boss already remembers that.".into());
        }
        f.add(text)
    })
}

#[tauri::command]
pub fn update_memory(app: AppHandle, id: String, text: String) -> Result<Memory, String> {
    let text = check_text(&text)?;
    edit(&app, |f| {
        let i = f.find(&id).ok_or("That memory is gone.")?;
        let m = &mut f.items[i];
        m.text = text;
        m.updated_at = now_ms();
        Ok(m.clone())
    })
}

#[tauri::command]
pub fn delete_memory(app: AppHandle, id: String) -> Result<(), String> {
    edit(&app, |f| {
        f.items.retain(|m| m.id != id);
        Ok(())
    })
}

/// Puts a forgotten memory back (Undo), with its original id and date.
#[tauri::command]
pub fn restore_memory(app: AppHandle, memory: Memory) -> Result<(), String> {
    let text = check_text(&memory.text)?;
    edit(&app, |f| {
        if f.find(&memory.id).is_none() && f.items.len() < MAX_ITEMS {
            f.items.push(Memory { text, ..memory });
            f.items.sort_by_key(|m| m.created_at);
        }
        Ok(())
    })
}

#[tauri::command]
pub fn clear_memories(app: AppHandle) -> Result<(), String> {
    edit(&app, |f| {
        f.items.clear();
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_sensitive_things() {
        for bad in [
            "My Canvas password is hunter2",
            "Bank PIN is 4821",
            "Aadhaar 1234 5678 9012",
            "card 4111-1111-1111-1111",
            "SSN 123-45-6789",
            "I was diagnosed with asthma",
            "என் கடவுச்சொல் abc",
        ] {
            assert!(check_text(bad).is_err(), "{bad}");
        }
        for ok in [
            "Exam is in Room 204",
            "Amma's number is +91 98765 43210",
            "Amma = Mom = அம்மா",
            "Likes to study in the mornings",
            "Student ID card is blue",
            "Hotpot place near campus is good",
            "Pin the lab poster on Friday",
        ] {
            assert!(check_text(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn applies_chat_changes() {
        let mut f = MemoryFile::default();
        let p = |action: &str, id: &str, text: &str| Proposed {
            action: action.into(),
            id: id.into(),
            text: text.into(),
        };
        let a = apply_one(&mut f, p("add", "", "Exam is in Room 204")).unwrap();
        assert_eq!(a.kind, "added");
        assert!(apply_one(&mut f, p("add", "", "exam is in room 204")).is_none(), "duplicate");
        let u = apply_one(&mut f, p("update", "m1", "Exam is in Room 310")).unwrap();
        assert_eq!(u.before.as_deref(), Some("Exam is in Room 204"));
        assert_eq!(apply_one(&mut f, p("add", "", "password is x")).unwrap().kind, "skipped");
        assert!(apply_one(&mut f, p("forget", "m9", "")).is_none(), "unknown id");
        assert_eq!(apply_one(&mut f, p("forget", "m1", "")).unwrap().kind, "forgot");
        assert!(f.items.is_empty());
    }
}
