//! Stores the Gemini API key in the macOS Keychain. The key is written from
//! the settings box and read only here in Rust; it is never sent back to the
//! web view.

use keyring::Entry;

const SERVICE: &str = "com.ramyar29.theboss";
const ACCOUNT: &str = "gemini-api-key";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Couldn't open the Keychain: {e}"))
}

/// Returns the saved key, or None if there isn't one.
pub fn read_api_key() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Couldn't read the key from the Keychain: {e}")),
    }
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
    entry()?
        .set_password(key)
        .map_err(|e| format!("Couldn't save the key to the Keychain: {e}"))
}

#[tauri::command]
pub fn delete_api_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Couldn't remove the key from the Keychain: {e}")),
    }
}
