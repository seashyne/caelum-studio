mod engine;
mod hub;
mod models;
mod runtime;

use engine::EngineManager;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manager = EngineManager::default();
    let manager_for_exit = manager.clone();

    let app = tauri::Builder::default()
        .manage(manager)
        .invoke_handler(tauri::generate_handler![
            runtime::get_hardware_info,
            models::scan_models,
            models::inspect_model,
            models::delete_managed_model,
            hub::search_hf_models,
            hub::list_hf_gguf_files,
            hub::download_hf_model,
            engine::start_engine,
            engine::stop_engine,
            engine::engine_status,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Caelum Studio");

    app.run(move |app_handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            manager_for_exit.stop_all();
            if let Some(state) = app_handle.try_state::<EngineManager>() {
                state.stop_all();
            }
        }
    });
}
