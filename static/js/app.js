function appendLogToElement(elementId, waitingText, message) {
    const consoleEl = document.getElementById(elementId);
    if (!consoleEl) return;
    if (consoleEl.textContent === waitingText) {
        consoleEl.textContent = message;
    } else {
        consoleEl.textContent += `\n${message}`;
    }
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options,
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed: ${response.status}`);
    }
    return response.json();
}

function appendLog(message) {
    appendLogToElement("log-console", "等待任务日志...", message);
}

function formatText(value, fallback = "-") {
    if (value === null || value === undefined || value === "") return fallback;
    return String(value);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function bindDpjsDragScroll(element) {
    if (!element || element.dataset.dragScrollBound === "1") return;

    let isDragging = false;
    let startX = 0;
    let startScrollLeft = 0;
    let moved = false;

    const stopDrag = (event) => {
        if (!isDragging) return;
        isDragging = false;
        element.classList.remove("dragging");
        if (
            event
            && typeof event.pointerId === "number"
            && typeof element.hasPointerCapture === "function"
            && typeof element.releasePointerCapture === "function"
            && element.hasPointerCapture(event.pointerId)
        ) {
            element.releasePointerCapture(event.pointerId);
        }
    };

    element.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        isDragging = true;
        moved = false;
        startX = event.clientX;
        startScrollLeft = element.scrollLeft;
        element.classList.add("dragging");
        if (typeof element.setPointerCapture === "function" && typeof event.pointerId === "number") {
            element.setPointerCapture(event.pointerId);
        }
    });

    element.addEventListener("pointermove", (event) => {
        if (!isDragging) return;
        const deltaX = event.clientX - startX;
        if (Math.abs(deltaX) > 2) {
            moved = true;
        }
        element.scrollLeft = startScrollLeft - deltaX;
    });

    element.addEventListener("pointerup", stopDrag);
    element.addEventListener("pointercancel", stopDrag);
    element.addEventListener("lostpointercapture", () => {
        isDragging = false;
        element.classList.remove("dragging");
    });
    element.addEventListener("click", (event) => {
        if (!moved) return;
        event.preventDefault();
        event.stopPropagation();
        moved = false;
    });

    element.dataset.dragScrollBound = "1";
}

function initDpjsHorizontalDragScroll(root = document) {
    root.querySelectorAll(".dpjs-drag-scroll").forEach((element) => bindDpjsDragScroll(element));
}

function badgeClass(status) {
    const normalized = String(status || "").toLowerCase();
    if (["running", "pending"].includes(normalized)) return `badge badge-running`;
    if (normalized === "completed") return `badge badge-completed`;
    if (["failed", "cancelled"].includes(normalized)) return `badge badge-failed`;
    return "badge";
}

function renderRecentTasks(tasks) {
    const body = document.getElementById("recent-tasks-body");
    if (!body) return;
    if (!tasks || tasks.length === 0) {
        body.innerHTML = `
            <tr>
                <td colspan="5" class="table-empty">暂无任务记录</td>
            </tr>
        `;
        return;
    }
    body.innerHTML = tasks.map((task) => `
        <tr>
            <td><span class="code-text dpjs-inline-scroll dpjs-drag-scroll">${formatText(task.task_uuid)}</span></td>
            <td><span class="dpjs-inline-scroll dpjs-drag-scroll">${formatText(task.task_type)}</span></td>
            <td><span class="${badgeClass(task.status)}">${formatText(task.status)}</span></td>
            <td><span class="dpjs-inline-scroll dpjs-drag-scroll">${formatText(task.target_url)}</span></td>
            <td><span class="dpjs-inline-scroll dpjs-drag-scroll">${formatText(task.created_at)}</span></td>
        </tr>
    `).join("");
    initDpjsHorizontalDragScroll(body);
}

function renderDpjsTasks(tasks) {
    const body = document.getElementById("dpjs-tasks-body");
    if (!body) return;
    if (!tasks || tasks.length === 0) {
        body.innerHTML = `
            <tr>
                <td colspan="4" class="table-empty">暂无 DPJS 任务</td>
            </tr>
        `;
        return;
    }
    body.innerHTML = tasks.map((task) => `
        <tr data-task-id="${formatText(task.task_uuid, "")}" class="dpjs-task-row">
            <td>
                <span class="code-text dpjs-inline-scroll dpjs-drag-scroll">${formatText(task.task_uuid)}</span>
            </td>
            <td><span class="${badgeClass(task.status)}">${formatText(task.status)}</span></td>
            <td><span class="dpjs-inline-scroll dpjs-drag-scroll">${formatText(task.target_url)}</span></td>
            <td><span class="dpjs-inline-scroll dpjs-drag-scroll">${formatText(task.created_at)}</span></td>
        </tr>
    `).join("");
    initDpjsHorizontalDragScroll(body);
}

function updateTaskBadge(status, message, elementId = "task-status-badge") {
    const badge = document.getElementById(elementId);
    if (!badge) return;
    const text = message ? `${status} · ${message}` : status;
    badge.className = badgeClass(status);
    badge.textContent = text || "待命";
}

function isDpjsTaskRunning(status) {
    return ["pending", "running"].includes(String(status || "").toLowerCase());
}

function isDpjsTaskStopping(task) {
    if (!task) return false;
    const message = String(task.message || task.error_message || "").toLowerCase();
    return isDpjsTaskRunning(task.status) && message.includes("stopping");
}

function syncDpjsRunButton(task, isSubmittingStop = false) {
    const runBtn = document.getElementById("dpjs-run-btn");
    if (!runBtn) return;
    const running = isDpjsTaskRunning(task?.status);
    const stopping = isSubmittingStop || isDpjsTaskStopping(task);
    runBtn.classList.toggle("dpjs-run-btn-danger", running || stopping);
    runBtn.disabled = stopping;
    runBtn.textContent = stopping ? "停止中..." : running ? "停止运行" : "立即运行";
    runBtn.dataset.mode = running ? "stop" : "run";
}

async function loadDashboardSummary() {
    const panel = document.getElementById("summary-panel");
    if (!panel) return;

    const data = await requestJson("/api/dashboard/summary");
    document.getElementById("summary-app-name").textContent = formatText(data.app_name);
    document.getElementById("summary-app-version").textContent = formatText(data.app_version);
    document.getElementById("summary-debug").textContent = data.debug ? "是" : "否";
    document.getElementById("summary-task-count").textContent = formatText(data.task_count, "0");
    document.getElementById("summary-running-task-count").textContent = formatText(data.running_task_count, "0");
    document.getElementById("summary-enabled-site-count").textContent = formatText(data.enabled_site_count, "0");
    document.getElementById("summary-server-time").textContent = formatText(data.server_time);

    const activeTask = Array.isArray(data.active_tasks) && data.active_tasks.length > 0 ? data.active_tasks[0] : null;
    document.getElementById("summary-current-task").textContent = activeTask ? formatText(activeTask.task_id) : "-";
    updateTaskBadge(activeTask?.status || "待命", activeTask?.message || "");
    renderRecentTasks(data.recent_tasks || []);
}

function connectTaskSocket(taskId, handlers = {}) {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/api/ws/task/${encodeURIComponent(taskId)}`);

    socket.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type === "ping") {
            socket.send(JSON.stringify({ type: "ping" }));
            return;
        }
        if (payload.type === "log") {
            appendLog(payload.message);
            handlers.onLog?.(payload);
        }
        if (payload.type === "status") {
            updateTaskBadge(payload.status, payload.message || "");
            document.getElementById("summary-current-task").textContent = taskId;
            appendLog(`[status] ${payload.status}${payload.message ? ` - ${payload.message}` : ""}`);
            handlers.onStatus?.(payload);
        }
    };

    socket.onopen = () => appendLog(`[system] websocket connected: ${taskId}`);
    socket.onclose = () => appendLog(`[system] websocket disconnected: ${taskId}`);
    return socket;
}

async function initDashboard() {
    await loadDashboardSummary();
    const input = document.getElementById("demo-task-id");
    const button = document.getElementById("demo-task-btn");
    if (!input || !button) return;

    let socket = connectTaskSocket(input.value);
    button.addEventListener("click", async () => {
        if (socket) socket.close();
        socket = connectTaskSocket(input.value);
        await requestJson(`/api/dashboard/demo-task/${encodeURIComponent(input.value)}`, { method: "POST" });
        await loadDashboardSummary();
    });
}

async function initSettings() {
    const form = document.getElementById("settings-form");
    if (!form) return;

    const result = document.getElementById("settings-result");
    const data = await requestJson("/api/settings");
    document.getElementById("app_name").value = data.app_name;
    document.getElementById("webui_host").value = data.webui_host;
    document.getElementById("webui_port").value = data.webui_port;
    document.getElementById("log_level").value = data.log_level;
    document.getElementById("debug").checked = data.debug;

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        result.textContent = "保存中...";
        result.className = "form-result";
        try {
            const payload = {
                app_name: document.getElementById("app_name").value,
                webui_host: document.getElementById("webui_host").value,
                webui_port: Number(document.getElementById("webui_port").value),
                log_level: document.getElementById("log_level").value,
                debug: document.getElementById("debug").checked,
            };
            const saveResult = await requestJson("/api/settings", {
                method: "PUT",
                body: JSON.stringify(payload),
            });
            result.textContent = saveResult.ok ? "已保存到数据库" : "保存失败";
            result.className = `form-result ${saveResult.ok ? "success" : "error"}`;
        } catch (error) {
            result.textContent = error.message;
            result.className = "form-result error";
        }
    });
}

function parseJsonField(value, fallback) {
    if (!value || !String(value).trim()) return fallback;
    return JSON.parse(value);
}

function formatDpjsTemplateText(value) {
    const formatParsedJson = (parsedValue) => {
        const formatted = JSON.stringify(parsedValue, null, 2);
        if (formatted === "{}") return "{\n}";
        if (formatted === "[]") return "[\n]";
        return formatted;
    };

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return "{\n}";
        try {
            return formatParsedJson(JSON.parse(trimmed));
        } catch {
            return value;
        }
    }
    return formatParsedJson(value || {});
}

function getDefaultDpjsParserField() {
    return { name: "", path: "" };
}

function normalizeDpjsParserConfig(parser) {
    return {
        enabled: !!parser?.enabled,
        code: formatText(parser?.code, "def parse(response):\n    data = response.json()\n    return {\n        \"items\": data.get(\"items\", []) if isinstance(data, dict) else data\n    }")
    };
}

function renderDpjsParsedResult(task, pageIndex = 0) {
    const parsedEl = document.getElementById("dpjs-parsed-json");
    const summaryEl = document.getElementById("dpjs-parsed-summary");
    if (!parsedEl || !summaryEl) return;

    if (!task) {
        parsedEl.textContent = "等待解析结果...";
        summaryEl.textContent = "-";
        return;
    }

    const resultJson = task.result_json || {};
    const parser = resultJson.parser || {};
    if (!parser.enabled) {
        parsedEl.textContent = "未启用结果解析";
        summaryEl.textContent = "parser disabled";
        return;
    }

    const results = Array.isArray(resultJson.results) ? resultJson.results : [];
    const currentIndex = Math.max(0, pageIndex);
    const currentResult = results[currentIndex] || null;
    const parsed = currentResult?.parsed || null;
    const itemsMap = resultJson.items && typeof resultJson.items === "object" ? resultJson.items : {};
    const pageItems = Array.isArray(itemsMap[String(currentIndex + 1)]) ? itemsMap[String(currentIndex + 1)] : [];

    parsedEl.textContent = JSON.stringify({
        parser: {
            enabled: !!parser.enabled,
            code: formatText(parser.code, ""),
        },
        current_page: currentIndex + 1,
        item_count: pageItems.length,
        parsed: parsed || {
            ok: true,
            item_count: pageItems.length,
            items: pageItems,
            error: null,
        },
    }, null, 2);

    const totalItems = Number(resultJson.item_count || 0);
    const parsedStatus = parsed?.ok === false ? ` · error: ${formatText(parsed.error)}` : "";
    summaryEl.textContent = `python parser · total ${totalItems} items · current ${pageItems.length} items${parsedStatus}`;
}

function buildDpjsPayload() {
    return {
        page_url: document.getElementById("dpjs-page-url").value,
        user_data_path: document.getElementById("dpjs-user-data-path").value,
        proxy_url: document.getElementById("dpjs-proxy-url").value || null,
        headless: document.getElementById("dpjs-headless").checked,
        multi_request: document.getElementById("dpjs-multi-request").checked,
        sleep_seconds: Number(document.getElementById("dpjs-sleep-seconds").value || 0),
        loop_enabled: document.getElementById("dpjs-loop-enabled").checked,
        loop_variable_name: document.getElementById("dpjs-loop-variable-name").value,
        loop_start: Number(document.getElementById("dpjs-loop-start").value || 0),
        loop_count: Number(document.getElementById("dpjs-loop-count").value || 1),
        loop_step: Number(document.getElementById("dpjs-loop-step").value || 0),
        request_template: parseJsonField(document.getElementById("dpjs-request-template").value, {}),
        request_variables: parseJsonField(document.getElementById("dpjs-request-variables").value, []),
        result_parser: {
            enabled: document.getElementById("dpjs-parser-enabled").checked,
            code: document.getElementById("dpjs-parser-code").value,
        },
    };
}

function setDpjsConfig(config) {
    document.getElementById("dpjs-page-url").value = formatText(config.page_url, "");
    document.getElementById("dpjs-user-data-path").value = formatText(config.user_data_path, "");
    document.getElementById("dpjs-proxy-url").value = formatText(config.proxy_url, "");
    document.getElementById("dpjs-headless").checked = !!config.headless;
    document.getElementById("dpjs-multi-request").checked = !!config.multi_request;
    document.getElementById("dpjs-sleep-seconds").value = Number(config.sleep_seconds || 0);
    document.getElementById("dpjs-loop-enabled").checked = !!config.loop_enabled;
    document.getElementById("dpjs-loop-variable-name").value = formatText(config.loop_variable_name, "page");
    document.getElementById("dpjs-loop-start").value = Number(config.loop_start || 0);
    document.getElementById("dpjs-loop-count").value = Number(config.loop_count || 1);
    document.getElementById("dpjs-loop-step").value = Number(config.loop_step || 0);
    document.getElementById("dpjs-request-template").value = formatDpjsTemplateText(config.request_template || {});
    document.getElementById("dpjs-request-variables").value = JSON.stringify(config.request_variables || [], null, 2);
    const parserConfig = normalizeDpjsParserConfig(config.result_parser || {});
    document.getElementById("dpjs-parser-enabled").checked = parserConfig.enabled;
    document.getElementById("dpjs-parser-code").value = parserConfig.code;
}

function toggleDpjsMultiRequestOptions() {
    const toggle = document.getElementById("dpjs-multi-request");
    const options = document.getElementById("dpjs-multi-request-options");
    if (!toggle || !options) return;
    options.hidden = !toggle.checked;
}

function getDpjsDownloadPayload(task) {
    if (!task) return null;
    const hasResult = task.result_json && Object.keys(task.result_json).length > 0;
    if (!hasResult && !task.error_message) return null;
    return {
        task_uuid: task.task_uuid,
        status: task.status,
        target_url: task.target_url,
        created_at: task.created_at,
        started_at: task.started_at,
        completed_at: task.completed_at,
        updated_at: task.updated_at,
        error_message: task.error_message,
        result_json: task.result_json,
    };
}

function updateDpjsDownloadButtons(task) {
    const jsonBtn = document.getElementById("dpjs-download-json");
    const txtBtn = document.getElementById("dpjs-download-txt");
    if (!jsonBtn || !txtBtn) return;
    const enabled = !!getDpjsDownloadPayload(task);
    jsonBtn.disabled = !enabled;
    txtBtn.disabled = !enabled;
}

function buildDpjsDownloadFilename(task, extension) {
    const taskId = formatText(task?.task_uuid, "dpjs-task").replace(/[^a-zA-Z0-9_-]+/g, "-");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${taskId}-${timestamp}.${extension}`;
}

function triggerBrowserDownload(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function downloadDpjsResult(task, format) {
    const payload = getDpjsDownloadPayload(task);
    if (!payload) {
        throw new Error("当前任务暂无可下载结果");
    }

    if (format === "json") {
        triggerBrowserDownload(
            buildDpjsDownloadFilename(task, "json"),
            JSON.stringify(payload, null, 2),
            "application/json;charset=utf-8",
        );
        return;
    }

    const resultPreview = document.getElementById("dpjs-result-json")?.textContent || "";
    const parsedPreview = document.getElementById("dpjs-parsed-json")?.textContent || "";
    const summary = document.getElementById("dpjs-result-summary")?.textContent || "-";
    const parsedSummary = document.getElementById("dpjs-parsed-summary")?.textContent || "-";
    const content = [
        `任务 ID: ${formatText(task.task_uuid)}`,
        `状态: ${formatText(task.status)}`,
        `目标 URL: ${formatText(task.target_url)}`,
        `创建时间: ${formatText(task.created_at)}`,
        `最近更新时间: ${formatText(task.updated_at || task.completed_at || task.started_at)}`,
        `结果摘要: ${summary}`,
        `解析摘要: ${parsedSummary}`,
        task.error_message ? `错误信息: ${task.error_message}` : null,
        "",
        "结果内容:",
        resultPreview,
        "",
        "解析结果:",
        parsedPreview,
    ].filter((line) => line !== null).join("\n");
    triggerBrowserDownload(
        buildDpjsDownloadFilename(task, "txt"),
        content,
        "text/plain;charset=utf-8",
    );
}

function renderDpjsResult(task, pageIndex = 0) {
    const resultEl = document.getElementById("dpjs-result-json");
    const summaryEl = document.getElementById("dpjs-result-summary");
    const targetEl = document.getElementById("dpjs-current-target");
    const updatedEl = document.getElementById("dpjs-updated-at");
    const paginationEl = document.getElementById("dpjs-result-pagination");
    const indicatorEl = document.getElementById("dpjs-result-page-indicator");
    const prevBtn = document.getElementById("dpjs-result-prev");
    const nextBtn = document.getElementById("dpjs-result-next");
    if (!resultEl || !summaryEl || !targetEl || !updatedEl || !paginationEl || !indicatorEl || !prevBtn || !nextBtn) return;

    targetEl.textContent = formatText(task?.target_url);
    updatedEl.textContent = formatText(task?.updated_at || task?.completed_at || task?.started_at);

    if (!task) {
        paginationEl.hidden = true;
        resultEl.textContent = "等待任务结果...";
        summaryEl.textContent = "-";
        renderDpjsParsedResult(null, 0);
        updateDpjsDownloadButtons(null);
        return;
    }

    let currentIndex = Math.max(0, pageIndex);
    if (task.result_json && Object.keys(task.result_json).length > 0) {
        const results = Array.isArray(task.result_json.results) ? task.result_json.results : [];
        const requestCount = Number(task.result_json.request_count || results.length || 0);
        if (results.length > 0) {
            currentIndex = Math.min(currentIndex, results.length - 1);
            const currentResult = results[currentIndex];
            const loopInfo = task.result_json.loop || {};
            paginationEl.hidden = results.length <= 1;
            indicatorEl.textContent = `第 ${currentIndex + 1} / ${results.length} 页`;
            prevBtn.disabled = currentIndex === 0;
            nextBtn.disabled = currentIndex === results.length - 1;
            resultEl.dataset.pageIndex = String(currentIndex);
            resultEl.textContent = JSON.stringify({
                page_url: task.result_json.page_url,
                multi_request: task.result_json.multi_request,
                sleep_seconds: task.result_json.sleep_seconds,
                loop: loopInfo,
                parser: task.result_json.parser || {},
                request_count: requestCount,
                current_page: currentIndex + 1,
                result: currentResult,
            }, null, 2);
        } else {
            paginationEl.hidden = true;
            resultEl.dataset.pageIndex = "0";
            resultEl.textContent = JSON.stringify(task.result_json, null, 2);
        }
        const loopInfo = task.result_json.loop || {};
        const loopText = loopInfo.enabled
            ? ` · ${formatText(loopInfo.variable_name, "page")} ${formatText(loopInfo.start, "0")} + ${formatText(loopInfo.step, "0")} × ${formatText(loopInfo.count, "1")}`
            : "";
        summaryEl.textContent = `${formatText(task.status)} · ${requestCount} requests${loopText}`;
    } else if (task.error_message) {
        paginationEl.hidden = true;
        resultEl.dataset.pageIndex = "0";
        resultEl.textContent = task.error_message;
        summaryEl.textContent = "failed";
    } else {
        paginationEl.hidden = true;
        resultEl.dataset.pageIndex = "0";
        resultEl.textContent = "等待任务结果...";
        summaryEl.textContent = formatText(task.status);
    }

    renderDpjsParsedResult(task, Number(resultEl.dataset.pageIndex || currentIndex || 0));
    updateDpjsDownloadButtons(task);
}

async function loadDpjsTask(taskId) {
    const data = await requestJson(`/api/dpjs/tasks/${encodeURIComponent(taskId)}`);
    if (!data.ok || !data.task) return null;
    document.getElementById("summary-current-task").textContent = formatText(data.task.task_uuid);
    updateTaskBadge(data.task.status || "待命", data.task.error_message || "");
    renderDpjsResult(data.task);
    syncDpjsRunButton(data.task);
    const consoleEl = document.getElementById("log-console");
    if (consoleEl) {
        consoleEl.textContent = data.logs && data.logs.length
            ? data.logs.map((item) => item.message).join("\n")
            : "等待任务日志...";
    }
    return data.task;
}

async function initDpjsSpider() {
    const page = document.getElementById("dpjs-spider-page");
    if (!page) return;

    const form = document.getElementById("dpjs-form");
    const runBtn = document.getElementById("dpjs-run-btn");
    const result = document.getElementById("dpjs-form-result");
    const resultEl = document.getElementById("dpjs-result-json");
    const prevBtn = document.getElementById("dpjs-result-prev");
    const nextBtn = document.getElementById("dpjs-result-next");
    const multiRequestToggle = document.getElementById("dpjs-multi-request");
    const parserAddFieldBtn = document.getElementById("dpjs-parser-add-field");
    const parserFields = document.getElementById("dpjs-parser-fields");
    const downloadJsonBtn = document.getElementById("dpjs-download-json");
    const downloadTxtBtn = document.getElementById("dpjs-download-txt");
    let socket = null;
    let currentTask = null;
    let isSubmittingStop = false;
    initDpjsHorizontalDragScroll(page);

    const connectDpjsSocket = (taskId) => connectTaskSocket(taskId, {
        onStatus: (payload) => {
            if (!currentTask || currentTask.task_uuid !== taskId) return;
            currentTask = {
                ...currentTask,
                status: payload.status,
                message: payload.message || currentTask.message,
                error_message: payload.error_message || currentTask.error_message,
                started_at: payload.started_at || currentTask.started_at,
                completed_at: payload.completed_at || currentTask.completed_at,
            };
            if (["completed", "failed", "cancelled"].includes(String(payload.status || "").toLowerCase())) {
                isSubmittingStop = false;
            }
            syncDpjsRunButton(currentTask, isSubmittingStop);
        },
    });

    const initial = await requestJson("/api/dpjs");
    setDpjsConfig(initial.config);
    toggleDpjsMultiRequestOptions();
    renderDpjsTasks(initial.recent_tasks || []);
    if (initial.recent_tasks && initial.recent_tasks.length > 0) {
        currentTask = initial.recent_tasks[0];
        renderDpjsResult(currentTask);
        syncDpjsRunButton(currentTask, isSubmittingStop);
    } else {
        renderDpjsParsedResult(null, 0);
        updateDpjsDownloadButtons(null);
        syncDpjsRunButton(null, isSubmittingStop);
    }

    multiRequestToggle?.addEventListener("change", () => {
        toggleDpjsMultiRequestOptions();
    });

    parserAddFieldBtn?.addEventListener("click", () => {
        const nextFields = [...collectDpjsParserFields(), getDefaultDpjsParserField()];
        renderDpjsParserFields(nextFields);
    });

    parserFields?.addEventListener("click", (event) => {
        const removeBtn = event.target.closest(".dpjs-parser-remove-field");
        if (!removeBtn) return;
        const row = removeBtn.closest(".dpjs-parser-field-row");
        if (!row) return;
        const fields = collectDpjsParserFields();
        const index = Number(row.dataset.fieldIndex || -1);
        const nextFields = fields.filter((_, fieldIndex) => fieldIndex !== index);
        renderDpjsParserFields(nextFields.length > 0 ? nextFields : [getDefaultDpjsParserField()]);
    });

    downloadJsonBtn?.addEventListener("click", () => {
        downloadDpjsResult(currentTask, "json");
    });

    downloadTxtBtn?.addEventListener("click", () => {
        downloadDpjsResult(currentTask, "txt");
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        result.textContent = "保存中...";
        result.className = "form-result";
        try {
            const payload = buildDpjsPayload();
            const saveResult = await requestJson("/api/dpjs/config", {
                method: "PUT",
                body: JSON.stringify(payload),
            });
            result.textContent = saveResult.ok ? "DPJS 配置已保存" : "保存失败";
            result.className = `form-result ${saveResult.ok ? "success" : "error"}`;
            setDpjsConfig(saveResult.config || payload);
            toggleDpjsMultiRequestOptions();
        } catch (error) {
            result.textContent = error.message;
            result.className = "form-result error";
        }
    });

    prevBtn?.addEventListener("click", () => {
        if (!currentTask) return;
        const pageIndex = Number(resultEl?.dataset.pageIndex || 0);
        renderDpjsResult(currentTask, pageIndex - 1);
    });

    nextBtn?.addEventListener("click", () => {
        if (!currentTask) return;
        const pageIndex = Number(resultEl?.dataset.pageIndex || 0);
        renderDpjsResult(currentTask, pageIndex + 1);
    });

    runBtn.addEventListener("click", async () => {
        const taskId = currentTask?.task_uuid;
        if (runBtn.dataset.mode === "stop" && taskId) {
            result.textContent = "停止中...";
            result.className = "form-result";
            isSubmittingStop = true;
            syncDpjsRunButton(currentTask, isSubmittingStop);
            try {
                const stopResult = await requestJson(`/api/dpjs/tasks/${encodeURIComponent(taskId)}/cancel`, {
                    method: "POST",
                });
                currentTask = {
                    ...currentTask,
                    status: stopResult.status === "cancelling" ? (currentTask?.status || "running") : currentTask?.status,
                    message: stopResult.status === "cancelling" ? "DPJS task stopping" : currentTask?.message,
                };
                result.textContent = stopResult.ok ? "已提交停止请求" : (stopResult.message || "停止失败");
                result.className = `form-result ${stopResult.ok ? "success" : "error"}`;
                syncDpjsRunButton(currentTask, isSubmittingStop);
                if (!stopResult.ok) {
                    isSubmittingStop = false;
                    currentTask = await loadDpjsTask(taskId);
                    syncDpjsRunButton(currentTask, isSubmittingStop);
                }
            } catch (error) {
                isSubmittingStop = false;
                result.textContent = error.message;
                result.className = "form-result error";
                syncDpjsRunButton(currentTask, isSubmittingStop);
            }
            return;
        }

        result.textContent = "运行中...";
        result.className = "form-result";
        try {
            const runResult = await requestJson("/api/dpjs/run", {
                method: "POST",
                body: JSON.stringify(buildDpjsPayload()),
            });
            if (socket) socket.close();
            currentTask = runResult.task;
            isSubmittingStop = false;
            document.getElementById("log-console").textContent = "等待任务日志...";
            document.getElementById("summary-current-task").textContent = runResult.task_id;
            renderDpjsResult(currentTask);
            syncDpjsRunButton(currentTask, isSubmittingStop);
            socket = connectDpjsSocket(runResult.task_id);
            result.textContent = "DPJS 任务已启动";
            result.className = "form-result success";
            const taskList = await requestJson("/api/dpjs/tasks");
            renderDpjsTasks(taskList.tasks || []);
            currentTask = await loadDpjsTask(runResult.task_id);
            syncDpjsRunButton(currentTask, isSubmittingStop);
        } catch (error) {
            isSubmittingStop = false;
            result.textContent = error.message;
            result.className = "form-result error";
            syncDpjsRunButton(currentTask, isSubmittingStop);
        }
    });

    document.getElementById("dpjs-tasks-body").addEventListener("click", async (event) => {
        const row = event.target.closest("tr[data-task-id]");
        if (!row) return;
        const taskId = row.dataset.taskId;
        if (!taskId) return;
        if (socket) socket.close();
        isSubmittingStop = false;
        socket = connectDpjsSocket(taskId);
        currentTask = await loadDpjsTask(taskId);
        syncDpjsRunButton(currentTask, isSubmittingStop);
    });
}

function renderVideoTasks(tasks) {
    const body = document.getElementById("video-tasks-body");
    if (!body) return;
    if (!tasks || tasks.length === 0) {
        body.innerHTML = `
            <tr>
                <td colspan="4" class="table-empty">暂无视频任务</td>
            </tr>
        `;
        return;
    }
    body.innerHTML = tasks.map((task) => `
        <tr data-task-id="${formatText(task.task_uuid, "")}" class="dpjs-task-row">
            <td><span class="code-text dpjs-inline-scroll dpjs-drag-scroll">${formatText(task.task_uuid)}</span></td>
            <td><span class="${badgeClass(task.status)}">${formatText(task.status)}</span></td>
            <td><span class="dpjs-inline-scroll dpjs-drag-scroll">${formatText(task.target_url)}</span></td>
            <td><span class="dpjs-inline-scroll dpjs-drag-scroll">${formatText(task.created_at)}</span></td>
        </tr>
    `).join("");
    initDpjsHorizontalDragScroll(body);
}

function renderVideoResult(task) {
    const resultEl = document.getElementById("video-result-json");
    const summaryEl = document.getElementById("video-result-summary");
    const targetEl = document.getElementById("video-current-target");
    const updatedEl = document.getElementById("video-updated-at");
    const currentTaskEl = document.getElementById("video-current-task");
    if (!resultEl || !summaryEl || !targetEl || !updatedEl || !currentTaskEl) return;

    if (!task) {
        currentTaskEl.textContent = "-";
        targetEl.textContent = "-";
        updatedEl.textContent = "-";
        summaryEl.textContent = "-";
        resultEl.textContent = "等待任务结果...";
        updateTaskBadge("待命", "", "video-task-status-badge");
        return;
    }

    currentTaskEl.textContent = formatText(task.task_uuid);
    targetEl.textContent = formatText(task.target_url);
    updatedEl.textContent = formatText(task.updated_at || task.created_at);
    summaryEl.textContent = formatText(task.summary || task.status);
    resultEl.textContent = JSON.stringify(task.result_json || {}, null, 2);
    updateTaskBadge(task.status || "待命", task.message || "", "video-task-status-badge");
}

function buildVideoPayload() {
    return {
        page_url: document.getElementById("video-page-url").value,
        platform: document.getElementById("video-platform").value,
        save_dir: document.getElementById("video-save-dir").value,
        max_count: Number(document.getElementById("video-max-count").value || 0),
        quality: document.getElementById("video-quality").value,
        proxy_url: document.getElementById("video-proxy-url").value || null,
        download_media: document.getElementById("video-download-media").checked,
        headless: document.getElementById("video-headless").checked,
        extra_headers: parseJsonField(document.getElementById("video-extra-headers").value, {}),
        notes: document.getElementById("video-notes").value,
    };
}

function setVideoConfig(config) {
    document.getElementById("video-page-url").value = formatText(config.page_url, "");
    document.getElementById("video-platform").value = formatText(config.platform, "douyin");
    document.getElementById("video-save-dir").value = formatText(config.save_dir, "data/video-downloads");
    document.getElementById("video-max-count").value = Number(config.max_count || 20);
    document.getElementById("video-quality").value = formatText(config.quality, "source");
    document.getElementById("video-proxy-url").value = formatText(config.proxy_url, "");
    document.getElementById("video-download-media").checked = config.download_media !== false;
    document.getElementById("video-headless").checked = config.headless !== false;
    document.getElementById("video-extra-headers").value = JSON.stringify(config.extra_headers || { Referer: "", Cookie: "" }, null, 2);
    document.getElementById("video-notes").value = formatText(config.notes, "");
}

function syncVideoRunButton(task, isRunning = false) {
    const runBtn = document.getElementById("video-run-btn");
    if (!runBtn) return;
    const running = isRunning || ["pending", "running"].includes(String(task?.status || "").toLowerCase());
    runBtn.classList.toggle("video-run-btn-active", running);
    runBtn.textContent = running ? "运行中（占位）" : "立即运行";
}

async function copyVideoResult() {
    const content = document.getElementById("video-result-json")?.textContent || "";
    if (!content) throw new Error("当前没有可复制的结果");
    if (!navigator.clipboard?.writeText) {
        throw new Error("当前浏览器不支持剪贴板写入");
    }
    await navigator.clipboard.writeText(content);
}

async function initVideoSpider() {
    const page = document.getElementById("video-spider-page");
    if (!page) return;

    const form = document.getElementById("video-form");
    const result = document.getElementById("video-form-result");
    const runBtn = document.getElementById("video-run-btn");
    const copyBtn = document.getElementById("video-copy-json");
    const demoBtn = document.getElementById("video-load-demo");
    const resultHint = document.getElementById("video-result-hint");

    const sampleConfig = {
        page_url: "https://example.com/channel/demo",
        platform: "bilibili",
        save_dir: "data/video-downloads",
        max_count: 20,
        quality: "1080p",
        proxy_url: "",
        download_media: true,
        headless: true,
        extra_headers: { Referer: "", Cookie: "" },
        notes: "示例任务：抓取最近更新的视频列表",
    };

    const sampleTasks = [
        {
            task_uuid: "video-demo-20260402-001",
            status: "completed",
            target_url: "https://example.com/channel/demo",
            created_at: "2026-04-02 10:15:00",
            updated_at: "2026-04-02 10:18:12",
            summary: "抓取 12 条视频，成功下载 8 条",
            result_json: {
                platform: "bilibili",
                request_count: 12,
                download_count: 8,
                videos: [
                    { title: "示例视频 A", duration: "03:12", quality: "1080p", author: "demo-up" },
                    { title: "示例视频 B", duration: "08:45", quality: "720p", author: "demo-up" }
                ]
            }
        },
        {
            task_uuid: "video-demo-20260401-002",
            status: "running",
            target_url: "https://example.com/video/next",
            created_at: "2026-04-01 18:00:00",
            updated_at: "2026-04-01 18:02:31",
            summary: "正在解析播放地址",
            message: "解析第 3 个视频页面",
            result_json: {
                platform: "douyin",
                progress: "3 / 10"
            }
        },
        {
            task_uuid: "video-demo-20260331-003",
            status: "failed",
            target_url: "https://example.com/private/list",
            created_at: "2026-03-31 21:40:00",
            updated_at: "2026-03-31 21:41:22",
            summary: "Cookie 失效，任务中断",
            message: "请求被平台风控拦截",
            result_json: {
                error: "Cookie expired"
            }
        }
    ];

    let currentTask = sampleTasks[0];
    setVideoConfig(sampleConfig);
    renderVideoTasks(sampleTasks);
    renderVideoResult(currentTask);
    syncVideoRunButton(currentTask);
    initDpjsHorizontalDragScroll(page);
    appendLogToElement("video-log-console", "等待视频任务日志...", "[system] 视频爬虫页面已加载，当前为占位版。");
    appendLogToElement("video-log-console", "等待视频任务日志...", "[hint] 后续可接入真实 /api/video/* 接口和任务 WebSocket。");

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        result.textContent = "已保存占位配置";
        result.className = "form-result success";
        appendLogToElement("video-log-console", "等待视频任务日志...", `[config] 已更新视频任务配置: ${buildVideoPayload().platform}`);
    });

    runBtn.addEventListener("click", async () => {
        const payload = buildVideoPayload();
        currentTask = {
            task_uuid: `video-demo-${Date.now()}`,
            status: "running",
            target_url: payload.page_url,
            created_at: new Date().toLocaleString("zh-CN", { hour12: false }),
            updated_at: new Date().toLocaleString("zh-CN", { hour12: false }),
            summary: "页面占位版：已生成模拟任务",
            message: "尚未接入真实后端",
            result_json: {
                platform: payload.platform,
                max_count: payload.max_count,
                quality: payload.quality,
                download_media: payload.download_media,
                save_dir: payload.save_dir,
                note: "当前页面只提供 UI 结构与占位交互。"
            }
        };
        syncVideoRunButton(currentTask, true);
        renderVideoResult(currentTask);
        result.textContent = "已生成占位任务";
        result.className = "form-result success";
        resultHint.textContent = "当前展示的是模拟任务结果，后续可无缝切换到真实接口。";
        appendLogToElement("video-log-console", "等待视频任务日志...", `[run] 已创建占位任务 ${currentTask.task_uuid}`);
        appendLogToElement("video-log-console", "等待视频任务日志...", `[run] 目标地址: ${payload.page_url || "-"}`);
        window.setTimeout(() => {
            currentTask = {
                ...currentTask,
                status: "completed",
                updated_at: new Date().toLocaleString("zh-CN", { hour12: false }),
                summary: "页面占位版：模拟任务已完成",
                result_json: {
                    ...currentTask.result_json,
                    finished: true,
                    preview_items: [
                        { title: "示例视频 1", status: "downloaded" },
                        { title: "示例视频 2", status: "metadata-only" }
                    ]
                }
            };
            syncVideoRunButton(currentTask);
            renderVideoResult(currentTask);
            appendLogToElement("video-log-console", "等待视频任务日志...", `[status] completed - ${currentTask.summary}`);
        }, 800);
    });

    copyBtn?.addEventListener("click", async () => {
        try {
            await copyVideoResult();
            result.textContent = "结果 JSON 已复制";
            result.className = "form-result success";
        } catch (error) {
            result.textContent = error.message;
            result.className = "form-result error";
        }
    });

    demoBtn?.addEventListener("click", () => {
        currentTask = sampleTasks[0];
        renderVideoResult(currentTask);
        syncVideoRunButton(currentTask);
        appendLogToElement("video-log-console", "等待视频任务日志...", `[demo] 已载入示例任务 ${currentTask.task_uuid}`);
    });

    document.getElementById("video-tasks-body")?.addEventListener("click", (event) => {
        const row = event.target.closest("tr[data-task-id]");
        if (!row) return;
        const taskId = row.dataset.taskId;
        const task = sampleTasks.find((item) => item.task_uuid === taskId);
        if (!task) return;
        currentTask = task;
        renderVideoResult(task);
        syncVideoRunButton(task);
        appendLogToElement("video-log-console", "等待视频任务日志...", `[select] 切换到任务 ${task.task_uuid}`);
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await initDashboard();
        await initSettings();
        await initDpjsSpider();
        await initVideoSpider();
    } catch (error) {
        appendLog(`[error] ${error.message}`);
        const result = document.getElementById("settings-result") || document.getElementById("dpjs-form-result") || document.getElementById("video-form-result");
        if (result) {
            result.textContent = error.message;
            result.className = "form-result error";
        }
    }
});

