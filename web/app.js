/* Architect Studio — Studio workspace client.
 *
 * Vanilla ES2020, no build step. Talks to:
 *   GET  /api/version, /api/i18n, /api/sandboxes, /api/rea
 *   POST /api/preview, /api/generate, /api/reverse, /api/chat, /api/sandbox
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = {
    badges: $("badges"),
    locale: $("locale"),
    themeBtn: $("themeBtn"),
    themeIcon: $("themeIcon"),
    chatLog: $("chatLog"),
    chatSource: $("chatSource"),
    chatForm: $("chatForm"),
    chatInput: $("chatInput"),
    sendBtn: $("sendBtn"),
    quick: $("quickPrompts"),
    idea: $("idea"),
    demo: $("demo"),
    apiKey: $("apiKey"),
    model: $("model"),
    baseUrl: $("baseUrl"),
    previewBtn: $("previewBtn"),
    generateBtn: $("generateBtn"),
    status: $("status"),
    repoPath: $("repoPath"),
    useRea: $("useRea"),
    analyzeBtn: $("analyzeBtn"),
    analysisStatus: $("analysisStatus"),
    stateJson: $("stateJson"),
    applyStateBtn: $("applyStateBtn"),
    chips: $("chips"),
    diagram: $("diagram"),
    diagramMeta: $("diagramMeta"),
    cards: $("cards"),
    kindFilters: $("kindFilters"),
    entityMeta: $("entityMeta"),
    fileTree: $("fileTree"),
    filePath: $("filePath"),
    fileMeta: $("fileMeta"),
    fileView: $("fileView"),
    selectFile: $("selectFile"),
    copyBtn: $("copyBtn"),
    taskRows: $("taskRows"),
    metricRows: $("metricRows"),
    validationList: $("validationList"),
    sandboxBtn: $("sandboxBtn"),
    downloadBtn: $("downloadBtn"),
    toast: $("toast"),
  };

  const app = {
    locale: "en",
    locales: [],
    messages: {},
    blueprint: null,
    chat: [],
    busy: false,
    activeFile: null,
    kindFilter: "all",
    selectedEntity: null,
    expandedNode: null,
    rea: null,
    sandboxes: [],
  };

  const DEFAULT_IDEA =
    "An orders API on Postgres with Redis events, a React storefront and Stripe payments for a mid-size marketplace.";

  const QUICK_PROMPTS = {
    en: ["Add a Redis cache", "Add a status field to Order", "Split into microservices"],
    tr: ["Redis cache ekle", "Order entity'sine status alanı koy", "Mikroservislere böl"],
    de: ["Redis-Cache hinzufügen", "Füge Order ein Status-Feld hinzu", "In Microservices aufteilen"],
    es: ["Añade una caché Redis", "Añade un campo status a Order", "Divide en microservicios"],
    fr: ["Ajoute un cache Redis", "Ajoute un champ status à Order", "Découpe en microservices"],
    pt: ["Adicione um cache Redis", "Adicione um campo status a Order", "Divida em microsserviços"],
    ja: ["Redisキャッシュを追加", "Orderにstatusフィールドを追加", "マイクロサービスに分割"],
    zh: ["添加 Redis 缓存", "给 Order 增加 status 字段", "拆分为微服务"],
  };

  const KIND_ICON = { service: "⚙", database: "◳", queue: "⇄", external: "☁", ui: "▤" };

  /* ------------------------------------------------------------- utilities */

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function t(key, fallback) {
    return app.messages[key] ?? fallback ?? key;
  }

  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.remove("hidden");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.toast.classList.add("hidden"), 2600);
  }

  function setStatus(node, message, kind) {
    node.textContent = message ?? "";
    node.classList.toggle("is-error", kind === "error");
    node.classList.toggle("is-ok", kind === "ok");
  }

  async function api(path, body) {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }

  function llmPayload() {
    return {
      locale: app.locale,
      demo: el.demo.checked,
      apiKey: el.apiKey.value.trim() || undefined,
      baseUrl: el.baseUrl.value.trim() || undefined,
      model: el.model.value.trim() || undefined,
    };
  }

  /* --------------------------------------------------------------- i18n */

  function applyTranslations() {
    document.documentElement.lang = app.locale;
    for (const node of document.querySelectorAll("[data-i18n]")) {
      const value = app.messages[node.dataset.i18n];
      if (value) node.textContent = value;
    }
    for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
      const value = app.messages[node.dataset.i18nPlaceholder];
      if (value) node.setAttribute("placeholder", value);
    }
    for (const node of document.querySelectorAll("[data-i18n-title]")) {
      const value = app.messages[node.dataset.i18nTitle];
      if (value) node.setAttribute("title", value);
    }
    el.sendBtn.textContent = t("ui.chatSend", "Send");
    renderQuickPrompts();
    renderChat();
    if (app.blueprint) {
      renderCards();
      renderChips();
    }
  }

  async function loadLocale(locale) {
    const data = await api(`/api/i18n?locale=${encodeURIComponent(locale)}`);
    app.locale = data.locale;
    app.messages = data.messages;
    app.locales = data.locales;
    localStorage.setItem("as.locale", app.locale);
    el.locale.innerHTML = app.locales
      .map((item) => `<option value="${item.id}">${escapeHtml(item.label)}</option>`)
      .join("");
    el.locale.value = app.locale;
    applyTranslations();
  }

  /* -------------------------------------------------------------- badge bar */

  function renderBadges() {
    const badges = [];
    if (app.version) badges.push(`<span class="badge">v${escapeHtml(app.version)}</span>`);
    if (app.rea) {
      const ready = app.rea.available === true;
      badges.push(
        `<span class="badge ${ready ? "is-ready" : "is-fallback"}" title="${escapeHtml(
          ready ? `${app.rea.binary ?? "rea"} ${app.rea.version ?? ""}` : app.rea.reason ?? "REA not installed",
        )}"><span class="dot"></span>REA ${ready ? escapeHtml(app.rea.engine) : "fallback"}</span>`,
      );
    }
    for (const sandbox of app.sandboxes.filter((item) => item.available || item.id === "temp-dir")) {
      badges.push(
        `<span class="badge ${sandbox.available ? "is-ready" : "is-off"}" title="${escapeHtml(
          sandbox.version ?? sandbox.isolation ?? "",
        )}"><span class="dot"></span>${escapeHtml(sandbox.id)}</span>`,
      );
    }
    el.badges.innerHTML = badges.join("");
  }

  /* ---------------------------------------------------------------- theme */

  function applyTheme(theme) {
    document.body.dataset.theme = theme;
    el.themeIcon.textContent = theme === "light" ? "☀" : "☾";
    localStorage.setItem("as.theme", theme);
    if (app.blueprint?.diagram) renderDiagram(app.blueprint.diagram);
  }

  /* ---------------------------------------------------------------- chips */

  function renderChips() {
    const blueprint = app.blueprint;
    if (!blueprint) {
      el.chips.innerHTML = "";
      return;
    }
    const summary = blueprint.summary ?? {};
    const validation = blueprint.validation ?? {};
    const chips = [
      ["", summary.nodes ?? blueprint.state?.nodes?.length ?? 0, "components"],
      ["", summary.entities ?? blueprint.state?.entities?.length ?? 0, "entities"],
      ["", summary.tasks ?? 0, "tasks"],
      ["", summary.waves ?? 0, "waves"],
      [
        validation.ok ? "ok" : "bad",
        `${Math.round((validation.passRate ?? 0) * 100)}%`,
        validation.ok ? "validated" : "issues",
      ],
    ];
    el.chips.innerHTML = chips
      .map(([kind, value, label]) => `<span class="chip ${kind}"><b>${value}</b>${label}</span>`)
      .join("");
  }

  /* -------------------------------------------------------------- diagram */

  let diagramSeq = 0;

  async function renderDiagram(source) {
    if (!source) {
      el.diagram.innerHTML = `<p class="placeholder">${escapeHtml(t("ui.diagramHint", "No diagram yet."))}</p>`;
      return;
    }
    try {
      // eslint-disable-next-line no-undef
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: document.body.dataset.theme === "light" ? "default" : "dark",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        flowchart: { curve: "basis", padding: 12 },
      });
      // eslint-disable-next-line no-undef
      const { svg } = await mermaid.render(`as-diagram-${++diagramSeq}`, source);
      el.diagram.innerHTML = svg;
      el.diagramMeta.textContent = `${app.blueprint?.state?.nodes?.length ?? 0} nodes · ${
        app.blueprint?.state?.edges?.length ?? 0
      } edges`;
    } catch (error) {
      el.diagram.innerHTML = `<pre class="placeholder">${escapeHtml(error instanceof Error ? error.message : String(error))}</pre>`;
      el.diagramMeta.textContent = "";
    }
  }

  /* ---------------------------------------------------------------- cards */

  function nodeName(id) {
    return app.blueprint?.state?.nodes?.find((node) => node.id === id)?.name ?? id;
  }

  function entityName(id) {
    return app.blueprint?.state?.entities?.find((entity) => entity.id === id)?.name ?? id;
  }

  function renderFilters() {
    const kinds = ["all", "service", "database", "queue", "external", "ui", "entity"];
    el.kindFilters.innerHTML = kinds
      .map(
        (kind) =>
          `<button type="button" data-kind="${kind}" aria-pressed="${app.kindFilter === kind}">${
            kind === "all" ? "all" : kind
          }</button>`,
      )
      .join("");
  }

  function renderCards() {
    const blueprint = app.blueprint;
    if (!blueprint?.state) return;
    const { nodes, entities, edges } = blueprint.state;
    const showNodes = app.kindFilter !== "entity";
    const showEntities = app.kindFilter === "all" || app.kindFilter === "entity";
    const html = [];

    if (showNodes) {
      for (const node of nodes) {
        if (app.kindFilter !== "all" && node.kind !== app.kindFilter) continue;
        const expanded = app.expandedNode === node.id;
        const links = edges
          .filter((edge) => edge.from === node.id || edge.to === node.id)
          .map((edge) => `${nodeName(edge.from)} → ${nodeName(edge.to)}`);
        const props = Object.entries(node.props ?? {});
        html.push(`
          <article class="node-card" data-node="${escapeHtml(node.id)}" role="button" tabindex="0" aria-expanded="${expanded}">
            <header>
              <span class="kind" aria-hidden="true">${KIND_ICON[node.kind] ?? "◆"}</span>
              <strong>${escapeHtml(node.name)}</strong>
            </header>
            <div class="meta">${escapeHtml(node.kind)}</div>
            ${
              props.length
                ? `<div class="props">${props
                    .map(([key, value]) => `<span>${escapeHtml(key)}=${escapeHtml(value)}</span>`)
                    .join("")}</div>`
                : ""
            }
            ${
              expanded && links.length
                ? `<div class="props">${links.map((link) => `<span>${escapeHtml(link)}</span>`).join("")}</div>`
                : ""
            }
          </article>`);
      }
    }

    if (showEntities) {
      for (const entity of entities) {
        const owner = entity.serviceId ? nodeName(entity.serviceId) : "";
        const active = app.selectedEntity === entity.id;
        html.push(`
          <article class="entity-card ${active ? "is-active" : ""}" data-entity="${escapeHtml(entity.id)}" role="button" tabindex="0">
            <header>
              <span class="kind" aria-hidden="true">◇</span>
              <strong>${escapeHtml(entity.name)}</strong>
            </header>
            <div class="meta">entity${owner ? ` · ${escapeHtml(owner)}` : ""}</div>
            <div class="fields">
              ${entity.fields
                .map(
                  (field) => `<div class="field-row">
                    <span>${escapeHtml(field.name)}${
                      field.primary ? ' <span class="pk">PK</span>' : field.required ? ' <span class="req">*</span>' : ""
                    }</span>
                    <em>${escapeHtml(field.type)}</em>
                  </div>`,
                )
                .join("")}
            </div>
            ${
              entity.relations?.length
                ? `<div class="rels">${entity.relations
                    .map((relation) => `→ ${escapeHtml(entityName(relation.target))}`)
                    .join(" ")}</div>`
                : ""
            }
          </article>`);
      }
    }

    el.cards.innerHTML = html.join("") || `<p class="empty">${escapeHtml(t("ui.selectFile", "Nothing yet."))}</p>`;
    el.entityMeta.textContent = `${nodes.length} components · ${entities.length} entities`;
  }

  /* ---------------------------------------------------------------- files */

  function currentFiles() {
    return app.blueprint?.files ?? {};
  }

  function languageOf(path) {
    const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    if (["json"].includes(extension)) return "json";
    if (["yaml", "yml"].includes(extension)) return "yaml";
    if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(extension)) return "js";
    if (extension === "prisma") return "prisma";
    if (["md", "mdx"].includes(extension)) return "md";
    if (["sql"].includes(extension)) return "sql";
    if (["sh", "bash"].includes(extension) || path.endsWith("Dockerfile")) return "sh";
    return "text";
  }

  const RULES = {
    json: [
      [/"(?:\\.|[^"\\])*"(?=\s*:)/y, "tok-key"],
      [/"(?:\\.|[^"\\])*"/y, "tok-str"],
      [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, "tok-num"],
      [/\b(?:true|false|null)\b/y, "tok-kw"],
    ],
    yaml: [
      [/#[^\n]*/y, "tok-com"],
      [/^\s*-\s/y, "tok-kw"],
      [/[A-Za-z_][\w.-]*(?=\s*:)/y, "tok-key"],
      [/"(?:\\.|[^"\\])*"|'[^']*'/y, "tok-str"],
      [/-?\d+(?:\.\d+)?/y, "tok-num"],
      [/\b(?:true|false|null)\b/y, "tok-kw"],
    ],
    js: [
      [/\/\/[^\n]*/y, "tok-com"],
      [/\/\*[\s\S]*?\*\//y, "tok-com"],
      [/`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y, "tok-str"],
      [
        /\b(?:import|export|from|const|let|var|function|return|if|else|for|while|try|catch|finally|throw|new|class|extends|implements|interface|type|enum|async|await|of|in|as|default|public|private|protected|readonly|static|null|undefined|true|false|this|super|typeof|instanceof|void|yield|switch|case|break|continue|delete)\b/y,
        "tok-kw",
      ],
      [/\b\d+(?:\.\d+)?\b/y, "tok-num"],
      [/[A-Za-z_$][\w$]*/y, "tok-prop"],
    ],
    prisma: [
      [/\/\/[^\n]*/y, "tok-com"],
      [/\b(?:model|enum|datasource|generator|type|view)\b/y, "tok-kw"],
      [/@[\w.]+/y, "tok-attr"],
      [/"(?:\\.|[^"\\])*"/y, "tok-str"],
      [/\b(?:String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes|Unsupported)\b/y, "tok-key"],
      [/\b\d+\b/y, "tok-num"],
    ],
    md: [
      [/^#{1,6} .*$/my, "tok-kw"],
      [/```[\s\S]*?```/y, "tok-str"],
      [/`[^`\n]*`/y, "tok-str"],
      [/\*\*[^*\n]+\*\*/y, "tok-key"],
      [/\[[^\]\n]*\]\([^)\n]*\)/y, "tok-attr"],
      [/^\s*[-*+] /my, "tok-attr"],
    ],
    sql: [
      [/--[^\n]*/y, "tok-com"],
      [/'(?:\\.|[^'\\])*'/y, "tok-str"],
      [
        /\b(?:SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|PRIMARY|KEY|FOREIGN|REFERENCES|JOIN|LEFT|RIGHT|INNER|GROUP|ORDER|BY|LIMIT|NOT|NULL|DEFAULT|UUID|TEXT|INTEGER|TIMESTAMP|BOOLEAN)\b/y,
        "tok-kw",
      ],
      [/\b\d+(?:\.\d+)?\b/y, "tok-num"],
    ],
    sh: [
      [/#[^\n]*/y, "tok-com"],
      [/"(?:\\.|[^"\\])*"|'[^']*'/y, "tok-str"],
      [/\b(?:FROM|RUN|CMD|COPY|ENV|WORKDIR|EXPOSE|ENTRYPOINT|ARG|USER|pnpm|npm|node|yarn|bun|cd|echo)\b/y, "tok-kw"],
      [/\b\d+(?:\.\d+)?\b/y, "tok-num"],
    ],
    text: [],
  };

  function highlight(code, language) {
    const rules = RULES[language] ?? [];
    if (rules.length === 0) return escapeHtml(code);
    let html = "";
    let index = 0;
    let plainStart = 0;
    const flush = (end) => {
      if (end > plainStart) html += escapeHtml(code.slice(plainStart, end));
    };
    while (index < code.length) {
      let matched = false;
      for (const [regex, cls] of rules) {
        regex.lastIndex = index;
        const match = regex.exec(code);
        if (!match || match[0].length === 0) continue;
        // `^`-anchored rules may only match at a line start; sticky already
        // pins the position, so honour the flag by checking the preceding char.
        if (regex.source.startsWith("^") && index > 0 && code[index - 1] !== "\n") continue;
        flush(index);
        html += `<span class="${cls}">${escapeHtml(match[0])}</span>`;
        index += match[0].length;
        plainStart = index;
        matched = true;
        break;
      }
      if (!matched) index += 1;
    }
    flush(code.length);
    return html;
  }

  function renderFileTree() {
    const files = Object.keys(currentFiles()).sort();
    el.fileMeta.textContent = `${files.length} files`;
    if (files.length === 0) {
      el.fileTree.innerHTML = `<p class="empty">${escapeHtml(t("ui.selectFile", "No files yet."))}</p>`;
      return;
    }
    const groups = new Map();
    for (const path of files) {
      const slash = path.lastIndexOf("/");
      const dir = slash === -1 ? "." : path.slice(0, slash);
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir).push(path);
    }
    const html = [];
    for (const [dir, paths] of groups) {
      html.push(`<div class="dir">${escapeHtml(dir)}</div>`);
      for (const path of paths) {
        const label = dir === "." ? path : path.slice(dir.length + 1);
        html.push(
          `<button type="button" data-file="${escapeHtml(path)}" aria-current="${
            app.activeFile === path
          }" title="${escapeHtml(path)}">${escapeHtml(label)}</button>`,
        );
      }
    }
    el.fileTree.innerHTML = html.join("");
  }

  function openFile(path) {
    const content = currentFiles()[path];
    if (content === undefined) return;
    app.activeFile = path;
    el.filePath.textContent = path;
    el.selectFile.classList.add("hidden");
    el.fileView.classList.remove("hidden");
    el.fileView.innerHTML = `<code>${highlight(content, languageOf(path))}</code>`;
    renderFileTree();
  }

  /* ----------------------------------------------------------- tasks/metrics */

  function renderTasks() {
    const tasks = app.blueprint?.tasks ?? [];
    el.taskRows.innerHTML =
      tasks
        .map(
          (task) => `<tr>
            <td class="mono">${escapeHtml(task.id)}</td>
            <td class="wrap">${escapeHtml(task.title)}</td>
            <td class="mono">${escapeHtml(task.wave)}</td>
            <td class="mono">${task.files?.length ?? 0}</td>
            <td class="mono">${task.tokens ?? "—"}</td>
            <td class="mono">${escapeHtml((task.dependsOn ?? []).join(", ") || "—")}</td>
          </tr>`,
        )
        .join("") || `<tr><td colspan="6">${escapeHtml(t("ui.selectFile", "Nothing yet."))}</td></tr>`;
  }

  function renderMetrics() {
    const metrics = app.blueprint?.metrics ?? [];
    el.metricRows.innerHTML =
      metrics
        .map(
          (metric) => `<tr>
            <td class="mono">${escapeHtml(metric.name)}</td>
            <td class="mono">${escapeHtml(metric.value)}</td>
            <td class="mono">${escapeHtml(metric.target)}</td>
            <td class="${metric.pass ? "pass" : "fail"}">${
              metric.pass ? escapeHtml(t("common.passed", "passed")) : escapeHtml(t("common.failed", "failed"))
            }</td>
          </tr>`,
        )
        .join("") || `<tr><td colspan="4">${escapeHtml(t("ui.selectFile", "Nothing yet."))}</td></tr>`;

    const issues = app.blueprint?.validation?.issues ?? [];
    el.validationList.classList.toggle("hidden", issues.length === 0);
    el.validationList.innerHTML = issues
      .map((issue) => `<div><strong>${escapeHtml(issue.file)}</strong> — ${escapeHtml(issue.message)}</div>`)
      .join("");
  }

  /* --------------------------------------------------------------- chat UI */

  function renderQuickPrompts() {
    const prompts = QUICK_PROMPTS[app.locale] ?? QUICK_PROMPTS.en;
    el.quick.innerHTML = prompts
      .map((prompt) => `<button type="button" data-prompt="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`)
      .join("");
  }

  function renderChat() {
    if (app.chat.length === 0) {
      el.chatLog.innerHTML = `<p class="hint">${escapeHtml(t("ui.chatEmpty", ""))}</p>`;
      return;
    }
    el.chatLog.innerHTML = app.chat
      .map((message) => {
        if (message.role === "working") {
          return `<div class="bubble agent"><span class="typing"><i></i><i></i><i></i></span> ${escapeHtml(
            t("ui.chatWorking", "Working…"),
          )}</div>`;
        }
        const changes = (message.changes ?? [])
          .slice(0, 8)
          .map(
            (change) =>
              `<span class="delta ${change.action}">${escapeHtml(change.action)} ${escapeHtml(change.target)}</span>`,
          )
          .join("");
        return `<div class="bubble ${message.role}${message.error ? " error" : ""}">${escapeHtml(message.text)}${
          changes ? `<div class="changes">${changes}</div>` : ""
        }</div>`;
      })
      .join("");
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
  }

  function pushMessage(message) {
    app.chat.push(message);
    renderChat();
  }

  /* --------------------------------------------------------- apply blueprint */

  function applyBlueprint(payload) {
    app.blueprint = payload;
    app.activeFile = null;
    el.filePath.textContent = "";
    el.fileView.classList.add("hidden");
    el.selectFile.classList.remove("hidden");
    renderChips();
    renderCards();
    renderFileTree();
    renderTasks();
    renderMetrics();
    renderDiagram(payload.diagram);
    if (document.activeElement !== el.stateJson && payload.state) {
      el.stateJson.value = JSON.stringify(payload.state, null, 2);
    }
  }

  async function previewFromIdea() {
    setBusy(true);
    setStatus(el.status, t("ui.chatWorking", "Working…"));
    try {
      const payload = await api("/api/preview", { idea: el.idea.value.trim(), ...llmPayload() });
      applyBlueprint(payload);
      setStatus(el.status, `${payload.summary.nodes} components · validation ${payload.validation.ok ? "ok" : "failed"}`, "ok");
    } catch (error) {
      setStatus(el.status, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function previewFromState(state) {
    const payload = await api("/api/preview", { state, ...llmPayload() });
    applyBlueprint(payload);
    return payload;
  }

  async function sendChat(text) {
    const message = text.trim();
    if (!message) return;
    if (!app.blueprint?.state) {
      toast(t("ui.chatEmpty", "Generate a blueprint first."));
      return;
    }
    pushMessage({ role: "user", text: message });
    app.chat.push({ role: "working" });
    renderChat();
    setBusy(true);
    el.chatSource.textContent = "";
    try {
      const payload = await api("/api/chat", { state: app.blueprint.state, message, ...llmPayload() });
      app.chat.pop();
      applyBlueprint(payload);
      pushMessage({
        role: "agent",
        text: payload.chat.reply,
        changes: payload.chat.changes,
      });
      el.chatSource.textContent = payload.chat.source;
      if (payload.chat.notes?.length) console.info("chat notes", payload.chat.notes);
    } catch (error) {
      app.chat.pop();
      pushMessage({ role: "agent", text: error.message, error: true });
    } finally {
      el.chatInput.value = "";
      setBusy(false);
      el.chatInput.focus();
    }
  }

  function setBusy(busy) {
    app.busy = busy;
    el.sendBtn.disabled = busy;
    el.previewBtn.disabled = busy;
    el.generateBtn.disabled = busy;
    el.analyzeBtn.disabled = busy;
  }

  /* ------------------------------------------------------------- actions */

  async function generate() {
    setBusy(true);
    setStatus(el.status, t("ui.chatWorking", "Working…"));
    try {
      const state = app.blueprint?.state;
      const body = state ? { state, ...llmPayload() } : { idea: el.idea.value.trim(), ...llmPayload() };
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "agent-package.zip";
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus(el.status, `ZIP · ${(blob.size / 1024).toFixed(1)} KiB`, "ok");
    } catch (error) {
      setStatus(el.status, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function analyse() {
    const path = el.repoPath.value.trim();
    if (!path) {
      setStatus(el.analysisStatus, t("error.invalidPath", "Path required").replace("{path}", path), "error");
      return;
    }
    setBusy(true);
    setStatus(el.analysisStatus, t("ui.chatWorking", "Working…"));
    try {
      const reversed = await api("/api/reverse", {
        path,
        useRea: el.useRea.checked,
        maxFiles: 4000,
      });
      const payload = await previewFromState(reversed.state);
      setStatus(
        el.analysisStatus,
        `${reversed.summary}${reversed.rea ? ` · REA ${reversed.rea.engine}` : ""}`,
        "ok",
      );
      app.chat.pop();
      renderChat();
      pushMessage({
        role: "agent",
        text: reversed.rea
          ? `${reversed.summary} — REA ${reversed.rea.engine} contributed ${reversed.rea.findings.length} findings from ${reversed.rea.scannedArtifacts} artifacts.`
          : reversed.summary,
        changes: [
          { action: "added", target: `${reversed.state.nodes.length} components` },
          { action: "added", target: `${payload.state.entities.length} entities` },
        ],
      });
    } catch (error) {
      setStatus(el.analysisStatus, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function verifySandbox() {
    if (!app.blueprint?.state) return;
    setStatus(el.status, t("ui.chatWorking", "Working…"));
    try {
      const payload = await api("/api/sandbox", { state: app.blueprint.state, sandbox: "auto", ...llmPayload() });
      const run = payload.sandbox ?? payload;
      setStatus(
        el.status,
        `${run.driver ?? "sandbox"} (${run.isolation ?? "?"}) exit=${run.exitCode ?? "?"}`,
        run.exitCode === 0 ? "ok" : "error",
      );
    } catch (error) {
      setStatus(el.status, error.message, "error");
    }
  }

  /* ---------------------------------------------------------------- events */

  function wire() {
    el.themeBtn.addEventListener("click", () => {
      applyTheme(document.body.dataset.theme === "light" ? "dark" : "light");
    });

    el.locale.addEventListener("change", () => loadLocale(el.locale.value).catch((error) => toast(error.message)));

    el.chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!app.busy) sendChat(el.chatInput.value);
    });

    el.chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (!app.busy) sendChat(el.chatInput.value);
      }
    });

    el.quick.addEventListener("click", (event) => {
      const button = event.target.closest("[data-prompt]");
      if (button && !app.busy) sendChat(button.dataset.prompt);
    });

    el.cards.addEventListener("click", (event) => {
      const node = event.target.closest("[data-node]");
      if (node) {
        app.expandedNode = app.expandedNode === node.dataset.node ? null : node.dataset.node;
        renderCards();
        return;
      }
      const entity = event.target.closest("[data-entity]");
      if (entity) {
        app.selectedEntity = app.selectedEntity === entity.dataset.entity ? null : entity.dataset.entity;
        renderCards();
      }
    });

    el.cards.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = event.target.closest("[data-node],[data-entity]");
      if (card) {
        event.preventDefault();
        card.click();
      }
    });

    el.kindFilters.addEventListener("click", (event) => {
      const button = event.target.closest("[data-kind]");
      if (!button) return;
      app.kindFilter = button.dataset.kind;
      renderFilters();
      renderCards();
    });

    el.fileTree.addEventListener("click", (event) => {
      const button = event.target.closest("[data-file]");
      if (button) openFile(button.dataset.file);
    });

    el.copyBtn.addEventListener("click", async () => {
      if (!app.activeFile) return;
      try {
        await navigator.clipboard.writeText(el.fileView.textContent ?? "");
        toast("Copied");
      } catch {
        toast("Clipboard unavailable");
      }
    });

    el.previewBtn.addEventListener("click", previewFromIdea);
    el.generateBtn.addEventListener("click", generate);
    el.downloadBtn.addEventListener("click", generate);
    el.analyzeBtn.addEventListener("click", analyse);
    el.sandboxBtn.addEventListener("click", verifySandbox);

    el.applyStateBtn.addEventListener("click", async () => {
      try {
        const state = JSON.parse(el.stateJson.value);
        await previewFromState(state);
        toast("State applied");
      } catch (error) {
        setStatus(el.status, error.message, "error");
      }
    });

    for (const tab of document.querySelectorAll(".tab")) {
      tab.addEventListener("click", () => {
        for (const other of document.querySelectorAll(".tab")) other.setAttribute("aria-selected", String(other === tab));
        for (const panel of document.querySelectorAll("[data-panel]")) {
          panel.classList.toggle("hidden", panel.dataset.panel !== tab.dataset.tab);
        }
      });
    }
  }

  /* ------------------------------------------------------------------ boot */

  async function boot() {
    applyTheme(localStorage.getItem("as.theme") === "light" ? "light" : "dark");
    renderFilters();
    wire();

    try {
      const [version, sandboxes, rea] = await Promise.all([
        api("/api/version"),
        api("/api/sandboxes").catch(() => ({ sandboxes: [] })),
        api("/api/rea").catch(() => ({ detection: null })),
      ]);
      app.version = version.version;
      app.sandboxes = sandboxes.sandboxes ?? [];
      app.rea = rea.detection;
      renderBadges();
      const preferred = localStorage.getItem("as.locale") ?? navigator.language?.slice(0, 2) ?? "en";
      await loadLocale(version.locales.some((item) => item.id === preferred) ? preferred : version.locales[0].id);
    } catch (error) {
      console.error(error);
    }

    el.idea.value = DEFAULT_IDEA;
    renderQuickPrompts();
    await previewFromIdea();

    const path = new URLSearchParams(location.search).get("path");
    if (path) {
      el.repoPath.value = path;
      await analyse();
    }
  }

  boot();
})();
