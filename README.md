# Caelum Studio

Native **Tauri 2 + Rust** desktop workbench for the **Caelum** pure-Rust LLM runtime (`seashyne/caelum.rs`) — designed as a lightweight, ultra-fast local alternative to LM Studio (~40 MB UI RAM, zero Electron bloat, tuned for Intel Arc B580 & AVX-VNNI/ARMv9).

## Features
- **Top Model Loader Bar**: Auto-scans `.gguf` models across `~/.caelum/models`, Cetia, LM Studio folders, and custom paths — 1-click **Load into GPU** or **Eject**.
- **Discover Hub (Hugging Face)**: Search GGUF repos on Hugging Face, inspect quantization sizes with 12GB VRAM fit badges, and download with resumable live progress into `~/.caelum/models`.
- **Chat Workbench**: Real-time SSE streaming, safe Markdown + GFM tables + Copy code blocks, Stop button, live `tok/s` & `TTFT`, and Parameter Inspector.
- **Developer Server & Live Logs**: Start/Stop `caelum serve` on port `8000` or `1234`, toggle `--gpu` / `--kv-q8` / `--ctx`, stream live runtime logs, and copy ready-to-use snippets for `mybot-cli` and `My Bot AI`.
- **Automatic Cleanup**: Automatically terminates the child `caelum` runtime and frees VRAM when the window closes.

## Prerequisites
- `caelum` runtime binary on `PATH` (e.g. `~/.local/bin/caelum`) or `CAELUM_BIN=/path/to/caelum`.
- Rust toolchain + GTK3 / WebKit2GTK 4.1 on Linux (already installed on this system).

## Build & Run
```bash
cd /home/seashyne/Projects/caelum-studio/src-tauri

# Development run
cargo run

# Release binary (~12-15 MB native binary)
cargo build --release
./target/release/caelum-studio
```
