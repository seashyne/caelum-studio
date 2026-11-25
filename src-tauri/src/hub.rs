use crate::runtime::caelum_models_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct HfRepoSummary {
    pub id: String,
    pub downloads: u64,
    pub likes: u64,
    pub last_modified: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HfGgufFile {
    pub repo_id: String,
    pub filename: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub repo_id: String,
    pub filename: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub status: String, // "downloading" | "done" | "error"
    pub path: Option<String>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
struct RawHfRepo {
    id: String,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    likes: u64,
    #[serde(rename = "lastModified", default)]
    last_modified: String,
}

#[derive(Deserialize)]
struct RawHfTreeItem {
    path: String,
    #[serde(default)]
    size: u64,
    #[serde(rename = "type", default)]
    kind: String,
}

fn url_encode_query(q: &str) -> String {
    let mut out = String::with_capacity(q.len() * 2);
    for b in q.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else if b == b' ' {
            out.push_str("%20");
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[tauri::command]
pub fn search_hf_models(query: String) -> Result<Vec<HfRepoSummary>, String> {
    let trimmed = query.trim();
    let search_term = if trimmed.is_empty() {
        "gguf".to_string()
    } else if trimmed.to_ascii_lowercase().contains("gguf") {
        trimmed.to_string()
    } else {
        format!("{trimmed} gguf")
    };

    let url = format!(
        "https://huggingface.co/api/models?search={}&filter=gguf&sort=downloads&direction=-1&limit=18",
        url_encode_query(&search_term)
    );

    let out = Command::new("curl")
        .args(["-fsSL", "--max-time", "12", &url])
        .output()
        .map_err(|e| format!("ไม่สามารถเรียก curl ได้: {e}"))?;

    if !out.status.success() {
        return Err(format!(
            "ค้นหา Hugging Face ไม่สำเร็จ: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    let repos: Vec<RawHfRepo> = serde_json::from_slice(&out.stdout)
        .map_err(|e| format!("Parse Hugging Face JSON failed: {e}"))?;

    Ok(repos
        .into_iter()
        .map(|r| HfRepoSummary {
            id: r.id,
            downloads: r.downloads,
            likes: r.likes,
            last_modified: r.last_modified,
        })
        .collect())
}

#[tauri::command]
pub fn list_hf_gguf_files(repo_id: String) -> Result<Vec<HfGgufFile>, String> {
    if !repo_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'))
        || !repo_id.contains('/')
    {
        return Err("Invalid Hugging Face repository ID".into());
    }

    let url = format!("https://huggingface.co/api/models/{repo_id}/tree/main");
    let out = Command::new("curl")
        .args(["-fsSL", "--max-time", "12", &url])
        .output()
        .map_err(|e| format!("Failed to query HF files: {e}"))?;

    if !out.status.success() {
        return Err("ไม่สามารถดึงรายการไฟล์ GGUF จาก Repository นี้ได้".into());
    }

    let items: Vec<RawHfTreeItem> = serde_json::from_slice(&out.stdout)
        .map_err(|e| format!("Parse HF tree JSON failed: {e}"))?;

    let mut files: Vec<HfGgufFile> = items
        .into_iter()
        .filter(|it| {
            it.kind == "file"
                && it.path.to_ascii_lowercase().ends_with(".gguf")
                && !it.path.to_ascii_lowercase().starts_with("mmproj-")
        })
        .map(|it| HfGgufFile {
            repo_id: repo_id.clone(),
            filename: it.path,
            size_bytes: it.size,
        })
        .collect();

    files.sort_by_key(|f| f.size_bytes);
    Ok(files)
}

#[tauri::command]
pub fn download_hf_model(
    app: AppHandle,
    repo_id: String,
    filename: String,
    total_bytes: u64,
) -> Result<String, String> {
    if !repo_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'))
        || filename.contains("..")
        || filename.contains('/')
        || filename.contains('\\')
    {
        return Err("Invalid repository or filename".into());
    }

    let target_dir = caelum_models_dir();
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Cannot create {}: {e}", target_dir.display()))?;

    let dest_path = target_dir.join(&filename);
    let url = format!("https://huggingface.co/{repo_id}/resolve/main/{filename}");
    let dest_str = dest_path.to_string_lossy().into_owned();

    let mut child = Command::new("curl")
        .args(["-fSL", "-C", "-", "-o", &dest_str, &url])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start curl download: {e}"))?;

    let app_bg = app.clone();
    let repo_bg = repo_id.clone();
    let file_bg = filename.clone();
    let path_bg = dest_path.clone();

    thread::spawn(move || loop {
        let downloaded = fs::metadata(&path_bg).map(|m| m.len()).unwrap_or(0);
        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    let final_size = fs::metadata(&path_bg).map(|m| m.len()).unwrap_or(downloaded);
                    let _ = app_bg.emit(
                        "download-progress",
                        DownloadProgress {
                            repo_id: repo_bg,
                            filename: file_bg,
                            downloaded_bytes: final_size,
                            total_bytes: total_bytes.max(final_size),
                            status: "done".into(),
                            path: Some(path_bg.to_string_lossy().into_owned()),
                            error: None,
                        },
                    );
                } else {
                    let _ = app_bg.emit(
                        "download-progress",
                        DownloadProgress {
                            repo_id: repo_bg,
                            filename: file_bg,
                            downloaded_bytes: downloaded,
                            total_bytes,
                            status: "error".into(),
                            path: None,
                            error: Some(format!("curl exited with {status}")),
                        },
                    );
                }
                break;
            }
            Ok(None) => {
                let _ = app_bg.emit(
                    "download-progress",
                    DownloadProgress {
                        repo_id: repo_bg.clone(),
                        filename: file_bg.clone(),
                        downloaded_bytes: downloaded,
                        total_bytes,
                        status: "downloading".into(),
                        path: None,
                        error: None,
                    },
                );
                thread::sleep(Duration::from_millis(500));
            }
            Err(e) => {
                let _ = app_bg.emit(
                    "download-progress",
                    DownloadProgress {
                        repo_id: repo_bg,
                        filename: file_bg,
                        downloaded_bytes: downloaded,
                        total_bytes,
                        status: "error".into(),
                        path: None,
                        error: Some(e.to_string()),
                    },
                );
                break;
            }
        }
    });

    Ok(dest_str)
}
