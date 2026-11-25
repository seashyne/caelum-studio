// Safe DOM-based Markdown Renderer (zero innerHTML of untrusted content)
window.CaelumMarkdown = (() => {
  function isTableSep(line) {
    const t = line.trim();
    return t.includes("|") && t.includes("-") && /^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(t);
  }

  function splitRow(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  }

  function appendInline(parent, text) {
    const regex = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
    let last = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1] !== undefined) {
        const el = document.createElement("code");
        el.className = "inline-code";
        el.textContent = m[1];
        parent.appendChild(el);
      } else if (m[2] !== undefined) {
        const el = document.createElement("strong");
        el.textContent = m[2];
        parent.appendChild(el);
      } else if (m[3] !== undefined) {
        const el = document.createElement("em");
        el.textContent = m[3];
        parent.appendChild(el);
      }
      last = regex.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function renderInto(container, raw) {
    container.textContent = "";
    const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) { i++; continue; }

      // Fenced code blocks
      const fence = /^```([a-zA-Z0-9_+-]*)\s*$/.exec(trimmed);
      if (fence) {
        const lang = fence[1] || "text";
        const buf = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
          buf.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        const codeText = buf.join("\n");
        const card = document.createElement("div");
        card.className = "code-card";
        const head = document.createElement("div");
        head.className = "code-card-head";
        const span = document.createElement("span");
        span.textContent = lang;
        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "btn btn-ghost btn-sm";
        copyBtn.style.height = "22px";
        copyBtn.style.fontSize = "11px";
        copyBtn.textContent = "Copy";
        copyBtn.addEventListener("click", () => {
          navigator.clipboard.writeText(codeText).then(() => {
            copyBtn.textContent = "Copied";
            setTimeout(() => { copyBtn.textContent = "Copy"; }, 1400);
          });
        });
        head.append(span, copyBtn);
        const pre = document.createElement("pre");
        pre.className = "scroller";
        const code = document.createElement("code");
        code.textContent = codeText;
        pre.appendChild(code);
        card.append(head, pre);
        container.appendChild(card);
        continue;
      }

      // Headings
      const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
      if (heading) {
        const tag = `h${heading[1].length}`;
        const el = document.createElement(tag);
        appendInline(el, heading[2]);
        container.appendChild(el);
        i++;
        continue;
      }

      // Blockquotes
      if (/^>\s?/.test(trimmed)) {
        const bq = document.createElement("blockquote");
        const qLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
          qLines.push(lines[i].trim().replace(/^>\s?/, ""));
          i++;
        }
        appendInline(bq, qLines.join(" "));
        container.appendChild(bq);
        continue;
      }

      // GFM Tables
      if (trimmed.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const headers = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        const wrap = document.createElement("div");
        wrap.className = "md-table-wrap scroller";
        wrap.tabIndex = 0;
        wrap.setAttribute("role", "region");
        wrap.setAttribute("aria-label", "Data table");
        const table = document.createElement("table");
        table.className = "md-table";
        const thead = document.createElement("thead");
        const hr = document.createElement("tr");
        headers.forEach((h) => {
          const th = document.createElement("th");
          appendInline(th, h);
          hr.appendChild(th);
        });
        thead.appendChild(hr);
        const tbody = document.createElement("tbody");
        rows.forEach((r) => {
          const tr = document.createElement("tr");
          headers.forEach((_, ci) => {
            const td = document.createElement("td");
            appendInline(td, r[ci] || "");
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.append(thead, tbody);
        wrap.appendChild(table);
        container.appendChild(wrap);
        continue;
      }

      // Unordered lists
      if (/^[-*+]\s+/.test(trimmed)) {
        const ul = document.createElement("ul");
        while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
          const li = document.createElement("li");
          appendInline(li, lines[i].trim().replace(/^[-*+]\s+/, ""));
          ul.appendChild(li);
          i++;
        }
        container.appendChild(ul);
        continue;
      }

      // Ordered lists
      if (/^\d+\.\s+/.test(trimmed)) {
        const ol = document.createElement("ol");
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          const li = document.createElement("li");
          appendInline(li, lines[i].trim().replace(/^\d+\.\s+/, ""));
          ol.appendChild(li);
          i++;
        }
        container.appendChild(ol);
        continue;
      }

      const p = document.createElement("p");
      appendInline(p, line);
      container.appendChild(p);
      i++;
    }
  }

  return { renderInto };
})();
