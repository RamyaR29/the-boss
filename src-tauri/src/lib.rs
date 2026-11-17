mod calendar;
mod canvas;
mod chat;
mod keychain;
mod lookup;
mod mail;
mod memory;
mod reminders;
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
            calendar::calendar_status,
            calendar::request_calendar_access,
            calendar::fetch_calendar,
            calendar::open_calendar_settings,
            canvas::save_canvas_feed,
            canvas::delete_canvas_feed,
            canvas::fetch_canvas,
            canvas::open_canvas_link,
            chat::ask,
            mail::mail_state,
            mail::check_mail,
            mail::mark_mail_done,
            mail::forget_mail_reminder,
            mail::open_mail,
            mail::open_full_disk_settings,
            memory::list_memories,
            memory::add_memory,
            memory::update_memory,
            memory::delete_memory,
            memory::restore_memory,
            memory::clear_memories,
            reminders::reminders_status,
            reminders::request_reminders_access,
            reminders::fetch_reminders,
            reminders::complete_reminder,
            reminders::set_reminder_due,
            reminders::delete_reminder,
            reminders::restore_reminder,
            reminders::open_reminders_settings,
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
