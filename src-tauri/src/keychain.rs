//! Stores secrets in the macOS Keychain: the Gemini API key and the Canvas
//! calendar feed link. They are written from the settings boxes and read only
//! here in Rust; they are never sent back to the web view.

use keyring::Entry;

const SERVICE: &str = "com.ramyar29.theboss";
const ACCOUNT: &str = "gemini-api-key";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| format!("Couldn't open the Keychain: {e}"))
}

/// Returns the secret saved under `account`, or None if there isn't one.
pub fn read_secret(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Couldn't read from the Keychain: {e}")),
    }
}

pub fn save_secret(account: &str, value: &str) -> Result<(), String> {
    entry(account)?
        .set_password(value)
        .map_err(|e| format!("Couldn't save to the Keychain: {e}"))
}

pub fn delete_secret(account: &str) -> Result<(), String> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Couldn't remove it from the Keychain: {e}")),
    }
}

/// Returns the saved Gemini key, or None if there isn't one.
pub fn read_api_key() -> Result<Option<String>, String> {
    read_secret(ACCOUNT)
}

#[tauri::command]
pub fn has_api_key() -> Result<bool, String> {
    Ok(read_api_key()?.is_some())
}

#[tauri::command]
pub fn save_api_key(key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("The key is empty.".into());
    }
    save_secret(ACCOUNT, key)
}

#[tauri::command]
pub fn delete_api_key() -> Result<(), String> {
    delete_secret(ACCOUNT)
}
