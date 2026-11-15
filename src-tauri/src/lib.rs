mod chat;
mod keychain;
mod sessions;
mod voice;

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    voice::stop_speaking();
    app.exit(0);
}

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
            voice::speak,
            voice::stop_speaking,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running The Boss");
}
