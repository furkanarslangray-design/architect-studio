/* Architect Studio client — vanilla JS, no build step, CSP-safe (same origin only). */
(() => {
  "use strict";

  const state = {
    locale: "en",
    messages: {},
    result: null,
    diagram: "",
    files: {},
    selectedFile: null,
    apiKey: "",
    busy: false,
    reverseJob: null,
  };

  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };

  /* ---------- i18n ---------- */

  function t(key, fallback) {
    return state.messages[key] ?? fallback ?? key;
  }

  function applyTranslations() {
    for (const node of document.querySelectorAll("[data-i18n]")) {
      const value = state.messages[node.dataset.i18n];
      if (value) node.textContent = value;
    }
    for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
      const value = state.messages[node.dataset.i18nPlaceholder];
      if (value) node.placeholder = value;
    }
    for (const node of document.querySelectorAll("[data-i18n-title]")) {
      const value = state.messages[node.dataset.i18nTitle];
      if (value) node.title = value;
    }
  }

  async function loadMessages(locale) {
    try {
      const response = await fetch(`/api/i18n?locale=${encodeURIComponent(locale)}`);
      if (!response.ok) return;
      const payload = await response.json();
      state.messages = payload.messages ?? {};
      applyTranslations();
      document.documentElement.lang = payload.locale ?? locale;
    } catch {
      /* The English markup is the fallback. */
    }
  }

  /* ---------- Transport ---------- */

  class ApiError extends Error {
    constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  async function api(path, body, timeoutMs = 60_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        let payload = {};
        try {
          payload = await response.json();
        } catch {
          /* non-JSON error */
        }
        throw new ApiError(response.status, payload.code ?? "error", payload.error ?? `HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error.name === "AbortError") throw new ApiError(0, "timeout", "Request timed out.");
      throw new ApiError(0, "network", "Could not reach the server — check the connection.");
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------- Notifications ---------- */

  function toast(message, tone = "info") {
    const host = $("toast-host");
    const node = el("div", `toast ${tone}`, message);
    host.append(node);
    while (host.children.length > 3) host.firstElementChild.remove();
    setTimeout(() => node.remove(), 5000);
  }

  function alertBar(message) {
    const host = $("alert-host");
    const node = el("div", "alert");
    node.append(el("p", "", message));
    const close = el("button", "button ghost", "Dismiss");
    close.type = "button";
    close.addEventListener("click", () => node.remove());
    node.append(close);
    host.append(node);
  }

  function clearAlerts() {
    $("alert-host").replaceChildren();
  }

  /* ---------- Request payload ---------- */

  function payload(extra = {}, includeState = true) {
    const body = {
      demo: $("demo-toggle").checked,
      ...extra,
    };
    const locale = $("locale-select").value;
    if (locale) body.locale = locale;
    if (state.apiKey) body.apiKey = state.apiKey;
    if (state.apiKey) {
      body.baseUrl = $("base-url").value.trim();
      body.model = $("model").value.trim();
    }
    body.packageManager = $("package-manager").value;
    body.testRunner = $("test-runner").value;
    if (includeState && state.result) body.state = state.result.state;
    return body;
  }

  function setBusy(busy, label) {
    state.busy = busy;
    for (const button of document.querySelectorAll("#preview-btn, #composer-generate-btn, #chat-send, #download-btn")) {
      button.disabled = busy;
    }
    if (label) $("composer-error").textContent = "";
    document.querySelectorAll("textarea, input, select").forEach((field) => {
      if (busy) field.setAttribute("aria-disabled", "true");
      else field.removeAttribute("aria-disabled");
    });
  }

  /* ---------- Rendering ---------- */

  function render(result) {
    state.result = result;
    state.diagram = result.diagram ?? "";
    state.files = result.files ?? {};
    renderDiagram();
    renderSummary(result);
    renderEntities(result.state);
    renderDecisions(result.state);
    renderTasks(result.tasks ?? []);
    renderMetrics(result.metrics ?? []);
    renderValidation(result.validation);
    renderArtifacts();
    if (result.stateWarnings?.length) {
      for (const warning of result.stateWarnings) toast(warning, "warning");
    }
    if (result.chat?.changes?.length) renderChanges(result.chat.changes);
  }

  function renderDiagram() {
    const target = $("diagram");
    const fallback = $("diagram-fallback");
    const empty = $("diagram-empty");
    target.replaceChildren();
    fallback.hidden = true;
    if (!state.diagram) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    const mermaid = window.mermaid;
    if (!mermaid || typeof mermaid.render !== "function") {
      fallback.textContent = state.diagram;
      fallback.hidden = false;
      return;
    }
    target.setAttribute("aria-busy", "true");
    const id = `diagram-${Date.now()}`;
    Promise.resolve(mermaid.render(id, state.diagram))
      .then(({ svg }) => {
        target.innerHTML = svg;
        const svgNode = target.querySelector("svg");
        if (svgNode) {
          svgNode.setAttribute("role", "img");
          svgNode.setAttribute("aria-label", diagramSummary());
          svgNode.style.maxWidth = "100%";
          svgNode.style.height = "auto";
        }
      })
      .catch(() => {
        fallback.textContent = state.diagram;
        fallback.hidden = false;
      })
      .finally(() => target.removeAttribute("aria-busy"));
  }

  function diagramSummary() {
    const state_ = state.result?.state;
    if (!state_) return "Architecture diagram";
    const kinds = { service: 0, database: 0, queue: 0, external: 0, ui: 0 };
    for (const node of state_.nodes) kinds[node.kind] = (kinds[node.kind] ?? 0) + 1;
    return `Architecture diagram: ${state_.nodes.length} components (${Object.entries(kinds)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => `${count} ${kind}`)
      .join(", ")}), ${state_.edges.length} connections.`;
  }

  function renderSummary(result) {
    const summary = result.summary ?? {};
    const list = $("summary-chips");
    list.replaceChildren();
    const chips = [
      [t("ui.chipComponents", "Components"), summary.nodes],
      [t("ui.chipEdges", "Edges"), summary.edges],
      [t("ui.chipEntities", "Entities"), summary.entities],
      [t("ui.chipTasks", "Tasks"), summary.tasks],
      [t("ui.chipWaves", "Waves"), summary.waves],
      [t("ui.chipChecks", "Checks"), result.validation?.checksRun],
    ];
    for (const [label, value] of chips) {
      if (value === undefined) continue;
      const item = el("li");
      item.append(el("strong", "", value), document.createTextNode(` ${label}`));
      list.append(item);
    }
  }

  function renderEntities(archState) {
    const host = $("entities-table");
    host.replaceChildren();
    if (!archState || archState.entities.length === 0) {
      host.append(el("p", "empty", "No domain entities were declared."));
      return;
    }
    for (const entity of archState.entities) {
      const block = el("div", "entity");
      block.append(el("h3", "", entity.name));
      const meta = el(
        "p",
        "meta",
        [entity.serviceId ? `service: ${entity.serviceId}` : null, entity.databaseId ? `db: ${entity.databaseId}` : null]
          .filter(Boolean)
          .join(" · ") || "no ownership",
      );
      block.append(meta);
      const table = el("table", "table");
      const head = el("thead");
      const headRow = el("tr");
      for (const label of ["Field", "Type", "Flags"]) headRow.append(el("th", "", label));
      head.append(headRow);
      const body = el("tbody");
      for (const field of entity.fields) {
        const row = el("tr");
        const name = el("td", "", field.name);
        name.dataset.label = "Field";
        const type = el("td", "meta", field.type);
        type.dataset.label = "Type";
        const flags = el("td");
        flags.dataset.label = "Flags";
        if (field.primary) flags.append(el("span", "tag primary", "primary"));
        if (field.required) flags.append(el("span", "tag required", "required"));
        if (field.unique) flags.append(el("span", "tag", "unique"));
        row.append(name, type, flags);
        body.append(row);
      }
      table.append(head, body);
      block.append(table);
      if (entity.relations?.length) {
        block.append(
          el("p", "meta", `relations: ${entity.relations.map((relation) => relation.target).join(", ")}`),
        );
      }
      host.append(block);
    }
  }

  function renderDecisions(archState) {
    const host = $("decisions-list");
    host.replaceChildren();
    if (!archState || archState.decisions.length === 0) {
      host.append(el("li", "empty", "No decisions recorded."));
      return;
    }
    for (const decision of archState.decisions) {
      const item = el("li");
      item.append(el("p", "decision-title", decision.title));
      if (decision.context) item.append(el("p", "meta", decision.context));
      if (decision.decision) item.append(el("p", "", decision.decision));
      host.append(item);
    }
  }

  function renderTasks(tasks) {
    const filter = $("task-filter").value.trim().toLowerCase();
    const host = $("task-board");
    host.replaceChildren();
    const visible = tasks.filter((task) => {
      if (!filter) return true;
      const haystack = [task.id, task.title, task.wave, ...(task.entities ?? [])].join(" ").toLowerCase();
      return haystack.includes(filter);
    });
    if (visible.length === 0) {
      host.append(el("p", "empty", tasks.length === 0 ? "No tasks were generated for this architecture." : "No task matches the filter."));
      return;
    }
    const waves = new Map();
    for (const task of visible) {
      const wave = task.wave ?? "wave-0";
      if (!waves.has(wave)) waves.set(wave, []);
      waves.get(wave).push(task);
    }
    for (const [wave, items] of waves) {
      const column = el("section", "wave");
      column.append(el("h2", "", `${wave} · ${items.length}`));
      for (const task of items) {
        const card = el("article", "task-card");
        card.append(el("h3", "", `${task.id} ${task.title}`));
        const meta = el("p", "meta", `${task.tokens ?? 0} tokens${task.dependsOn?.length ? ` · depends on ${task.dependsOn.join(", ")}` : ""}`);
        card.append(meta);
        const files = el("ul");
        for (const file of task.files ?? []) files.append(el("li", "", file));
        card.append(files);
        column.append(card);
      }
      host.append(column);
    }
  }

  function renderMetrics(metrics) {
    const host = $("metrics-grid");
    host.replaceChildren();
    if (metrics.length === 0) {
      host.append(el("p", "empty", "No metrics yet."));
      return;
    }
    const sorted = [...metrics].sort((a, b) => Number(a.pass) - Number(b.pass));
    for (const metric of sorted) {
      const card = el("div", `metric ${metric.pass ? "pass" : "fail"}`);
      card.append(el("p", "metric-name", metric.name));
      card.append(el("p", "metric-value", metric.value));
      card.append(el("p", "meta", `${metric.pass ? "pass" : "fail"} · target ${metric.target}`));
      host.append(card);
    }
  }

  function renderValidation(validation) {
    const host = $("validation-panel");
    host.replaceChildren();
    if (!validation) {
      host.append(el("p", "empty", "No validation yet."));
      return;
    }
    const pill = el("span", `status-pill ${validation.ok ? "ok" : "bad"}`, validation.ok ? "validation ok" : "validation failed");
    host.append(pill);
    host.append(
      el(
        "p",
        "meta",
        `passRate ${validation.passRate} · checks ${validation.checksRun} · unresolved ${validation.unresolvedRefs} · coverage ${validation.deterministicCoverage}`,
      ),
    );
    if (validation.issues?.length) {
      const list = el("ul", "issue-list");
      for (const issue of validation.issues) {
        const text = typeof issue === "string" ? issue : `${issue.file ?? ""}${issue.message ? `: ${issue.message}` : ""}`;
        list.append(el("li", "", text));
      }
      host.append(list);
    }
  }

  function renderArtifacts() {
    const names = Object.keys(state.files).sort((a, b) => a.localeCompare(b));
    const host = $("artifact-list");
    host.replaceChildren();
    $("artifact-empty").hidden = names.length > 0;
    if (names.length === 0) {
      $("artifact-name").textContent = "File";
      $("artifact-content").textContent = "Select a file to view its contents.";
      return;
    }
    for (const name of names) {
      const item = el("li");
      const button = el("button", name === state.selectedFile ? "is-active" : "", name);
      button.type = "button";
      button.addEventListener("click", () => selectFile(name));
      item.append(button);
      host.append(item);
    }
    if (!state.selectedFile || !state.files[state.selectedFile]) selectFile(names[0]);
  }

  function selectFile(name) {
    state.selectedFile = name;
    $("artifact-name").textContent = name;
    $("artifact-content").textContent = state.files[name] ?? "";
    for (const button of $("artifact-list").querySelectorAll("button")) {
      button.classList.toggle("is-active", button.textContent === name);
    }
  }

  /* ---------- Actions ---------- */

  async function runPreview() {
    const idea = $("idea-input").value.trim();
    $("composer-error").textContent = "";
    clearAlerts();
    if (idea.length < 3) {
      $("composer-error").textContent = t("error.invalidIdea", "Write at least 3 characters for your idea.");
      $("idea-input").focus();
      return;
    }
    setBusy(true, "preview");
    const button = $("preview-btn");
    const original = button.textContent;
    button.replaceChildren(el("span", "spinner"), document.createTextNode("Preparing…"));
    try {
      const response = await api("/api/preview", { idea, ...payload({}, false) });
      const result = await response.json();
      render(result);
      setView("architecture");
      toast(t("ui.previewReady", "Preview ready. Download the package when you are happy."), "success");
    } catch (error) {
      handleError(error, "composer-error");
    } finally {
      button.textContent = original;
      setBusy(false, null);
    }
  }

  async function runGenerate() {
    const idea = $("idea-input").value.trim();
    if (!state.result && idea.length < 3) {
      $("composer-error").textContent = t("error.invalidIdea", "Write at least 3 characters for your idea.");
      $("idea-input").focus();
      return;
    }
    setBusy(true, "generate");
    const button = $("download-btn");
    const original = button.textContent;
    button.replaceChildren(el("span", "spinner"), document.createTextNode("Packaging…"));
    try {
      const response = await api(
        "/api/generate",
        state.result ? { ...payload() } : { idea, ...payload() },
        120_000,
      );
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "agent-package.zip";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      const summary = [
        `validation ${response.headers.get("x-validation") ?? "?"}`,
        `${response.headers.get("x-task-count") ?? "?"} tasks`,
        `sha256 ${(response.headers.get("x-package-sha256") ?? "").slice(0, 12)}…`,
      ].join(" · ");
      toast(`Package ready · ${summary}`, "success");
      if (response.headers.get("x-validation") === "failed") {
        alertBar("The package downloaded, but validation reported issues. Open Quality to review them.");
      }
    } catch (error) {
      handleError(error, "composer-error");
    } finally {
      button.textContent = original;
      setBusy(false, null);
    }
  }

  async function runChat() {
    const message = $("chat-input").value.trim();
    $("chat-error").textContent = "";
    if (!message) {
      $("chat-error").textContent = t("error.emptyMessage", "Write an instruction for the architect first.");
      $("chat-input").focus();
      return;
    }
    if (!state.result) {
      $("chat-error").textContent = "Produce an architecture first.";
      return;
    }
    setBusy(true, "chat");
    appendChat("user", message);
    try {
      const response = await api("/api/chat", { ...payload(), message });
      const result = await response.json();
      render(result);
      appendChat("assistant", result.chat?.reply ?? "Updated.");
      renderChanges(result.chat?.changes ?? []);
      $("chat-input").value = "";
    } catch (error) {
      handleError(error, "chat-error");
    } finally {
      setBusy(false, null);
    }
  }

  function appendChat(role, text) {
    const item = el("li", `chat-message ${role}`, text);
    $("chat-log").append(item);
    $("chat-log").scrollTop = $("chat-log").scrollHeight;
  }

  function renderChanges(changes) {
    const host = $("chat-changes");
    host.replaceChildren();
    for (const change of changes) {
      host.append(el("li", "", `${change.action} ${change.type}: ${change.target}${change.detail ? ` — ${change.detail}` : ""}`));
    }
  }

  async function runReverse() {
    const path = $("reverse-path").value.trim();
    $("reverse-error").textContent = "";
    if (!path) {
      $("reverse-error").textContent = "Enter a repository path.";
      $("reverse-path").focus();
      return;
    }
    const button = $("reverse-run");
    button.disabled = true;
    $("reverse-progress").textContent = "scanning…";
    const body = {
      path,
      useRea: $("reverse-rea").checked,
      maxFiles: Number($("reverse-max-files").value) || undefined,
      maxDepth: Number($("reverse-max-depth").value) || undefined,
      locale: $("locale-select").value,
    };
    try {
      const created = await (await api("/api/reverse/jobs", body, 120_000)).json();
      await followReverseJob(created.jobId);
    } catch (error) {
      $("reverse-progress").textContent = "";
      handleError(error, "reverse-error");
    } finally {
      button.disabled = false;
    }
  }

  function followReverseJob(jobId) {
    return new Promise((resolve) => {
      const source = new EventSource(`/api/reverse/jobs/${encodeURIComponent(jobId)}/events`);
      const seen = new Set();
      const done = (payload) => {
        source.close();
        $("reverse-progress").textContent = "";
        if (payload) {
          render(payload);
          renderFindings(payload.findings ?? [], payload);
          setView("reverse");
          toast(payload.summary ?? "Reverse scan finished.", "success");
        }
        resolve();
      };
      source.onmessage = (event) => {
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        if (seen.has(payload.seq)) return;
        seen.add(payload.seq);
        if (payload.type === "done") {
          done(payload.payload);
          return;
        }
        if (payload.type === "error") {
          source.close();
          $("reverse-progress").textContent = "";
          $("reverse-error").textContent = payload.payload?.message ?? "Reverse scan failed.";
          resolve();
          return;
        }
        $("reverse-progress").textContent = `${payload.type}…`;
      };
      source.onerror = () => {
        source.close();
        $("reverse-progress").textContent = "";
        $("reverse-error").textContent = "Lost the progress stream; the job may still finish on the server.";
        resolve();
      };
    });
  }

  function renderFindings(findings, result) {
    const host = $("reverse-findings");
    host.replaceChildren();
    $("reverse-empty").hidden = findings.length > 0;
    if (result?.summary) host.append(el("li", "meta", result.summary));
    for (const finding of findings) {
      const item = el("li");
      item.append(el("strong", "", `${finding.kind} · ${finding.source}`));
      item.append(el("p", "", finding.detail));
      host.append(item);
    }
    for (const warning of result?.warnings ?? []) {
      host.append(el("li", "meta", `warning: ${warning}`));
    }
  }

  async function loadSandboxes() {
    try {
      const payload = await (await api("/api/sandboxes")).json();
      const body = $("sandbox-list").querySelector("tbody");
      body.replaceChildren();
      for (const driver of payload.sandboxes) {
        const row = el("tr");
        const cells = [
          [driver.id, "Driver"],
          [driver.available ? "yes" : "no", "Available"],
          [driver.isolation, "Isolation"],
          [driver.version ?? "—", "Version"],
        ];
        for (const [value, label] of cells) {
          const cell = el("td", "", value);
          cell.dataset.label = label;
          row.append(cell);
        }
        body.append(row);
      }
      return payload.sandboxes;
    } catch (error) {
      $("sandbox-error").textContent = error.message;
      return [];
    }
  }

  async function runSandbox() {
    $("sandbox-error").textContent = "";
    const idea = $("idea-input").value.trim();
    if (!state.result && idea.length < 3) {
      $("sandbox-error").textContent = "Produce an architecture first.";
      return;
    }
    const button = $("sandbox-run");
    button.disabled = true;
    $("sandbox-console").textContent = "Running…";
    try {
      const response = await api(
        "/api/sandbox",
        state.result ? { ...payload(), sandbox: "auto", fallback: true } : { idea, ...payload(), sandbox: "auto", fallback: true },
        120_000,
      );
      const result = await response.json();
      $("sandbox-console").textContent = [
        `driver: ${result.driver} (${result.isolation})`,
        `exitCode: ${result.exitCode} · ${result.durationMs} ms${result.timedOut ? " · timed out" : ""}`,
        "",
        result.stdout ?? "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ].join("\n");
      toast(`Sandbox ${result.exitCode === 0 ? "passed" : "failed"} on ${result.driver}`, result.exitCode === 0 ? "success" : "error");
    } catch (error) {
      $("sandbox-console").textContent = "";
      handleError(error, "sandbox-error");
    } finally {
      button.disabled = false;
    }
  }

  async function loadStatus() {
    const grid = $("status-grid");
    grid.replaceChildren();
    const add = (label, value) => {
      grid.append(el("dt", "", label));
      grid.append(el("dd", "", value));
    };
    try {
      const version = await (await api("/api/version")).json();
      add("name", version.name ?? "architect-studio");
      add("version", version.version ?? "—");
      add("tokenizer", version.tokenizer ?? "—");
      add("locales", (version.locales ?? []).map((locale) => locale.id).join(", "));
      $("version-badge").textContent = `v${version.version ?? "—"}`;
      populateLocales(version.locales ?? []);
    } catch (error) {
      add("error", error.message);
    }
    try {
      const rea = await (await api("/api/rea")).json();
      const detection = rea.detection ?? {};
      add("rea", detection.available ? `${detection.engine} ${detection.version ?? ""}`.trim() : `static (${detection.reason ?? "not installed"})`);
    } catch {
      add("rea", "unavailable");
    }
    const sandboxes = await loadSandboxes();
    const available = sandboxes.filter((driver) => driver.available).map((driver) => driver.id);
    add("sandbox drivers", available.length ? available.join(", ") : "none");
  }

  function populateLocales(locales) {
    const select = $("locale-select");
    if (select.options.length === locales.length && select.options.length > 0) return;
    const current = state.locale;
    select.replaceChildren();
    for (const locale of locales) {
      const option = el("option", "", locale.label ?? locale.id);
      option.value = locale.id;
      select.append(option);
    }
    select.value = current;
  }

  function handleError(error, targetId) {
    const message = error.message || "Unexpected error";
    const field = targetId ? $(targetId) : null;
    if (field) field.textContent = message;
    if (error.code === "invalid_idea" || error.code === "empty_message" || error.code === "invalid_path") return;
    if (error.code === "internal_error" || error.code === "sandbox_unavailable" || error.code === "invalid_state") {
      alertBar(message);
      return;
    }
    toast(message, error.code === "llm_failed" ? "warning" : "error");
  }

  /* ---------- Navigation, theme, settings ---------- */

  const VIEWS = ["composer", "architecture", "chat", "tasks", "metrics", "artifacts", "reverse", "sandbox", "settings", "status"];

  function setView(name) {
    if (!VIEWS.includes(name)) return;
    for (const section of document.querySelectorAll(".view")) {
      section.classList.toggle("is-active", section.id === `view-${name}`);
    }
    for (const link of document.querySelectorAll(".rail-link")) {
      link.classList.toggle("is-active", link.dataset.view === name);
    }
    if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
    if (name === "status") loadStatus();
    if (name === "sandbox") loadSandboxes();
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("architect.theme", theme);
    } catch {
      /* storage can be disabled */
    }
    if (window.mermaid) {
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: theme === "dark" ? "dark" : "default",
      });
      if (state.diagram) renderDiagram();
    }
  }

  function bind() {
    for (const link of document.querySelectorAll(".rail-link")) {
      link.addEventListener("click", () => setView(link.dataset.view));
    }
    for (const chip of document.querySelectorAll("#example-chips .chip")) {
      chip.addEventListener("click", () => {
        $("idea-input").value = chip.dataset.idea;
        $("idea-input").focus();
      });
    }
    $("preview-btn").addEventListener("click", runPreview);
    $("composer-generate-btn").addEventListener("click", runGenerate);
    $("download-btn").addEventListener("click", runGenerate);
    $("chat-send").addEventListener("click", runChat);
    $("chat-input").addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") runChat();
    });
    $("idea-input").addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") runPreview();
    });
    $("reverse-run").addEventListener("click", runReverse);
    $("sandbox-run").addEventListener("click", runSandbox);
    $("task-filter").addEventListener("input", () => renderTasks(state.result?.tasks ?? []));
    $("artifact-copy").addEventListener("click", () => copyText($("artifact-content").textContent ?? ""));
    $("diagram-copy").addEventListener("click", () => {
      const svg = $("diagram").querySelector("svg");
      copyText(svg ? svg.outerHTML : state.diagram);
    });
    let zoom = 1;
    const applyZoom = () => {
      const svg = $("diagram").querySelector("svg");
      if (svg) svg.style.transform = `scale(${zoom})`;
    };
    $("diagram-zoom-in").addEventListener("click", () => {
      zoom = Math.min(2, zoom + 0.1);
      applyZoom();
    });
    $("diagram-zoom-out").addEventListener("click", () => {
      zoom = Math.max(1, zoom - 0.1);
      applyZoom();
    });
    $("theme-toggle").addEventListener("click", () => {
      applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    });
    $("locale-select").addEventListener("change", async (event) => {
      state.locale = event.target.value;
      try {
        localStorage.setItem("architect.locale", state.locale);
      } catch {
        /* storage can be disabled */
      }
      await loadMessages(state.locale);
      if (state.result) toast(`Language: ${state.locale}`, "info");
    });
    $("api-key").addEventListener("input", (event) => {
      state.apiKey = event.target.value.trim();
    });
    $("clear-key").addEventListener("click", () => {
      state.apiKey = "";
      $("api-key").value = "";
      toast("API key cleared from memory.", "info");
    });
    let awaitingSecondKey = false;
    document.addEventListener("keydown", (event) => {
      if (event.target.matches("input, textarea, select")) return;
      if (event.key === "?" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        toast("Shortcuts: g p preview · g r reverse · ? help", "info");
        return;
      }
      if (awaitingSecondKey) {
        awaitingSecondKey = false;
        if (event.key === "p") setView("composer");
        if (event.key === "r") setView("reverse");
        return;
      }
      if (event.key === "g") awaitingSecondKey = true;
    });
    window.addEventListener("hashchange", () => setView(location.hash.slice(1)));
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied.", "success");
    } catch {
      toast("Clipboard unavailable.", "error");
    }
  }

  async function start() {
    const stored = (() => {
      try {
        return localStorage.getItem("architect.theme");
      } catch {
        return null;
      }
    })();
    const preferred = stored ?? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    applyTheme(preferred === "light" ? "light" : "dark");
    state.locale = (() => {
      try {
        return localStorage.getItem("architect.locale") ?? "en";
      } catch {
        return "en";
      }
    })();
    bind();
    const hash = location.hash.slice(1);
    setView(VIEWS.includes(hash) ? hash : "composer");
    await loadMessages(state.locale);
    try {
      const version = await (await api("/api/version")).json();
      $("version-badge").textContent = `v${version.version ?? "—"}`;
      populateLocales(version.locales ?? []);
      const select = $("locale-select");
      select.value = state.locale;
      if (select.value !== state.locale) {
        state.locale = select.value || "en";
        await loadMessages(state.locale);
      }
    } catch {
      /* status view reports the failure in detail */
    }
    loadSandboxes();
  }

  document.addEventListener("DOMContentLoaded", start);
})();
