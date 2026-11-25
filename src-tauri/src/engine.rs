use crate::runtime::find_caelum_binary;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Deserialize)]
pub struct StartEngineOpts {
    pub model_path: String,
    pub gpu: bool,
    pub port: u16,
    pub ctx: Option<u32>,
    pub kv_q8: bool,
    pub host: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: u16,
    pub host: String,
    pub model_path: Option<String>,
}

struct RunningEngine {
    child: Child,
    port: u16,
    host: String,
    model_path: String,
}

#[derive(Clone, Default)]
pub struct EngineManager {
    inner: Arc<Mutex<Option<RunningEngine>>>,
}

impl EngineManager {
    pub fn stop_all(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            if let Some(mut eng) = guard.take() {
                let _ = eng.child.kill();
                let _ = eng.child.wait();
            }
        }
    }

    fn current_status_locked(slot: &mut Option<RunningEngine>) -> EngineStatus {
        if let Some(eng) = slot.as_mut() {
            match eng.child.try_wait() {
                Ok(None) => {
                    return EngineStatus {
                        running: true,
                        pid: Some(eng.child.id()),
                        port: eng.port,
                        host: eng.host.clone(),
                        model_path: Some(eng.model_path.clone()),
                    };
                }
                Ok(Some(_)) | Err(_) => {
                    *slot = None;
                }
            }
        }
        EngineStatus {
            running: false,
            pid: None,
            port: 8000,
            host: "127.0.0.1".into(),
            model_path: None,
        }
    }
}

#[tauri::command]
pub fn start_engine(
    app: AppHandle,
    manager: State<'_, EngineManager>,
    opts: StartEngineOpts,
) -> Result<EngineStatus, String> {
    let bin = find_caelum_binary()?;
    if opts.model_path.trim().is_empty() {
        return Err("กรุณาเลือกไฟล์โมเดล .gguf ก่อนกด Load Model".into());
    }

    manager.stop_all();

    let host = opts
        .host
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("127.0.0.1")
        .to_string();

    let mut cmd = Command::new(&bin);
    cmd.arg("serve")
        .arg(&opts.model_path)
        .arg("--host")
        .arg(&host)
        .arg("--port")
        .arg(opts.port.to_string());

    if opts.gpu {
        cmd.arg("--gpu");
    }
    if opts.kv_q8 {
        cmd.arg("--kv-q8");
    }
    if let Some(ctx) = opts.ctx {
        if ctx > 0 {
            cmd.arg("--ctx").arg(ctx.to_string());
        }
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {e}", bin.display()))?;

    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let _ = app.emit(
        "engine-log",
        format!(
            "[Caelum Studio] Launching runtime {} (pid={pid}) on {host}:{}",
            bin.display(),
            opts.port
        ),
    );

    if let Some(out) = stdout {
        let app_out = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(out);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_out.emit("engine-log", line);
            }
            let _ = app_out.emit("engine-exit", pid);
        });
    }

    if let Some(err) = stderr {
        let app_err = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(err);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_err.emit("engine-log", format!("[stderr] {line}"));
            }
        });
    }

    let status = EngineStatus {
        running: true,
        pid: Some(pid),
        port: opts.port,
        host: host.clone(),
        model_path: Some(opts.model_path.clone()),
    };

    let mut guard = manager
        .inner
        .lock()
        .map_err(|_| "Engine state lock poisoned".to_string())?;
    *guard = Some(RunningEngine {
        child,
        port: opts.port,
        host,
        model_path: opts.model_path,
    });

    Ok(status)
}

#[tauri::command]
pub fn stop_engine(
    app: AppHandle,
    manager: State<'_, EngineManager>,
) -> Result<EngineStatus, String> {
    manager.stop_all();
    let _ = app.emit("engine-log", "[Caelum Studio] Runtime stopped & VRAM freed.");
    Ok(EngineStatus {
        running: false,
        pid: None,
        port: 8000,
        host: "127.0.0.1".into(),
        model_path: None,
    })
}

#[tauri::command]
pub fn engine_status(manager: State<'_, EngineManager>) -> Result<EngineStatus, String> {
    let mut guard = manager
        .inner
        .lock()
        .map_err(|_| "Engine state lock poisoned".to_string())?;
    Ok(EngineManager::current_status_locked(&mut guard))
}
