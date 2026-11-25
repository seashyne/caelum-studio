// Caelum Studio — Main Native Desktop Controller (Tauri 2)
(() => {
  const tauriCore = window.__TAURI__?.core;
  const tauriEvent = window.__TAURI__?.event;
  const isTauri = Boolean(tauriCore && tauriEvent);

  const invoke = (cmd, args = {}) => {
    if (!isTauri) return Promise.reject(new Error("Requires Caelum Studio Desktop (Tauri)"));
    return tauriCore.invoke(cmd, args);
  };

  // State
  let models = [];
  let extraDirs = JSON.parse(localStorage.getItem("caelum_studio_dirs") || "[]");
  let engineState = { running: false, ready: false, port: 8000, host: "127.0.0.1", modelPath: "" };
  let chatHistory = [];
  let abortController = null;
  let healthTimer = null;

  // DOM refs
  const modelSelect = document.getElementById("top-model-select");
  const loadBtn = document.getElementById("top-load-btn");
  const ejectBtn = document.getElementById("top-eject-btn");
  const statusDot = document.getElementById("top-status-dot");
  const statusText = document.getElementById("top-status-text");

  const messagesEl = document.getElementById("chat-messages");
  const emptyChatEl = document.getElementById("chat-empty");
  const promptEl = document.getElementById("chat-prompt");
  const sendBtn = document.getElementById("chat-send-btn");
  const stopBtn = document.getElementById("chat-stop-btn");
  const clearChatBtn = document.getElementById("chat-clear-btn");

  const tempInput = document.getElementById("cfg-temp");
  const tempVal = document.getElementById("cfg-temp-val");
  const maxTokInput = document.getElementById("cfg-max-tokens");
  const sysPromptInput = document.getElementById("cfg-system");

  const modelsGrid = document.getElementById("models-grid");
  const modelSearchInput = document.getElementById("model-filter-input");
  const extraDirInput = document.getElementById("extra-dir-input");

  const hfQueryInput = document.getElementById("hf-query-input");
  const hfReposList = document.getElementById("hf-repos-list");
  const hfFilesList = document.getElementById("hf-files-list");
  const dlBanner = document.getElementById("dl-banner");
  const dlText = document.getElementById("dl-text");
  const dlFill = document.getElementById("dl-fill");

  const srvPort = document.getElementById("srv-port");
  const srvHost = document.getElementById("srv-host");
  const srvCtx = document.getElementById("srv-ctx");
  const srvGpu = document.getElementById("srv-gpu");
  const srvKvQ8 = document.getElementById("srv-kvq8");
  const logsBox = document.getElementById("logs-box");
  const snippetBox = document.getElementById("connect-snippet");

  const inspectDialog = document.getElementById("inspect-dialog");
  const inspectTitle = document.getElementById("inspect-title");
  const inspectPre = document.getElementById("inspect-pre");

  const hwGpuEl = document.getElementById("hw-gpu");
  const hwRamEl = document.getElementById("hw-ram");

  function fmtGb(bytes) {
    if (!bytes) return "0 GB";
    return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
  }

  function appendLog(line) {
    logsBox.textContent += `${line}\n`;
    logsBox.scrollTop = logsBox.scrollHeight;
  }

  function setStatus(kind, text) {
    statusDot.className = `dot ${kind}`;
    statusText.textContent = text;
    loadBtn.disabled = kind === "loading";
    ejectBtn.disabled = kind === "idle";
  }

  // ---------------- TABS (Modern Web Guidance) ----------------
  const tabs = Array.from(document.querySelectorAll('[role="tab"].rail-tab'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"].studio-panel'));

  function selectTab(tab) {
    tabs.forEach((t) => {
      const sel = t === tab;
      t.setAttribute("aria-selected", sel ? "true" : "false");
      t.toggleAttribute("focusgroupstart", sel);
    });
    panels.forEach((p) => {
      p.hidden = p.getAttribute("aria-labelledby") !== tab.id;
    });
  }
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (e) => {
      const idx = tabs.indexOf(tab);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = tabs[(idx + 1) % tabs.length];
        next.focus();
        selectTab(next);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
        prev.focus();
        selectTab(prev);
      }
    });
  });

  // ---------------- THEME ----------------
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  let theme = localStorage.getItem("caelum-studio-theme") || (mq.matches ? "dark" : "light");
  const themeBtn = document.getElementById("theme-btn");
  function applyTheme(next, persist = false) {
    theme = next;
    document.documentElement.setAttribute("data-theme", next);
    themeBtn.textContent = next === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";
    if (persist) localStorage.setItem("caelum-studio-theme", next);
  }
  applyTheme(theme);
  mq.addEventListener("change", (e) => {
    if (!localStorage.getItem("caelum-studio-theme")) applyTheme(e.matches ? "dark" : "light");
  });
  themeBtn.addEventListener("click", () => applyTheme(theme === "dark" ? "light" : "dark", true));

  // ---------------- HARDWARE & MODELS ----------------
  async function loadHardware() {
    if (!isTauri) {
      hwGpuEl.textContent = "Preview mode (launch via `cargo run` for full Tauri runtime)";
      return;
    }
    try {
      const hw = await invoke("get_hardware_info");
      hwGpuEl.textContent = `GPU: ${hw.gpu_profile} | ${hw.caelum_version}`;
      hwRamEl.textContent = `RAM: ${hw.ram_available_gb} / ${hw.ram_total_gb} GB free`;
    } catch (err) {
      hwGpuEl.textContent = `Runtime check error: ${err}`;
    }
  }

  function renderModels() {
    const q = (modelSearchInput.value || "").trim().toLowerCase();
    const filtered = models.filter((m) => !q || m.name.toLowerCase().includes(q) || m.source.toLowerCase().includes(q));

    // Top bar select
    const prevSel = modelSelect.value || localStorage.getItem("caelum_studio_last_model") || "";
    modelSelect.textContent = "";
    if (models.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "ไม่พบไฟล์ .gguf — ไปที่แท็บ Discover เพื่อดาวน์โหลด";
      modelSelect.appendChild(opt);
    } else {
      models.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.path;
        opt.textContent = `${m.name} (${fmtGb(m.size_bytes)}) — ${m.source}`;
        modelSelect.appendChild(opt);
      });
      if (models.some((m) => m.path === prevSel)) modelSelect.value = prevSel;
    }

    // My Models grid
    modelsGrid.textContent = "";
    if (filtered.length === 0) {
      const p = document.createElement("p");
      p.style.color = "var(--muted)";
      p.textContent = "ไม่พบไฟล์โมเดล .gguf ที่ตรงกับคำค้นหา";
      modelsGrid.appendChild(p);
      return;
    }

    filtered.forEach((m) => {
      const card = document.createElement("div");
      card.className = `model-card${engineState.modelPath === m.path && engineState.running ? " active" : ""}`;

      const nameEl = document.createElement("div");
      nameEl.className = "model-name";
      nameEl.textContent = m.name;

      const meta = document.createElement("div");
      meta.className = "model-meta";
      const sizeSpan = document.createElement("span");
      sizeSpan.textContent = fmtGb(m.size_bytes);
      const srcBadge = document.createElement("span");
      srcBadge.className = "badge";
      srcBadge.textContent = m.source;
      const fitBadge = document.createElement("span");
      fitBadge.className = m.size_bytes < 10.5 * 1024 ** 3 ? "badge ok" : "badge warn";
      fitBadge.textContent = m.size_bytes < 10.5 * 1024 ** 3 ? "Fits 12GB VRAM" : "Large (CPU/RAM)";
      meta.append(sizeSpan, srcBadge, fitBadge);

      const actions = document.createElement("div");
      actions.className = "row";

      const btnLoad = document.createElement("button");
      btnLoad.type = "button";
      btnLoad.className = "btn btn-primary";
      btnLoad.textContent = "⚡ Load";
      btnLoad.addEventListener("click", () => {
        modelSelect.value = m.path;
        void startRuntime();
      });

      const btnInspect = document.createElement("button");
      btnInspect.type = "button";
      btnInspect.className = "btn";
      btnInspect.textContent = "Inspect";
      btnInspect.addEventListener("click", async () => {
        inspectTitle.textContent = m.name;
        inspectPre.textContent = "Running caelum inspect…";
        inspectDialog.showModal();
        try {
          const out = await invoke("inspect_model", { modelPath: m.path });
          inspectPre.textContent = out;
        } catch (err) {
          inspectPre.textContent = String(err);
        }
      });

      actions.append(btnLoad, btnInspect);

      if (m.managed) {
        const btnDel = document.createElement("button");
        btnDel.type = "button";
        btnDel.className = "btn";
        btnDel.textContent = "Delete";
        btnDel.addEventListener("click", async () => {
          if (!confirm(`ลบไฟล์ ${m.name} ออกจาก ~/.caelum/models ?`)) return;
          try {
            await invoke("delete_managed_model", { modelPath: m.path });
            await refreshModels();
          } catch (err) {
            alert(String(err));
          }
        });
        actions.appendChild(btnDel);
      }

      card.append(nameEl, meta, actions);
      modelsGrid.appendChild(card);
    });
  }

  async function refreshModels() {
    if (!isTauri) return;
    try {
      models = await invoke("scan_models", { extraDirs });
      renderModels();
    } catch (err) {
      appendLog(`[scan_models error] ${err}`);
    }
  }

  // ---------------- RUNTIME START / STOP / HEALTH ----------------
  function updateConnectSnippet() {
    const port = Number(srvPort.value) || 8000;
    snippetBox.textContent = `# 1) เชื่อมต่อ mybot-cli (~/.mybot/config.toml)
[providers.caelum]
kind = "openai"
base_url = "http://127.0.0.1:${port}/v1"
model = "caelum-local"

# 2) เชื่อมต่อ My Bot AI (.env)
LLM_BASE_URL="http://127.0.0.1:${port}/v1"

# 3) ทดสอบด้วย cURL
curl http://127.0.0.1:${port}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"messages":[{"role":"user","content":"สวัสดี Caelum"}]}'`;
  }

  async function pollHealthOnce() {
    const base = `http://127.0.0.1:${engineState.port}`;
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const data = await res.json();
        engineState.ready = true;
        setStatus("online", `Ready · ${data.model} (${data.kv_mode})`);
        return true;
      }
    } catch (_) {}
    if (engineState.running) {
      setStatus("loading", `Loading into VRAM (:${engineState.port})…`);
    } else {
      setStatus("idle", "No model loaded");
    }
    return false;
  }

  async function startRuntime() {
    const modelPath = modelSelect.value;
    if (!modelPath) {
      alert("กรุณาเลือกโมเดล .gguf ก่อนครับ");
      return;
    }
    localStorage.setItem("caelum_studio_last_model", modelPath);
    const port = Number(srvPort.value) || 8000;
    const host = (srvHost.value || "127.0.0.1").trim();
    const ctx = Number(srvCtx.value) || 4096;

    setStatus("loading", `Loading model on :${port}…`);
    try {
      const st = await invoke("start_engine", {
        opts: {
          model_path: modelPath,
          gpu: srvGpu.checked,
          port,
          ctx,
          kv_q8: srvKvQ8.checked,
          host,
        },
      });
      engineState = { running: st.running, ready: false, port: st.port, host: st.host, modelPath: st.model_path || "" };
      renderModels();
      updateConnectSnippet();
      if (healthTimer) clearInterval(healthTimer);
      healthTimer = setInterval(() => { void pollHealthOnce(); }, 1500);
    } catch (err) {
      setStatus("idle", "Load failed");
      appendLog(`[start_engine error] ${err}`);
      alert(String(err));
    }
  }

  async function stopRuntime() {
    try {
      await invoke("stop_engine");
    } catch (err) {
      appendLog(`[stop_engine error] ${err}`);
    }
    engineState.running = false;
    engineState.ready = false;
    engineState.modelPath = "";
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
    setStatus("idle", "No model loaded");
    renderModels();
  }

  // ---------------- LIVE CHAT SSE ----------------
  function addChatBubble(role, text) {
    emptyChatEl.hidden = true;
    const row = document.createElement("div");
    row.className = "msg-row";
    const av = document.createElement("div");
    av.className = `msg-avatar ${role}`;
    av.textContent = role === "user" ? "U" : "✦";
    const body = document.createElement("div");
    body.className = "msg-body";
    const roleEl = document.createElement("div");
    roleEl.className = "msg-role";
    roleEl.textContent = role === "user" ? "You" : "Caelum Runtime";
    const contentEl = document.createElement("div");
    contentEl.className = "msg-content";
    window.CaelumMarkdown.renderInto(contentEl, text);
    body.append(roleEl, contentEl);
    row.append(av, body);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return { row, body, contentEl };
  }

  async function sendChat() {
    const text = promptEl.value.trim();
    if (!text || abortController) return;
    if (!engineState.ready) {
      const ok = await pollHealthOnce();
      if (!ok) {
        alert("กรุณากด Load Model ด้านบนก่อนเริ่มแชทครับ");
        return;
      }
    }

    promptEl.value = "";
    chatHistory.push({ role: "user", content: text });
    addChatBubble("user", text);

    const asst = addChatBubble("assistant", "…");
    sendBtn.hidden = true;
    stopBtn.hidden = false;

    abortController = new AbortController();
    const startMs = performance.now();
    let firstMs = null;
    let tokens = 0;
    let full = "";

    const sysText = sysPromptInput.value.trim();
    const payloadMessages = sysText
      ? [{ role: "system", content: sysText }, ...chatHistory]
      : [...chatHistory];

    try {
      const res = await fetch(`http://127.0.0.1:${engineState.port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: payloadMessages,
          temperature: parseFloat(tempInput.value) || 0.7,
          max_tokens: parseInt(maxTokInput.value, 10) || 1024,
          stream: true,
        }),
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) {
        const errTxt = await res.text();
        asst.contentEl.textContent = `Error ${res.status}: ${errTxt}`;
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data: ")) continue;
          const p = t.slice(6);
          if (p === "[DONE]") break;
          try {
            const parsed = JSON.parse(p);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              if (firstMs === null) firstMs = performance.now();
              tokens++;
              full += delta;
              window.CaelumMarkdown.renderInto(asst.contentEl, full);
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }
          } catch (_) {}
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        asst.contentEl.textContent = full || `Connection error: ${err.message}`;
      }
    } finally {
      const sec = Math.max((performance.now() - startMs) / 1000, 0.001);
      const ttft = firstMs !== null ? ((firstMs - startMs) / 1000).toFixed(2) : "0.00";
      const tps = (tokens / sec).toFixed(1);
      const hud = document.createElement("div");
      hud.className = "msg-hud";
      hud.textContent = `⚡ ${tps} tok/s · ${tokens} tokens · TTFT ${ttft}s`;
      asst.body.appendChild(hud);
      if (full) chatHistory.push({ role: "assistant", content: full });
      abortController = null;
      sendBtn.hidden = false;
      stopBtn.hidden = true;
    }
  }

  // ---------------- HUGGING FACE DISCOVER ----------------
  async function searchHub() {
    const q = hfQueryInput.value.trim();
    hfReposList.textContent = "กำลังค้นหา Hugging Face Hub…";
    hfFilesList.textContent = "";
    try {
      const repos = await invoke("search_hf_models", { query: q });
      hfReposList.textContent = "";
      if (!repos.length) {
        hfReposList.textContent = "ไม่พบโมเดล GGUF ที่ตรงกับคำค้นหา";
        return;
      }
      repos.forEach((r) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "repo-item";
        const title = document.createElement("div");
        title.className = "model-name";
        title.textContent = r.id;
        const meta = document.createElement("div");
        meta.className = "model-meta";
        meta.textContent = `⬇ ${r.downloads.toLocaleString()} · ♥ ${r.likes.toLocaleString()}`;
        btn.append(title, meta);
        btn.addEventListener("click", () => {
          document.querySelectorAll(".repo-item").forEach((el) => el.classList.remove("selected"));
          btn.classList.add("selected");
          void loadRepoFiles(r.id);
        });
        hfReposList.appendChild(btn);
      });
    } catch (err) {
      hfReposList.textContent = String(err);
    }
  }

  async function loadRepoFiles(repoId) {
    hfFilesList.textContent = `กำลังดึงรายการไฟล์ GGUF จาก ${repoId}…`;
    try {
      const files = await invoke("list_hf_gguf_files", { repoId });
      hfFilesList.textContent = "";
      if (!files.length) {
        hfFilesList.textContent = "ไม่พบไฟล์ .gguf ใน root ของ repo นี้";
        return;
      }
      files.forEach((f) => {
        const row = document.createElement("div");
        row.className = "file-row";
        const info = document.createElement("div");
        const name = document.createElement("div");
        name.className = "model-name";
        name.textContent = f.filename;
        const meta = document.createElement("div");
        meta.className = "model-meta";
        const fits = f.size_bytes < 10.5 * 1024 ** 3;
        meta.textContent = `${fmtGb(f.size_bytes)} · ${fits ? "✅ Fits 12GB Arc B580" : "⚠️ Needs >12GB VRAM / CPU"}`;
        info.append(name, meta);

        const dlBtn = document.createElement("button");
        dlBtn.type = "button";
        dlBtn.className = "btn btn-primary";
        dlBtn.textContent = "⬇ Download";
        dlBtn.addEventListener("click", async () => {
          dlBanner.hidden = false;
          dlText.textContent = `กำลังดาวน์โหลด ${f.filename}…`;
          dlFill.style.width = "2%";
          try {
            await invoke("download_hf_model", {
              repoId: f.repo_id,
              filename: f.filename,
              totalBytes: f.size_bytes,
            });
          } catch (err) {
            dlText.textContent = `Download error: ${err}`;
          }
        });

        row.append(info, dlBtn);
        hfFilesList.appendChild(row);
      });
    } catch (err) {
      hfFilesList.textContent = String(err);
    }
  }

  // ---------------- WIRE UP EVENTS ----------------
  loadBtn.addEventListener("click", () => void startRuntime());
  ejectBtn.addEventListener("click", () => void stopRuntime());
  document.getElementById("srv-start-btn").addEventListener("click", () => void startRuntime());
  document.getElementById("srv-stop-btn").addEventListener("click", () => void stopRuntime());
  document.getElementById("logs-clear-btn").addEventListener("click", () => { logsBox.textContent = ""; });
  document.getElementById("rescan-btn").addEventListener("click", () => void refreshModels());
  document.getElementById("add-dir-btn").addEventListener("click", () => {
    const dir = extraDirInput.value.trim();
    if (dir && !extraDirs.includes(dir)) {
      extraDirs.push(dir);
      localStorage.setItem("caelum_studio_dirs", JSON.stringify(extraDirs));
      extraDirInput.value = "";
      void refreshModels();
    }
  });
  modelSearchInput.addEventListener("input", renderModels);
  document.getElementById("hf-search-btn").addEventListener("click", () => void searchHub());
  hfQueryInput.addEventListener("keydown", (e) => { if (e.key === "Enter") void searchHub(); });
  document.getElementById("inspect-close-btn").addEventListener("click", () => inspectDialog.close());

  sendBtn.addEventListener("click", () => void sendChat());
  stopBtn.addEventListener("click", () => { if (abortController) abortController.abort(); });
  clearChatBtn.addEventListener("click", () => {
    chatHistory = [];
    messagesEl.textContent = "";
    messagesEl.appendChild(emptyChatEl);
    emptyChatEl.hidden = false;
  });
  promptEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendChat();
    }
  });
  tempInput.addEventListener("input", () => { tempVal.textContent = tempInput.value; });
  srvPort.addEventListener("input", updateConnectSnippet);

  // Tauri native events
  if (isTauri) {
    tauriEvent.listen("engine-log", (ev) => appendLog(String(ev.payload)));
    tauriEvent.listen("engine-exit", () => {
      engineState.running = false;
      engineState.ready = false;
      setStatus("idle", "Runtime exited");
      renderModels();
    });
    tauriEvent.listen("download-progress", (ev) => {
      const p = ev.payload;
      dlBanner.hidden = false;
      const pct = p.total_bytes > 0 ? Math.min(100, Math.round((p.downloaded_bytes / p.total_bytes) * 100)) : 0;
      dlFill.style.width = `${pct}%`;
      if (p.status === "done") {
        dlText.textContent = `✅ ดาวน์โหลด ${p.filename} สำเร็จแล้ว! (${fmtGb(p.downloaded_bytes)})`;
        void refreshModels();
      } else if (p.status === "error") {
        dlText.textContent = `❌ ดาวน์โหลดล้มเหลว: ${p.error}`;
      } else {
        dlText.textContent = `⬇ ${p.filename} — ${fmtGb(p.downloaded_bytes)} / ${fmtGb(p.total_bytes)} (${pct}%)`;
      }
    });
  }

  // Bootstrap
  updateConnectSnippet();
  void loadHardware();
  void refreshModels();
})();
