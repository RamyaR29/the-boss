mod chat;
mod keychain;
mod sessions;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            keychain::has_api_key,
            keychain::save_api_key,
            keychain::delete_api_key,
            chat::ask,
            sessions::save_session,
            sessions::load_session,
            sessions::list_sessions,
            sessions::delete_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running The Boss");
}
