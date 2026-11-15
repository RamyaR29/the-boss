//! Spoken replies using the macOS `say` command and built-in voices:
//! Samantha for English, Vani for Tamil and Tanglish. Free and fully offline.
//! Only one reply speaks at a time.

use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

/// Voices the web view may ask for; anything else falls back to the first.
const VOICES: [&str; 2] = ["Vani", "Samantha"];

static CURRENT: Mutex<Option<Child>> = Mutex::new(None);

fn stop_current() {
    if let Some(mut child) = CURRENT.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Speaks `text` and returns when it has finished (or was stopped).
#[tauri::command]
pub async fn speak(text: String, voice: String) -> Result<(), String> {
    stop_current();
    let text = text.trim().to_string();
    if text.is_empty() {
        return Ok(());
    }
    let voice = VOICES.iter().find(|v| **v == voice).copied().unwrap_or(VOICES[0]);

    // The text goes in on stdin, so nothing in it can be read as a `say` option.
    let mut child = Command::new("say")
        .args(["-v", voice])
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't start the macOS voice: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| format!("Couldn't send text to the voice: {e}"))?;
    } // stdin dropped here, so `say` starts speaking
    let pid = child.id();
    *CURRENT.lock().unwrap() = Some(child);

    // Wait off the async runtime until this utterance ends or is replaced/stopped.
    tauri::async_runtime::spawn_blocking(move || loop {
        let mut guard = CURRENT.lock().unwrap();
        match guard.as_mut() {
            Some(c) if c.id() == pid => match c.try_wait() {
                Ok(Some(_)) | Err(_) => {
                    guard.take();
                    return;
                }
                Ok(None) => {}
            },
            _ => return, // stopped, or a newer reply took over
        }
        drop(guard);
        std::thread::sleep(std::time::Duration::from_millis(100));
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stop_speaking() {
    stop_current();
}
