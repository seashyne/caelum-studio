use crate::runtime::{caelum_models_dir, find_caelum_binary};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct ModelInfo {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub source: String,
    pub managed: bool,
}

fn scan_dir_recursive(
    dir: &Path,
    source: &str,
    managed: bool,
    depth: usize,
    max_depth: usize,
    seen: &mut HashSet<PathBuf>,
    out: &mut Vec<ModelInfo>,
) {
    if depth > max_depth {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::metadata(&path) else {
            continue;
        };
        if meta.is_dir() {
            scan_dir_recursive(&path, source, managed, depth + 1, max_depth, seen, out);
            continue;
        }
        if !meta.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let lower = file_name.to_ascii_lowercase();
        if !lower.ends_with(".gguf") {
            continue;
        }
        if lower.starts_with("mmproj-") || lower.starts_with("ggml-vocab-") {
            continue;
        }
        let canonical = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        if !seen.insert(canonical) {
            continue;
        }
        out.push(ModelInfo {
            name: file_name.to_string(),
            path: path.to_string_lossy().into_owned(),
            size_bytes: meta.len(),
            source: source.to_string(),
            managed,
        });
    }
}

#[tauri::command]
pub fn scan_models(extra_dirs: Vec<String>) -> Vec<ModelInfo> {
    let mut roots: Vec<(PathBuf, String, bool)> = Vec::new();

    roots.push((caelum_models_dir(), "Caelum Hub".into(), true));

    roots.push((
        PathBuf::from(
            "/run/media/seashyne/Project/My Artificial Intelligence/Cetia/models/exported_gguf",
        ),
        "Cetia".into(),
        false,
    ));

    if let Ok(home) = std::env::var("HOME") {
        roots.push((
            PathBuf::from(&home).join(".lmstudio").join("models"),
            "LM Studio".into(),
            false,
        ));
    }

    roots.push((
        PathBuf::from(
            "/run/media/seashyne/Project/My Artificial Intelligence/Chat AI/LM Studio/Models",
        ),
        "LM Studio (External)".into(),
        false,
    ));

    for dir in extra_dirs {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            roots.push((PathBuf::from(trimmed), "Custom".into(), false));
        }
    }

    let mut seen = HashSet::new();
    let mut results = Vec::new();
    for (dir, label, managed) in roots {
        if dir.exists() {
            scan_dir_recursive(&dir, &label, managed, 0, 5, &mut seen, &mut results);
        }
    }

    results.sort_by(|a, b| {
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
    });
    results
}

#[tauri::command]
pub fn inspect_model(model_path: String) -> Result<String, String> {
    let bin = find_caelum_binary()?;
    let out = Command::new(bin)
        .arg("inspect")
        .arg(&model_path)
        .output()
        .map_err(|e| format!("Failed to inspect model: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Deletes a downloaded GGUF file ONLY if it resides inside `~/.caelum/models`.
#[tauri::command]
pub fn delete_managed_model(model_path: String) -> Result<(), String> {
    let managed_root = fs::canonicalize(caelum_models_dir())
        .map_err(|_| "Managed models folder does not exist".to_string())?;
    let target = fs::canonicalize(&model_path)
        .map_err(|_| "Model file does not exist".to_string())?;
    if !target.starts_with(&managed_root) {
        return Err("เพื่อความปลอดภัย ลบได้เฉพาะไฟล์ที่ดาวน์โหลดไว้ใน ~/.caelum/models เท่านั้น".into());
    }
    fs::remove_file(&target).map_err(|e| format!("Failed to delete file: {e}"))
}
