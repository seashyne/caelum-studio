// Caelum Studio — Precision Workbench Desktop Controller (Tauri 2)
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
  let activeSourceFilter = "all";
  let activeSnippetTab = "mybot-cli";
  let pendingDeleteModel = null;

  // DOM refs
  const modelSelect = document.getElementById("top-model-select");
  const loadBtn = document.getElementById("top-load-btn");
  const ejectBtn = document.getElementById("top-eject-btn");
  const statusChip = document.getElementById("top-status-chip");
  const statusDot = document.getElementById("top-status-dot");
  const statusText = document.getElementById("top-status-text");
  const railServerDot = document.getElementById("rail-server-dot");
  const railModelCount = document.getElementById("rail-model-count");

  const inspectorEl = document.getElementById("chat-inspector");
  const inspectorToggleBtn = document.getElementById("inspector-toggle-btn");
  const inspectorCloseBtn = document.getElementById("inspector-close-btn");
  const composerParamPill = document.getElementById("composer-param-pill");
  const pillParamsText = document.getElementById("pill-params-text");

  const messagesEl = document.getElementById("chat-messages");
  const emptyChatEl = document.getElementById("chat-empty");
  const emptySubtitleEl = document.getElementById("empty-subtitle");
  const promptEl = document.getElementById("chat-prompt");
  const sendBtn = document.getElementById("chat-send-btn");
  const stopBtn = document.getElementById("chat-stop-btn");
  const clearChatBtn = document.getElementById("chat-clear-btn");
  const clearChatInlineBtn = document.getElementById("chat-clear-inline-btn");

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
  const hfRepoCount = document.getElementById("hf-repo-count");
  const hfFileCount = document.getElementById("hf-file-count");
  const dlBanner = document.getElementById("dl-banner");
  const dlText = document.getElementById("dl-text");
  const dlPct = document.getElementById("dl-pct");
  const dlFill = document.getElementById("dl-fill");

  const srvPort = document.getElementById("srv-port");
  const srvHost = document.getElementById("srv-host");
  const srvCtx = document.getElementById("srv-ctx");
  const srvGpu = document.getElementById("srv-gpu");
  const srvKvQ8 = document.getElementById("srv-kvq8");
  const logsBox = document.getElementById("logs-box");
  const snippetBox = document.getElementById("connect-snippet");
  const endpointUrlLabel = document.getElementById("endpoint-url-label");

  const inspectDialog = document.getElementById("inspect-dialog");
  const inspectTitle = document.getElementById("inspect-title");
  const inspectPre = document.getElementById("inspect-pre");
  const confirmDialog = document.getElementById("confirm-dialog");
  const confirmDesc = document.getElementById("confirm-desc");

  const toastStack = document.getElementById("toast-stack");
  const hwGpuEl = document.getElementById("hw-gpu");
  const hwRamEl = document.getElementById("hw-ram");

  // ---------------- HELPERS ----------------
  function fmtGb(bytes) {
    if (!bytes) return "0 GB";
    return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
  }

  function extractQuant(filename) {
    const m = /([IQ]{1,2}\d_[A-Z0-9_]+|Q\d_0|F16|BF16|FP16)/i.exec(filename || "");
    return m ? m[1].toUpperCase() : "";
  }

  function appendLog(line) {
    logsBox.textContent += `${line}\n`;
    logsBox.scrollTop = logsBox.scrollHeight;
  }

  function showToast(message, kind = "info", durationMs = 4200) {
    const toast = document.createElement("div");
    toast.className = `toast ${kind}`;
    const body = document.createElement("div");
    body.className = "toast-body";
    body.textContent = message;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "×";
    const dismiss = () => toast.remove();
    close.addEventListener("click", dismiss);
    toast.append(body, close);
    toastStack.appendChild(toast);
    if (durationMs > 0) setTimeout(dismiss, durationMs);
  }

  // Top-layer dialog close fallback (Modern Web Guidance: animate-to-from-top-layer + light-dismiss-a-dialog)
  let supportsDisplayTransition;
  function canTransitionDisplay() {
    if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
    if (!window.CSS?.supports?.("transition-behavior", "allow-discrete") || !document.body) {
      return false;
    }
    const probe = document.createElement("div");
    probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
    document.body.appendChild(probe);
    getComputedStyle(probe).display;
    probe.style.display = "none";
    supportsDisplayTransition = getComputedStyle(probe).display === "block";
    probe.remove();
    return supportsDisplayTransition;
  }

  function supportsTopLayerExit() {
    return window.CSS?.supports?.("overlay", "auto") && canTransitionDisplay();
  }

  async function closeTopLayer(dialog) {
    if (!dialog.open) return;
    if (!supportsTopLayerExit()) {
      dialog.setAttribute("data-closing", "");
      const animations = dialog.getAnimations({ subtree: true });
      if (animations.length > 0) {
        await Promise.race([
          Promise.allSettled(animations.map((a) => a.finished)),
          new Promise((r) => setTimeout(r, 400)),
        ]);
      }
      if (!dialog.hasAttribute("data-closing")) return;
      dialog.removeAttribute("data-closing");
    }
    dialog.close();
  }

  function wireDialog(dialog) {
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      void closeTopLayer(dialog);
    });
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      dialog.addEventListener("click", (e) => {
        if (e.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const inside =
          rect.top <= e.clientY &&
          e.clientY <= rect.top + rect.height &&
          rect.left <= e.clientX &&
          e.clientX <= rect.left + rect.width;
        if (!inside) void closeTopLayer(dialog);
      });
    }
  }
  wireDialog(inspectDialog);
  wireDialog(confirmDialog);

  function setStatus(kind, text) {
    statusDot.className = `dot ${kind}`;
    statusChip.className = `status-chip ${kind}`;
    statusText.textContent = text;
    railServerDot.className = `rail-dot ${kind}`;
    loadBtn.disabled = kind === "loading";
    ejectBtn.disabled = kind === "idle";
    if (kind === "online") {
      emptySubtitleEl.textContent = `โมเดลพร้อมใช้งานแล้ว (${text}) — พิมพ์คำถามด้านล่างหรือเลือกตัวอย่างเพื่อเริ่มทดสอบ`;
    } else if (kind === "loading") {
      emptySubtitleEl.textContent = "กำลังโหลดโมเดลเข้าสู่หน่วยความจำ GPU/RAM…";
    } else {
      emptySubtitleEl.textContent = "เลือกโมเดล GGUF ด้านบนแล้วกด Load เพื่อรันบน Intel Arc B580 หรือ CPU แบบออฟไลน์ 100%";
    }
  }

  function syncParamPill() {
    const t = Number(tempInput.value || 0.7).toFixed(2);
    const maxTok = parseInt(maxTokInput.value, 10) || 1024;
    tempVal.textContent = t;
    pillParamsText.textContent = `temp ${t} · ${maxTok} tok`;
  }

  function setInspectorOpen(open) {
    inspectorEl.hidden = !open;
    inspectorToggleBtn.setAttribute("aria-pressed", open ? "true" : "false");
  }

  function autoResizePrompt() {
    promptEl.style.height = "auto";
    promptEl.style.height = `${Math.min(promptEl.scrollHeight, 180)}px`;
  }

  // ---------------- TABS ----------------
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
    inspectorToggleBtn.hidden = tab.id !== "tab-chat";
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
  let theme = localStorage.getItem("caelum-studio-theme") || "dark";
  const themeBtn = document.getElementById("theme-btn");
  const themeLabel = document.getElementById("theme-label");
  const themeIconSun = document.getElementById("theme-icon-sun");
  const themeIconMoon = document.getElementById("theme-icon-moon");
  function applyTheme(next, persist = false) {
    theme = next;
    document.documentElement.setAttribute("data-theme", next);
    themeLabel.textContent = next === "dark" ? "Light mode" : "Dark mode";
    themeIconSun.hidden = next !== "dark";
    themeIconMoon.hidden = next === "dark";
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
      hwGpuEl.textContent = "Preview mode — launch native binary for full hardware telemetry";
      return;
    }
    try {
      const hw = await invoke("get_hardware_info");
      hwGpuEl.textContent = `${hw.gpu_profile} · ${hw.caelum_version}`;
      hwRamEl.textContent = `RAM ${hw.ram_available_gb} / ${hw.ram_total_gb} GB free`;
    } catch (err) {
      hwGpuEl.textContent = `Runtime unavailable: ${err}`;
    }
  }

  function renderModels() {
    railModelCount.textContent = String(models.length);
    const q = (modelSearchInput.value || "").trim().toLowerCase();
    const filtered = models.filter((m) => {
      const matchSrc = activeSourceFilter === "all" || m.source.toLowerCase().includes(activeSourceFilter.toLowerCase());
      const matchQ = !q || m.name.toLowerCase().includes(q) || m.source.toLowerCase().includes(q);
      return matchSrc && matchQ;
    });

    // Top bar select
    const prevSel = modelSelect.value || localStorage.getItem("caelum_studio_last_model") || "";
    modelSelect.textContent = "";
    if (models.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "ไม่พบไฟล์ .gguf — เปิด Discover เพื่อดาวน์โหลด";
      modelSelect.appendChild(opt);
    } else {
      models.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.path;
        opt.textContent = `${m.name} (${fmtGb(m.size_bytes)})`;
        modelSelect.appendChild(opt);
      });
      if (models.some((m) => m.path === prevSel)) modelSelect.value = prevSel;
    }

    // My Models Linear-style list
    modelsGrid.textContent = "";
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-list-msg";
      empty.textContent = "ไม่พบไฟล์โมเดล .gguf ที่ตรงกับเงื่อนไขการค้นหา";
      modelsGrid.appendChild(empty);
      return;
    }

    filtered.forEach((m) => {
      const isActive = engineState.modelPath === m.path && engineState.running;
      const row = document.createElement("div");
      row.className = `model-row${isActive ? " active" : ""}`;

      const main = document.createElement("div");
      main.className = "model-row-main";

      const titleRow = document.createElement("div");
      titleRow.className = "model-row-title";
      const nameEl = document.createElement("div");
      nameEl.className = "model-name";
      nameEl.title = m.path;
      nameEl.textContent = m.name;
      titleRow.appendChild(nameEl);

      if (isActive) {
        const activeBadge = document.createElement("span");
        activeBadge.className = "badge ok";
        activeBadge.textContent = "✓ Loaded";
        titleRow.appendChild(activeBadge);
      }

      const meta = document.createElement("div");
      meta.className = "model-meta";

      const sizeSpan = document.createElement("span");
      sizeSpan.className = "tabular";
      sizeSpan.textContent = fmtGb(m.size_bytes);
      meta.appendChild(sizeSpan);

      const quant = extractQuant(m.name);
      if (quant) {
        const qBadge = document.createElement("span");
        qBadge.className = "badge mono";
        qBadge.textContent = quant;
        meta.appendChild(qBadge);
      }

      const srcBadge = document.createElement("span");
      srcBadge.className = "badge";
      srcBadge.textContent = m.source;
      meta.appendChild(srcBadge);

      const fits = m.size_bytes < 10.5 * 1024 ** 3;
      const fitBadge = document.createElement("span");
      fitBadge.className = fits ? "badge ok" : "badge warn";
      fitBadge.textContent = fits ? "✓ 12GB VRAM" : "▲ Large / CPU";
      meta.appendChild(fitBadge);

      main.append(titleRow, meta);

      const actions = document.createElement("div");
      actions.className = "model-row-actions";

      const btnLoad = document.createElement("button");
      btnLoad.type = "button";
      btnLoad.className = isActive ? "btn btn-sm" : "btn btn-primary btn-sm";
      btnLoad.textContent = isActive ? "Reload" : "Load";
      btnLoad.addEventListener("click", () => {
        modelSelect.value = m.path;
        void startRuntime();
      });

      const btnInspect = document.createElement("button");
      btnInspect.type = "button";
      btnInspect.className = "btn btn-sm";
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
        btnDel.className = "btn btn-ghost btn-sm";
        btnDel.textContent = "Delete";
        btnDel.addEventListener("click", () => {
          pendingDeleteModel = m;
          confirmDesc.textContent = `ต้องการลบไฟล์ "${m.name}" (${fmtGb(m.size_bytes)}) ออกจาก ~/.caelum/models ถาวรหรือไม่? การลบนี้ไม่สามารถกู้คืนได้`;
          confirmDialog.showModal();
        });
        actions.appendChild(btnDel);
      }

      row.append(main, actions);
      modelsGrid.appendChild(row);
    });
  }

  async function refreshModels() {
    if (!isTauri) return;
    try {
      models = await invoke("scan_models", { extraDirs });
      renderModels();
    } catch (err) {
      appendLog(`[scan_models error] ${err}`);
      showToast(`สแกนโมเดลไม่สำเร็จ: ${err}`, "danger");
    }
  }

  // ---------------- RUNTIME START / STOP / HEALTH ----------------
  function updateConnectSnippet() {
    const host = (srvHost.value || "127.0.0.1").trim();
    const port = Number(srvPort.value) || 8000;
    const baseUrl = `http://${host}:${port}/v1`;
    endpointUrlLabel.textContent = baseUrl;

    if (activeSnippetTab === "mybot-cli") {
      snippetBox.textContent = `# ~/.mybot/config.toml
[providers.caelum]
kind = "openai"
base_url = "${baseUrl}"
model = "caelum-local"`;
    } else if (activeSnippetTab === "my-bot-ai") {
      snippetBox.textContent = `# my-bot-ai/.env
LLM_BASE_URL="${baseUrl}"
LLM_MODEL="caelum-local"`;
    } else {
      snippetBox.textContent = `curl ${baseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"messages":[{"role":"user","content":"สวัสดี Caelum"}]}'`;
    }
  }

  async function pollHealthOnce() {
    const base = `http://127.0.0.1:${engineState.port}`;
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const data = await res.json();
        const wasReady = engineState.ready;
        engineState.ready = true;
        setStatus("online", `${data.model} · ${data.kv_mode}`);
        if (!wasReady) showToast(`โหลดโมเดล ${data.model} พร้อมใช้งานแล้ว`, "ok");
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
      showToast("กรุณาเลือกไฟล์โมเดล .gguf ด้านบนก่อนครับ", "warn");
      return;
    }
    localStorage.setItem("caelum_studio_last_model", modelPath);
    const port = Number(srvPort.value) || 8000;
    const host = (srvHost.value || "127.0.0.1").trim();
    const ctx = Number(srvCtx.value) || 4096;

    setStatus("loading", `Loading on :${port}…`);
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
      showToast(`ไม่สามารถโหลดโมเดลได้: ${err}`, "danger", 6000);
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
    showToast("ปิด runtime และคืนหน่วยความจำแล้ว", "info", 2800);
  }

  // ---------------- LIVE CHAT SSE ----------------
  function createTypingIndicator() {
    const wrap = document.createElement("div");
    wrap.className = "typing-dots";
    wrap.setAttribute("aria-label", "Generating response");
    wrap.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
    return wrap;
  }

  function addUserTurn(text) {
    emptyChatEl.hidden = true;
    const turn = document.createElement("div");
    turn.className = "msg-turn user";
    const bubble = document.createElement("div");
    bubble.className = "msg-user-bubble";
    bubble.textContent = text;
    turn.appendChild(bubble);
    messagesEl.appendChild(turn);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return turn;
  }

  function addAssistantTurn() {
    emptyChatEl.hidden = true;
    const turn = document.createElement("div");
    turn.className = "msg-turn assistant";

    const head = document.createElement("div");
    head.className = "msg-asst-head";
    const badge = document.createElement("div");
    badge.className = "msg-asst-badge";
    badge.textContent = "✦";
    const name = document.createElement("span");
    name.className = "msg-asst-name";
    name.textContent = "Caelum";
    head.append(badge, name);

    const contentEl = document.createElement("div");
    contentEl.className = "msg-content";
    contentEl.appendChild(createTypingIndicator());

    const footer = document.createElement("div");
    footer.className = "msg-footer";
    const hud = document.createElement("div");
    hud.className = "msg-hud";
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    footer.append(hud, actions);

    turn.append(head, contentEl, footer);
    messagesEl.appendChild(turn);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return { turn, contentEl, hud, actions };
  }

  function populateAssistantActions(actionsEl, text, isLast) {
    actionsEl.textContent = "";
    if (!text) return;

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn btn-ghost btn-sm";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = "Copied";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 1400);
      });
    });
    actionsEl.appendChild(copyBtn);

    if (isLast) {
      const regenBtn = document.createElement("button");
      regenBtn.type = "button";
      regenBtn.className = "btn btn-ghost btn-sm";
      regenBtn.textContent = "Regenerate";
      regenBtn.addEventListener("click", () => void regenerateLast());
      actionsEl.appendChild(regenBtn);
    }
  }

  async function runAssistantStream() {
    const asst = addAssistantTurn();
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
      asst.hud.textContent = `${tps} tok/s · ${tokens} tokens · ${ttft}s TTFT`;
      if (full) chatHistory.push({ role: "assistant", content: full });
      populateAssistantActions(asst.actions, full, true);
      abortController = null;
      sendBtn.hidden = false;
      stopBtn.hidden = true;
    }
  }

  async function sendChat() {
    const text = promptEl.value.trim();
    if (!text || abortController) return;
    if (!engineState.ready) {
      const ok = await pollHealthOnce();
      if (!ok) {
        showToast("ยังไม่ได้โหลดโมเดล — กด Load ด้านบนก่อนเริ่มแชทครับ", "warn");
        return;
      }
    }

    promptEl.value = "";
    autoResizePrompt();
    chatHistory.push({ role: "user", content: text });
    addUserTurn(text);
    await runAssistantStream();
  }

  async function regenerateLast() {
    if (abortController || chatHistory.length === 0) return;
    if (chatHistory[chatHistory.length - 1].role === "assistant") {
      chatHistory.pop();
      const lastTurn = messagesEl.lastElementChild;
      if (lastTurn && lastTurn.classList.contains("assistant")) lastTurn.remove();
    }
    await runAssistantStream();
  }

  function clearChat() {
    if (abortController) abortController.abort();
    chatHistory = [];
    messagesEl.textContent = "";
    messagesEl.appendChild(emptyChatEl);
    emptyChatEl.hidden = false;
  }

  // ---------------- HUGGING FACE DISCOVER ----------------
  async function searchHub() {
    const q = hfQueryInput.value.trim();
    hfReposList.textContent = "";
    const loading = document.createElement("div");
    loading.className = "empty-list-msg";
    loading.textContent = "กำลังค้นหา Hugging Face Hub…";
    hfReposList.appendChild(loading);
    hfFilesList.textContent = "";
    hfRepoCount.textContent = "";
    hfFileCount.textContent = "";

    try {
      const repos = await invoke("search_hf_models", { query: q });
      hfReposList.textContent = "";
      hfRepoCount.textContent = `${repos.length}`;
      if (!repos.length) {
        const empty = document.createElement("div");
        empty.className = "empty-list-msg";
        empty.textContent = "ไม่พบโมเดล GGUF ที่ตรงกับคำค้นหา";
        hfReposList.appendChild(empty);
        return;
      }
      repos.forEach((r) => {
        const [org, repoName] = r.id.includes("/") ? r.id.split("/") : ["", r.id];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "repo-item";
        if (org) {
          const orgEl = document.createElement("div");
          orgEl.className = "repo-org";
          orgEl.textContent = org;
          btn.appendChild(orgEl);
        }
        const title = document.createElement("div");
        title.className = "model-name";
        title.textContent = repoName;
        const meta = document.createElement("div");
        meta.className = "model-meta tabular";
        meta.textContent = `${r.downloads.toLocaleString()} downloads · ${r.likes.toLocaleString()} likes`;
        btn.append(title, meta);
        btn.addEventListener("click", () => {
          document.querySelectorAll(".repo-item").forEach((el) => el.classList.remove("selected"));
          btn.classList.add("selected");
          void loadRepoFiles(r.id);
        });
        hfReposList.appendChild(btn);
      });
    } catch (err) {
      hfReposList.textContent = "";
      const e = document.createElement("div");
      e.className = "empty-list-msg";
      e.textContent = String(err);
      hfReposList.appendChild(e);
    }
  }

  async function loadRepoFiles(repoId) {
    hfFilesList.textContent = "";
    const loading = document.createElement("div");
    loading.className = "empty-list-msg";
    loading.textContent = `กำลังดึงรายการไฟล์ GGUF จาก ${repoId}…`;
    hfFilesList.appendChild(loading);
    hfFileCount.textContent = "";

    try {
      const files = await invoke("list_hf_gguf_files", { repoId });
      hfFilesList.textContent = "";
      hfFileCount.textContent = `${files.length} files`;
      if (!files.length) {
        const empty = document.createElement("div");
        empty.className = "empty-list-msg";
        empty.textContent = "ไม่พบไฟล์ .gguf ใน root ของ repo นี้";
        hfFilesList.appendChild(empty);
        return;
      }
      files.forEach((f) => {
        const row = document.createElement("div");
        row.className = "file-row";
        const info = document.createElement("div");
        info.className = "file-info";

        const name = document.createElement("div");
        name.className = "model-name";
        name.title = f.filename;
        name.textContent = f.filename;

        const meta = document.createElement("div");
        meta.className = "model-meta";
        const sizeSpan = document.createElement("span");
        sizeSpan.className = "tabular";
        sizeSpan.textContent = fmtGb(f.size_bytes);
        meta.appendChild(sizeSpan);

        const quant = extractQuant(f.filename);
        if (quant) {
          const qBadge = document.createElement("span");
          qBadge.className = "badge mono";
          qBadge.textContent = quant;
          meta.appendChild(qBadge);
        }

        const fits = f.size_bytes < 10.5 * 1024 ** 3;
        const fitBadge = document.createElement("span");
        fitBadge.className = fits ? "badge ok" : "badge warn";
        fitBadge.textContent = fits ? "✓ Fits 12GB" : "▲ >12GB";
        meta.appendChild(fitBadge);

        info.append(name, meta);

        const dlBtn = document.createElement("button");
        dlBtn.type = "button";
        dlBtn.className = "btn btn-primary btn-sm";
        dlBtn.textContent = "Download";
        dlBtn.addEventListener("click", async () => {
          dlBanner.hidden = false;
          dlText.textContent = `Downloading ${f.filename}…`;
          dlPct.textContent = "0%";
          dlFill.style.width = "2%";
          try {
            await invoke("download_hf_model", {
              repoId: f.repo_id,
              filename: f.filename,
              totalBytes: f.size_bytes,
            });
          } catch (err) {
            dlText.textContent = `Download error: ${err}`;
            showToast(`ดาวน์โหลดล้มเหลว: ${err}`, "danger");
          }
        });

        row.append(info, dlBtn);
        hfFilesList.appendChild(row);
      });
    } catch (err) {
      hfFilesList.textContent = "";
      const e = document.createElement("div");
      e.className = "empty-list-msg";
      e.textContent = String(err);
      hfFilesList.appendChild(e);
    }
  }

  // ---------------- WIRE UP EVENTS ----------------
  loadBtn.addEventListener("click", () => void startRuntime());
  ejectBtn.addEventListener("click", () => void stopRuntime());
  document.getElementById("srv-start-btn").addEventListener("click", () => void startRuntime());
  document.getElementById("srv-stop-btn").addEventListener("click", () => void stopRuntime());
  document.getElementById("logs-clear-btn").addEventListener("click", () => { logsBox.textContent = ""; });
  document.getElementById("rescan-btn").addEventListener("click", async () => {
    await refreshModels();
    showToast(`สแกนพบโมเดล GGUF ทั้งหมด ${models.length} ไฟล์`, "info", 2400);
  });

  document.getElementById("add-dir-btn").addEventListener("click", () => {
    const dir = extraDirInput.value.trim();
    if (dir && !extraDirs.includes(dir)) {
      extraDirs.push(dir);
      localStorage.setItem("caelum_studio_dirs", JSON.stringify(extraDirs));
      extraDirInput.value = "";
      void refreshModels();
      showToast(`เพิ่มโฟลเดอร์ ${dir} แล้ว`, "ok", 2600);
    }
  });

  // Source filter pills
  document.querySelectorAll("#source-filters .chip-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#source-filters .chip-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeSourceFilter = btn.dataset.src || "all";
      renderModels();
    });
  });

  modelSearchInput.addEventListener("input", renderModels);
  document.getElementById("hf-search-btn").addEventListener("click", () => void searchHub());
  hfQueryInput.addEventListener("keydown", (e) => { if (e.key === "Enter") void searchHub(); });

  // Popular HF search chips
  document.querySelectorAll("[data-hf-q]").forEach((btn) => {
    btn.addEventListener("click", () => {
      hfQueryInput.value = btn.dataset.hfQ || "";
      void searchHub();
    });
  });

  // Starter prompt chips
  document.querySelectorAll(".starter-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      promptEl.value = btn.dataset.prompt || "";
      autoResizePrompt();
      promptEl.focus();
    });
  });

  // Inspector controls
  inspectorToggleBtn.addEventListener("click", () => setInspectorOpen(inspectorEl.hidden));
  inspectorCloseBtn.addEventListener("click", () => setInspectorOpen(false));
  composerParamPill.addEventListener("click", () => setInspectorOpen(inspectorEl.hidden));

  document.querySelectorAll("[data-temp]").forEach((btn) => {
    btn.addEventListener("click", () => {
      tempInput.value = btn.dataset.temp;
      syncParamPill();
    });
  });
  document.querySelectorAll("[data-maxtok]").forEach((btn) => {
    btn.addEventListener("click", () => {
      maxTokInput.value = btn.dataset.maxtok;
      syncParamPill();
    });
  });
  tempInput.addEventListener("input", syncParamPill);
  maxTokInput.addEventListener("input", syncParamPill);

  // Dialog buttons
  document.getElementById("inspect-close-btn").addEventListener("click", () => void closeTopLayer(inspectDialog));
  document.getElementById("inspect-copy-btn").addEventListener("click", () => {
    navigator.clipboard.writeText(inspectPre.textContent || "").then(() => showToast("คัดลอกข้อมูล GGUF แล้ว", "ok", 2000));
  });
  document.getElementById("confirm-cancel-btn").addEventListener("click", () => {
    pendingDeleteModel = null;
    void closeTopLayer(confirmDialog);
  });
  document.getElementById("confirm-ok-btn").addEventListener("click", async () => {
    const target = pendingDeleteModel;
    pendingDeleteModel = null;
    await closeTopLayer(confirmDialog);
    if (!target) return;
    try {
      await invoke("delete_managed_model", { modelPath: target.path });
      await refreshModels();
      showToast(`ลบไฟล์ ${target.name} แล้ว`, "ok", 2800);
    } catch (err) {
      showToast(`ลบไฟล์ไม่สำเร็จ: ${err}`, "danger", 5000);
    }
  });

  // Snippet tabs + copy buttons
  document.querySelectorAll(".snippet-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".snippet-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeSnippetTab = btn.dataset.snippet || "mybot-cli";
      updateConnectSnippet();
    });
  });
  document.getElementById("copy-snippet-btn").addEventListener("click", () => {
    navigator.clipboard.writeText(snippetBox.textContent || "").then(() => showToast("คัดลอกโค้ดเชื่อมต่อแล้ว", "ok", 2000));
  });
  document.getElementById("copy-endpoint-btn").addEventListener("click", () => {
    navigator.clipboard.writeText(endpointUrlLabel.textContent || "").then(() => showToast("คัดลอก API Endpoint แล้ว", "ok", 2000));
  });

  // Chat buttons & composer
  sendBtn.addEventListener("click", () => void sendChat());
  stopBtn.addEventListener("click", () => { if (abortController) abortController.abort(); });
  clearChatBtn.addEventListener("click", clearChat);
  clearChatInlineBtn.addEventListener("click", clearChat);
  promptEl.addEventListener("input", autoResizePrompt);
  promptEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendChat();
    }
  });

  srvPort.addEventListener("input", updateConnectSnippet);
  srvHost.addEventListener("input", updateConnectSnippet);

  // Global keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      modelSelect.focus();
    } else if (mod && e.key.toLowerCase() === "i") {
      e.preventDefault();
      if (!document.getElementById("panel-chat").hidden) setInspectorOpen(inspectorEl.hidden);
    } else if (mod && e.shiftKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      clearChat();
    }
  });

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
      dlPct.textContent = `${pct}%`;
      if (p.status === "done") {
        dlText.textContent = `Downloaded ${p.filename} (${fmtGb(p.downloaded_bytes)})`;
        showToast(`ดาวน์โหลด ${p.filename} สำเร็จแล้ว`, "ok");
        void refreshModels();
      } else if (p.status === "error") {
        dlText.textContent = `Failed: ${p.error}`;
        showToast(`ดาวน์โหลดล้มเหลว: ${p.error}`, "danger");
      } else {
        dlText.textContent = `${p.filename} — ${fmtGb(p.downloaded_bytes)} / ${fmtGb(p.total_bytes)}`;
      }
    });
  }

  // Bootstrap
  syncParamPill();
  updateConnectSnippet();
  void loadHardware();
  void refreshModels();
})();
