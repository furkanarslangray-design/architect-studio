(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const FALLBACK_LOCALES = [
    ["tr", "Türkçe"],
    ["en", "English"],
    ["de", "Deutsch"],
    ["es", "Español"],
    ["fr", "Français"],
    ["pt", "Português"],
    ["ja", "日本語"],
    ["zh", "中文"],
  ];

  const els = {
    locale: $("#locale"),
    idea: $("#idea"),
    stateJson: $("#stateJson"),
    stateSection: $("#stateSection"),
    packageManager: $("#packageManager"),
    testRunner: $("#testRunner"),
    sandbox: $("#sandbox"),
    webSearch: $("#webSearch"),
    repoPath: $("#repoPath"),
    analyzeBtn: $("#analyzeBtn"),
    analysisStatus: $("#analysisStatus"),
    sandboxBtn: $("#sandboxBtn"),
    sandboxStatus: $("#sandboxStatus"),
    demo: $("#demo"),
    apiKey: $("#apiKey"),
    model: $("#model"),
    baseUrl: $("#baseUrl"),
    previewBtn: $("#previewBtn"),
    generateBtn: $("#generateBtn"),
    downloadBtn: $("#downloadBtn"),
    editStateBtn: $("#editStateBtn"),
    status: $("#status"),
    preview: $("#preview"),
    chips: $("#chips"),
    diagram: $("#diagram"),
    fileTree: $("#fileTree"),
    filePath: $("#filePath"),
    fileSize: $("#fileSize"),
    fileView: $("#fileView"),
    selectFile: $("#selectFile"),
    taskRows: $("#taskRows"),
    metricRows: $("#metricRows"),
    validationList: $("#validationList"),
  };

  let locale = localStorage.getItem("architect.locale") || (navigator.language || "en").slice(0, 2).toLowerCase();
  let messages = {};
  let payload = null;
  let busy = false;
  let diagramToken = 0;
  let activeFile = null;
  let sandboxes = [];
  let originalButtonLabels = { preview: "", generate: "" };

  function t(key, vars = {}) {
    const template = messages[key] || key;
    return template.replace(/\{(\w+)\}/g, (_match, name) => (vars[name] === undefined ? `{${name}}` : String(vars[name])));
  }

  function setStatus(text, kind = "") {
    els.status.className = "status" + (kind ? ` ${kind}` : "");
    els.status.textContent = "";
    if (kind === "loading") {
      const spinner = document.createElement("span");
      spinner.className = "spinner";
      els.status.append(spinner);
    }
    els.status.append(document.createTextNode(text));
  }

  function fillLocaleSelect(locales) {
    const current = locale;
    els.locale.textContent = "";
    for (const item of locales) {
      const option = document.createElement("option");
      if (Array.isArray(item)) {
        option.value = item[0];
        option.textContent = item[1];
      } else {
        option.value = item.id;
        option.textContent = item.label;
      }
      els.locale.append(option);
    }
    els.locale.value = current;
  }

  function applyI18n() {
    document.documentElement.lang = locale;
    for (const node of $$("[data-i18n]")) {
      const key = node.getAttribute("data-i18n");
      if (key) node.textContent = t(key);
    }
    for (const node of $$("[data-i18n-placeholder]")) {
      const key = node.getAttribute("data-i18n-placeholder");
      if (key) node.setAttribute("placeholder", t(key));
    }
    originalButtonLabels = {
      preview: t("ui.preview"),
      generate: t("ui.generate"),
    };
    if (!busy) {
      els.previewBtn.textContent = originalButtonLabels.preview;
      els.generateBtn.textContent = originalButtonLabels.generate;
    }
  }

  async function loadLocale(next) {
    const response = await fetch(`/api/i18n?locale=${encodeURIComponent(next)}`, {
      headers: { "Accept-Language": next },
    });
    if (!response.ok) throw new Error(`Locale request failed (${response.status})`);
    const data = await response.json();
    locale = data.locale;
    messages = data.messages || {};
    fillLocaleSelect(data.locales || FALLBACK_LOCALES);
    applyI18n();
    localStorage.setItem("architect.locale", locale);
    if (payload) renderPreview(payload);
  }

  function setBusy(next, message) {
    busy = next;
    els.previewBtn.disabled = next;
    els.generateBtn.disabled = next;
    els.downloadBtn.disabled = next;
    if (next) {
      setStatus(message, "loading");
    } else {
      els.previewBtn.textContent = originalButtonLabels.preview || t("ui.preview");
      els.generateBtn.textContent = originalButtonLabels.generate || t("ui.generate");
    }
  }

  function buildBody() {
    const body = {
      locale,
      demo: els.demo.checked,
      packageManager: els.packageManager.value,
      testRunner: els.testRunner.value,
      sandbox: els.sandbox.value || "auto",
      webSearch: els.webSearch.checked,
    };
    if (!els.demo.checked) {
      if (els.apiKey.value.trim()) body.apiKey = els.apiKey.value.trim();
      if (els.baseUrl.value.trim()) body.baseUrl = els.baseUrl.value.trim();
      if (els.model.value.trim()) body.model = els.model.value.trim();
    }

    const rawState = els.stateJson.value.trim();
    if (rawState) {
      try {
        body.state = JSON.parse(rawState);
      } catch {
        throw new Error(t("ui.invalidStateJson"));
      }
      return body;
    }

    const idea = els.idea.value.trim();
    if (!idea) throw new Error(t("ui.shortIdea"));
    body.idea = idea;
    return body;
  }

  async function requestJson(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": locale },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let message = t("ui.unexpectedError");
      try {
        const data = await response.json();
        if (data && typeof data.error === "string") message = data.error;
      } catch {
        /* keep the generic message */
      }
      throw new Error(message);
    }
    return response.json();
  }

  async function preview() {
    if (busy) return;
    let body;
    try {
      body = buildBody();
    } catch (error) {
      setStatus(error.message, "error");
      return;
    }
    setBusy(true, t("ui.previewLoading"));
    try {
      const data = await requestJson("/api/preview", body);
      payload = data;
      renderPreview(data);
      els.preview.classList.remove("hidden");
      setStatus(t("ui.previewReady"), "ok");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (busy) return;
    let body;
    try {
      body = buildBody();
    } catch (error) {
      setStatus(error.message, "error");
      return;
    }
    setBusy(true, t("ui.packageBuilding"));
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept-Language": locale },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        let message = t("ui.unexpectedError");
        try {
          const data = await response.json();
          if (data && typeof data.error === "string") message = data.error;
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "agent-package.zip";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setStatus(t("ui.packageReady"), "ok");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function chip(label, value, kind = "") {
    const node = document.createElement("span");
    node.className = "chip" + (kind ? ` ${kind}` : "");
    const text = document.createElement("span");
    text.textContent = label;
    const strong = document.createElement("b");
    strong.textContent = String(value);
    node.append(text, strong);
    return node;
  }

  function renderPreview(data) {
    const summary = data.summary || {};
    els.chips.textContent = "";
    els.chips.append(
      chip(t("ui.chipComponents"), summary.nodes ?? 0),
      chip(t("ui.chipEdges"), summary.edges ?? 0),
      chip(t("ui.chipEntities"), summary.entities ?? 0),
      chip(t("ui.chipTasks"), summary.tasks ?? 0),
      chip(t("ui.chipWaves"), summary.waves ?? 0),
      chip(t("ui.chipChecks"), data.validation ? data.validation.checksRun : 0),
      chip(
        t("ui.chipValidation"),
        data.validation && data.validation.ok ? t("common.passed") : t("common.failed"),
        data.validation && data.validation.ok ? "good" : "bad",
      ),
    );
    renderDiagram(data.diagram || "");
    renderFiles(data.files || {});
    renderTasks(data.tasks || []);
    renderMetrics(data.metrics || [], data.validation);
  }

  async function renderDiagram(source) {
    const token = ++diagramToken;
    els.diagram.textContent = "";
    if (!source) return;
    if (window.mermaid) {
      try {
        window.mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
          fontFamily: "Segoe UI, system-ui, sans-serif",
          themeVariables: {
            primaryColor: "#1b2436",
            primaryTextColor: "#e6ecf7",
            primaryBorderColor: "#6ee7f2",
            lineColor: "#8b9dff",
            secondaryColor: "#111827",
            tertiaryColor: "#0b1120",
          },
        });
        const rendered = await window.mermaid.render(`architect-diagram-${token}`, source);
        if (token !== diagramToken) return;
        els.diagram.innerHTML = rendered.svg;
        return;
      } catch {
        /* fall back to the source below */
      }
    }
    if (token !== diagramToken) return;
    const pre = document.createElement("pre");
    pre.textContent = source;
    els.diagram.append(pre);
  }

  function buildTree(paths) {
    const root = { dirs: new Map(), files: [] };
    for (const path of paths) {
      const parts = path.split("/");
      let node = root;
      for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index];
        if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
        node = node.dirs.get(part);
      }
      node.files.push({ name: parts[parts.length - 1], path });
    }
    return root;
  }

  function renderTree(node, container, files) {
    const list = document.createElement("ul");
    for (const [name, child] of Array.from(node.dirs.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const item = document.createElement("li");
      const details = document.createElement("details");
      details.open = true;
      const summary = document.createElement("summary");
      summary.textContent = name;
      details.append(summary);
      renderTree(child, details, files);
      item.append(details);
      list.append(item);
    }
    for (const file of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "file";
      button.textContent = file.name;
      button.dataset.path = file.path;
      button.addEventListener("click", () => selectFile(file.path, files));
      item.append(button);
      list.append(item);
    }
    container.append(list);
  }

  function renderFiles(files) {
    const paths = Object.keys(files).sort();
    els.fileTree.textContent = "";
    if (paths.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = t("ui.treeEmpty");
      els.fileTree.append(empty);
      return;
    }
    renderTree(buildTree(paths), els.fileTree, files);
    const preferred = paths.includes("ARCHITECTURE.md") ? "ARCHITECTURE.md" : paths[0];
    selectFile(preferred, files);
  }

  function selectFile(path, files) {
    activeFile = path;
    for (const button of $$("#fileTree button.file")) {
      button.classList.toggle("active", button.dataset.path === path);
    }
    const content = files[path] ?? "";
    els.filePath.textContent = path;
    const bytes = new TextEncoder().encode(content).length;
    els.fileSize.textContent = bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
    els.selectFile.classList.add("hidden");
    els.fileView.classList.remove("hidden");
    els.fileView.textContent = content;
  }

  function renderTasks(tasks) {
    els.taskRows.textContent = "";
    for (const task of tasks) {
      const row = document.createElement("tr");
      const cells = [
        [task.id, "mono"],
        [task.title, ""],
        [task.wave, "mono"],
        [task.files ? task.files.length : 0, ""],
        [task.tokens, ""],
        [task.dependsOn && task.dependsOn.length ? task.dependsOn.join(", ") : "—", "mono"],
      ];
      for (const [value, className] of cells) {
        const cell = document.createElement("td");
        if (className) cell.className = className;
        cell.textContent = String(value);
        row.append(cell);
      }
      els.taskRows.append(row);
    }
  }

  function renderMetrics(metrics, validation) {
    els.metricRows.textContent = "";
    for (const metric of metrics) {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      name.className = "mono";
      name.textContent = metric.name;
      const value = document.createElement("td");
      value.textContent = String(metric.value);
      const target = document.createElement("td");
      target.className = "mono";
      target.textContent = metric.target;
      const status = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `badge ${metric.pass ? "good" : "bad"}`;
      badge.textContent = metric.pass ? t("common.passed") : t("common.failed");
      status.append(badge);
      row.append(name, value, target, status);
      els.metricRows.append(row);
    }

    els.validationList.textContent = "";
    const issues = validation && validation.issues ? validation.issues : [];
    if (issues.length === 0) {
      els.validationList.classList.add("hidden");
      return;
    }
    els.validationList.classList.remove("hidden");
    const heading = document.createElement("strong");
    heading.textContent = t("ui.chipValidation");
    const list = document.createElement("ul");
    for (const issue of issues) {
      const item = document.createElement("li");
      item.textContent = `${issue.file}: ${issue.message}`;
      list.append(item);
    }
    els.validationList.append(heading, list);
  }

  function setAnalysisStatus(text, kind = "") {
    els.analysisStatus.className = "status" + (kind ? ` ${kind}` : "");
    els.analysisStatus.textContent = text;
  }

  async function analyzeProject() {
    if (busy) return;
    const path = els.repoPath.value.trim();
    if (!path) {
      setAnalysisStatus(t("ui.repoPath"), "error");
      els.repoPath.focus();
      return;
    }
    els.analyzeBtn.disabled = true;
    setAnalysisStatus(t("ui.analyzing"), "loading");
    try {
      const data = await requestJson("/api/reverse", { path });
      els.stateJson.value = JSON.stringify(data.state, null, 2);
      els.stateSection.open = true;
      const summary = t("ui.reverseSummary", {
        nodes: data.state.nodes.length,
        entities: data.state.entities.length,
        decisions: data.state.decisions.length,
      });
      setAnalysisStatus(`${summary} ${t("ui.analysisDone")}`, "ok");
      await preview();
    } catch (error) {
      setAnalysisStatus(error.message, "error");
    } finally {
      els.analyzeBtn.disabled = false;
    }
  }

  async function verifyInSandbox() {
    if (busy) return;
    let body;
    try {
      body = buildBody();
    } catch (error) {
      setStatus(error.message, "error");
      return;
    }
    els.sandboxBtn.disabled = true;
    els.sandboxStatus.classList.remove("hidden");
    els.sandboxStatus.className = "status loading";
    els.sandboxStatus.textContent = t("ui.sandboxHint");
    try {
      const data = await requestJson("/api/sandbox", body);
      const ok = data.exitCode === 0;
      els.sandboxStatus.className = `status ${ok ? "ok" : "error"}`;
      els.sandboxStatus.textContent = ok
        ? t("ui.sandboxOk", { driver: data.driver })
        : `${data.driver}: exit ${data.exitCode}${data.stderr ? ` — ${data.stderr.split("\n")[0]}` : ""}`;
    } catch (error) {
      els.sandboxStatus.className = "status error";
      els.sandboxStatus.textContent = error.message;
    } finally {
      els.sandboxBtn.disabled = false;
    }
  }

  function fillSandboxes(items) {
    sandboxes = Array.isArray(items) ? items : [];
    const selected = els.sandbox.value || "auto";
    els.sandbox.textContent = "";
    const auto = document.createElement("option");
    auto.value = "auto";
    auto.textContent = t("ui.sandboxAuto");
    els.sandbox.append(auto);
    for (const item of sandboxes) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.available ? item.label : `${item.label} — ${item.reason || "unavailable"}`;
      els.sandbox.append(option);
    }
    els.sandbox.value = sandboxes.some((item) => item.id === selected) || selected === "auto" ? selected : "auto";
  }

  async function loadSandboxes() {
    try {
      const response = await fetch("/api/sandboxes", { headers: { "Accept-Language": locale } });
      if (!response.ok) return;
      const data = await response.json();
      fillSandboxes(data.sandboxes);
    } catch {
      /* detection is optional for the UI */
    }
  }

  function switchTab(tab) {
    for (const button of $$(".tab")) {
      button.setAttribute("aria-selected", String(button.dataset.tab === tab));
    }
    for (const panel of $$("[data-panel]")) {
      panel.classList.toggle("hidden", panel.dataset.panel !== tab);
    }
    if (tab === "diagram" && payload) renderDiagram(payload.diagram || "");
  }

  function updateDemoUi() {
    const demo = els.demo.checked;
    els.apiKey.disabled = demo;
    els.model.disabled = demo;
    els.baseUrl.disabled = demo;
  }

  async function init() {
    fillLocaleSelect(FALLBACK_LOCALES);
    els.locale.value = locale;

    els.previewBtn.addEventListener("click", preview);
    els.generateBtn.addEventListener("click", generate);
    els.downloadBtn.addEventListener("click", generate);
    els.analyzeBtn.addEventListener("click", analyzeProject);
    els.sandboxBtn.addEventListener("click", verifyInSandbox);
    els.demo.addEventListener("change", updateDemoUi);
    els.locale.addEventListener("change", async () => {
      try {
        await loadLocale(els.locale.value);
        fillSandboxes(sandboxes);
      } catch (error) {
        setStatus(error.message, "error");
      }
    });

    els.editStateBtn.addEventListener("click", () => {
      if (!payload) return;
      els.stateJson.value = JSON.stringify(payload.state, null, 2);
      els.stateSection.open = true;
      els.stateSection.scrollIntoView({ behavior: "smooth", block: "center" });
      els.stateJson.focus();
      setStatus(t("ui.editStateHint"));
    });

    for (const button of $$(".tab")) {
      button.addEventListener("click", () => switchTab(button.dataset.tab));
    }

    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        preview();
      }
    });

    updateDemoUi();
    try {
      await loadLocale(locale);
    } catch (error) {
      applyI18n();
      setStatus(error.message, "error");
    }
    await loadSandboxes();
  }

  init();
})();
