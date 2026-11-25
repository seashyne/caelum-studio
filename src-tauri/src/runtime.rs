use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct HardwareInfo {
    pub caelum_bin: Option<String>,
    pub caelum_version: String,
    pub cpu_profile: String,
    pub gpu_profile: String,
    pub ram_total_gb: f64,
    pub ram_available_gb: f64,
    pub raw_info: String,
}

/// Resolves the `caelum` runtime binary from `CAELUM_BIN`, `PATH`, `~/.local/bin/caelum`, or default workspace paths.
pub fn find_caelum_binary() -> Result<PathBuf, String> {
    if let Ok(custom) = std::env::var("CAELUM_BIN") {
        let p = PathBuf::from(custom);
        if p.is_file() {
            return Ok(p);
        }
    }

    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join("caelum");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let local_bin = PathBuf::from(&home).join(".local").join("bin").join("caelum");
        if local_bin.is_file() {
            return Ok(local_bin);
        }
    }

    let fallback = PathBuf::from(
        "/run/media/seashyne/Project/My Artificial Intelligence/Cetia/caelum/target/release/caelum",
    );
    if fallback.is_file() {
        return Ok(fallback);
    }

    Err(
        "ไม่พบไบนารี caelum — ติดตั้งลง ~/.local/bin/caelum หรือกำหนดตัวแปร CAELUM_BIN".into(),
    )
}

pub fn caelum_models_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join(".caelum").join("models");
    }
    PathBuf::from(".caelum/models")
}

fn read_linux_ram_gb() -> (f64, f64) {
    let Ok(content) = fs::read_to_string("/proc/meminfo") else {
        return (0.0, 0.0);
    };
    let mut total_kb = 0u64;
    let mut avail_kb = 0u64;
    for line in content.lines() {
        if let Some(rest) = line.strip_prefix("MemTotal:") {
            total_kb = rest
                .split_whitespace()
                .next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
        } else if let Some(rest) = line.strip_prefix("MemAvailable:") {
            avail_kb = rest
                .split_whitespace()
                .next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
        }
    }
    let to_gb = |kb: u64| ((kb as f64) / 1024.0 / 1024.0 * 10.0).round() / 10.0;
    (to_gb(total_kb), to_gb(avail_kb))
}

#[tauri::command]
pub fn get_hardware_info() -> HardwareInfo {
    let (ram_total_gb, ram_available_gb) = read_linux_ram_gb();
    let Ok(bin) = find_caelum_binary() else {
        return HardwareInfo {
            caelum_bin: None,
            caelum_version: "not found".into(),
            cpu_profile: "Unknown".into(),
            gpu_profile: "caelum binary not found".into(),
            ram_total_gb,
            ram_available_gb,
            raw_info: String::new(),
        };
    };

    let output = Command::new(&bin).arg("info").output();
    let raw_info = match output {
        Ok(out) => String::from_utf8_lossy(&out.stdout).into_owned(),
        Err(e) => format!("Failed to run caelum info: {e}"),
    };

    let mut version = String::from("v0.8.0");
    let mut cpu = String::from("CPU");
    let mut gpu = String::from("CPU-only build");

    for line in raw_info.lines() {
        let trimmed = line.trim();
        if let Some(v) = trimmed.strip_prefix("Version:") {
            version = v.trim().to_string();
        } else if let Some(v) = trimmed.strip_prefix("Hardware:") {
            cpu = v.trim().to_string();
        } else if let Some(v) = trimmed.strip_prefix("GPU (wgpu):") {
            gpu = v.trim().to_string();
        }
    }

    HardwareInfo {
        caelum_bin: Some(bin.to_string_lossy().into_owned()),
        caelum_version: version,
        cpu_profile: cpu,
        gpu_profile: gpu,
        ram_total_gb,
        ram_available_gb,
        raw_info,
    }
}
