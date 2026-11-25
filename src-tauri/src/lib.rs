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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires local caelum binary and GGUF models"]
    fn hardware_and_model_scanner_work_live() {
        let hw = runtime::get_hardware_info();
        assert!(hw.caelum_bin.is_some(), "caelum binary must be detected");
        assert!(hw.ram_total_gb > 0.0, "RAM total should be > 0 GB");
        println!("HW GPU: {}", hw.gpu_profile);
        println!("HW RAM: {}/{} GB", hw.ram_available_gb, hw.ram_total_gb);

        let found = models::scan_models(vec![]);
        println!("Found {} GGUF models:", found.len());
        for m in &found {
            println!("  - {} ({:.2} GB) [{}]", m.name, m.size_bytes as f64 / 1e9, m.source);
        }
        assert!(!found.is_empty(), "should find local GGUF models");

        let inspected = models::inspect_model(found[0].path.clone()).expect("inspect should succeed");
        assert!(inspected.contains("CAELUM GGUF INSPECTOR"));
    }

    #[test]
    #[ignore = "requires outbound network to huggingface.co"]
    fn huggingface_hub_search_and_tree_work_live() {
        let repos = hub::search_hf_models("qwen2.5-coder".into()).expect("HF search should succeed");
        assert!(!repos.is_empty(), "HF search should return GGUF repos");
        println!("Top HF repo: {} ({} downloads)", repos[0].id, repos[0].downloads);

        let files = hub::list_hf_gguf_files(repos[0].id.clone()).expect("HF tree should succeed");
        println!("Found {} GGUF files in {}", files.len(), repos[0].id);
        assert!(!files.is_empty(), "HF repo should list .gguf files");
    }
}
