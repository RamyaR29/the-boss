//! Chat sessions saved as JSON files on this Mac, one file per session, in
//! ~/Library/Application Support/com.ramyar29.theboss/chats/. Nothing here is
//! sent anywhere.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    id: String,
    started_at: i64,
    last_at: i64,
    /// Stored as given by the web view ({id, role, text, error?}).
    messages: Vec<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    id: String,
    started_at: i64,
    last_at: i64,
    title: String,
    count: usize,
}

fn chats_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Couldn't find the app data folder: {e}"))?
        .join("chats");
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create the chats folder: {e}"))?;
    Ok(dir)
}

/// Session ids come from the web view; allow only safe file-name characters.
fn session_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid session id.".into());
    }
    Ok(chats_dir(app)?.join(format!("{id}.json")))
}

fn title_of(session: &Session) -> String {
    let first = session
        .messages
        .iter()
        .find(|m| m["role"] == "user")
        .and_then(|m| m["text"].as_str())
        .unwrap_or("(empty chat)");
    let mut title: String = first.chars().take(60).collect();
    if first.chars().count() > 60 {
        title.push('…');
    }
    title
}

#[tauri::command]
pub fn save_session(app: AppHandle, session: Session) -> Result<(), String> {
    let path = session_path(&app, &session.id)?;
    let json = serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?;
    // Write to a temp file and rename, so a crash never leaves a half-written chat.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("Couldn't save the chat: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Couldn't save the chat: {e}"))
}

#[tauri::command]
pub fn load_session(app: AppHandle, id: String) -> Result<Session, String> {
    let path = session_path(&app, &id)?;
    let text = fs::read_to_string(path).map_err(|e| format!("Couldn't open that chat: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("That chat file is damaged: {e}"))
}

/// All saved sessions, newest first.
#[tauri::command]
pub fn list_sessions(app: AppHandle) -> Result<Vec<SessionSummary>, String> {
    let mut out = Vec::new();
    let entries = fs::read_dir(chats_dir(&app)?).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let Ok(session) = serde_json::from_str::<Session>(&text) else { continue };
        if session.messages.is_empty() {
            continue;
        }
        out.push(SessionSummary {
            title: title_of(&session),
            count: session.messages.len(),
            id: session.id,
            started_at: session.started_at,
            last_at: session.last_at,
        });
    }
    out.sort_by(|a, b| b.last_at.cmp(&a.last_at));
    Ok(out)
}

#[tauri::command]
pub fn delete_session(app: AppHandle, id: String) -> Result<(), String> {
    let path = session_path(&app, &id)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Couldn't delete that chat: {e}")),
    }
}
