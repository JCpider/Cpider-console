const VIDEO_HINT_TEXT = "当前仅支持 bilibili 单视频页；Cookie 非必填，失败后再补 Cookie。";

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

function isTaskRunning(status) {
    return ["pending", "running"].includes(String(status || "").toLowerCase());
}

function isTaskTerminal(status) {
    return ["completed", "failed", "cancelled"].includes(String(status || "").toLowerCase());
}

function renderTaskRows(tasks, { bodyId, columns, emptyText, rowClass = "", includeTaskId = false }) {
    const body = document.getElementById(bodyId);
    if (!body) return;
    if (!tasks || tasks.length === 0) {
        body.innerHTML = `
            <tr>
                <td colspan="${columns}" class="table-empty">${escapeHtml(emptyText)}</td>
            </tr>
        `;
        return;
    }
    body.innerHTML = tasks.map((task) => {
        const taskId = String(task.task_uuid ?? "");
        const dataTaskId = includeTaskId ? ` data-task-id="${escapeHtml(taskId)}"` : "";
        const rowClassAttr = rowClass ? ` class="${rowClass}"` : "";
        return `
        <tr${dataTaskId}${rowClassAttr}>
            ${task.cells.map((cell) => `
                <td><span class="${cell.className}">${escapeHtml(formatText(cell.value))}</span></td>
            `).join("")}
        </tr>
    `;
    }).join("");
    initDpjsHorizontalDragScroll(body);
}

function renderRecentTasks(tasks) {
    renderTaskRows(
        (tasks || []).map((task) => ({
            task_uuid: task.task_uuid,
            cells: [
                { className: "code-text dpjs-inline-scroll dpjs-drag-scroll", value: task.task_uuid },
                { className: "dpjs-inline-scroll dpjs-drag-scroll", value: task.task_type },
                { className: badgeClass(task.status), value: task.status },
                { className: "dpjs-inline-scroll dpjs-drag-scroll", value: task.target_url },
                { className: "dpjs-inline-scroll dpjs-drag-scroll", value: task.created_at },
            ],
        })),
        { bodyId: "recent-tasks-body", columns: 5, emptyText: "暂无任务记录" },
    );
}

function renderDpjsTasks(tasks) {
    renderTaskRows(
        (tasks || []).map((task) => ({
            task_uuid: task.task_uuid,
            cells: [
                { className: "code-text dpjs-inline-scroll dpjs-drag-scroll", value: task.task_uuid },
                { className: badgeClass(task.status), value: task.status },
                { className: "dpjs-inline-scroll dpjs-drag-scroll", value: task.target_url },
                { className: "dpjs-inline-scroll dpjs-drag-scroll", value: task.created_at },
            ],
        })),
        { bodyId: "dpjs-tasks-body", columns: 4, emptyText: "暂无 DPJS 任务", rowClass: "dpjs-task-row", includeTaskId: true },
    );
}

function updateTaskBadge(status, message, elementId = "task-status-badge") {
    const badge = document.getElementById(elementId);
    if (!badge) return;
    const text = message ? `${status} · ${message}` : status;
    badge.className = badgeClass(status);
    badge.textContent = text || "待命";
}

function updateTaskResultMessage(resultEl, task, messages = {}) {
    if (!resultEl || !task) return;
    const status = String(task.status || "").toLowerCase();
    if (status === "completed") {
        resultEl.textContent = messages.completed || "任务已完成";
        resultEl.className = "form-result success";
        return;
    }
    if (status === "cancelled") {
        resultEl.textContent = task.message || messages.cancelled || "任务已取消";
        resultEl.className = "form-result";
        return;
    }
    if (status === "failed") {
        resultEl.textContent = task.error_message || task.message || messages.failed || "任务失败";
        resultEl.className = "form-result error";
    }
}

function buildRunningTask(task, message) {
    return {
        ...task,
        status: "running",
        message,
    };
}

async function refreshTaskListAndDashboard(listPath, renderTasks) {
    const [list] = await Promise.all([
        requestJson(listPath),
        loadDashboardSummary(),
    ]);
    renderTasks(list.tasks || []);
}

function isDpjsTaskStopping(task) {
    if (!task) return false;
    const message = String(task.message || task.error_message || "").toLowerCase();
    return isTaskRunning(task.status) && message.includes("stopping");
}

function syncDpjsRunButton(task, isSubmittingStop = false) {
    const runBtn = document.getElementById("dpjs-run-btn");
    if (!runBtn) return;
    const running = isTaskRunning(task?.status);
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

    let socket = connectTaskSocket(input.value, {
        onStatus: async (payload) => {
            if (isTaskTerminal(payload.status)) {
                await loadDashboardSummary();
            }
        },
    });
    button.addEventListener("click", async () => {
        if (socket) socket.close();
        socket = connectTaskSocket(input.value, {
            onStatus: async (payload) => {
                if (isTaskTerminal(payload.status)) {
                    await loadDashboardSummary();
                }
            },
        });
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

function formatDpjsParseText(value) {
    const parseValue = Array.isArray(value) && value.length > 0 ? value : [
        {
            engine: "json",
            rules: {
                data: {},
            },
            mapping: {
                "": { default: "" },
            },
        },
    ];
    return JSON.stringify(parseValue, null, 2);
}

function bindTextareaTabIndent(textarea) {
    if (!textarea || textarea.dataset.tabIndentBound === "1") return;
    textarea.addEventListener("keydown", (event) => {
        if (event.key !== "Tab") return;
        event.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = textarea.value;
        const indent = "    ";
        if (event.shiftKey) {
            const lineStart = value.lastIndexOf("\n", start - 1) + 1;
            const selected = value.slice(lineStart, end);
            const updated = selected.replace(/(^|\n) {1,4}/g, "$1");
            textarea.value = value.slice(0, lineStart) + updated + value.slice(end);
            textarea.selectionStart = lineStart;
            textarea.selectionEnd = lineStart + updated.length;
            return;
        }
        if (start !== end && value.slice(start, end).includes("\n")) {
            const lineStart = value.lastIndexOf("\n", start - 1) + 1;
            const selected = value.slice(lineStart, end);
            const updated = selected.replace(/(^|\n)/g, `$1${indent}`);
            textarea.value = value.slice(0, lineStart) + updated + value.slice(end);
            textarea.selectionStart = lineStart;
            textarea.selectionEnd = lineStart + updated.length;
            return;
        }
        textarea.value = value.slice(0, start) + indent + value.slice(end);
        textarea.selectionStart = textarea.selectionEnd = start + indent.length;
    });
    textarea.dataset.tabIndentBound = "1";
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
    const parseConfig = Array.isArray(resultJson.parse) ? resultJson.parse : [];
    if (parseConfig.length === 0) {
        parsedEl.textContent = "未配置 parse";
        summaryEl.textContent = "parse disabled";
        return;
    }

    const results = Array.isArray(resultJson.results) ? resultJson.results : [];
    const currentIndex = Math.max(0, pageIndex);
    const currentResult = results[currentIndex] || null;
    const parsed = currentResult?.parsed || null;
    const itemsMap = resultJson.items && typeof resultJson.items === "object" ? resultJson.items : {};
    const pageItems = Array.isArray(itemsMap[String(currentIndex + 1)]) ? itemsMap[String(currentIndex + 1)] : [];

    parsedEl.textContent = JSON.stringify(parsed?.items || pageItems, null, 2);

    const totalItems = Number(resultJson.item_count || 0);
    const parsedStatus = parsed?.ok === false ? ` · error: ${formatText(parsed.error)}` : "";
    summaryEl.textContent = `parse config · total ${totalItems} items · current ${pageItems.length} items${parsedStatus}`;
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
        parse: parseJsonField(document.getElementById("dpjs-parse").value, []),
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
    document.getElementById("dpjs-parse").value = formatDpjsParseText(config.parse || []);
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
            resultEl.textContent = JSON.stringify(currentResult?.body ?? currentResult ?? {}, null, 2);
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
    const downloadJsonBtn = document.getElementById("dpjs-download-json");
    const downloadTxtBtn = document.getElementById("dpjs-download-txt");
    let socket = null;
    let currentTask = null;
    let isSubmittingStop = false;
    initDpjsHorizontalDragScroll(page);
    [
        document.getElementById("dpjs-request-template"),
        document.getElementById("dpjs-request-variables"),
        document.getElementById("dpjs-parse"),
    ].forEach(bindTextareaTabIndent);

    const updateDpjsResultMessage = (task) => {
        updateTaskResultMessage(result, task, {
            completed: "DPJS 任务已完成",
            cancelled: "DPJS 任务已取消",
            failed: "DPJS 任务失败",
        });
    };

    const connectDpjsSocket = (taskId) => connectTaskSocket(taskId, {
        onStatus: async (payload) => {
            if (!currentTask || currentTask.task_uuid !== taskId) return;
            currentTask = {
                ...currentTask,
                status: payload.status,
                message: payload.message || currentTask.message,
                error_message: payload.error_message || currentTask.error_message,
                started_at: payload.started_at || currentTask.started_at,
                completed_at: payload.completed_at || currentTask.completed_at,
            };
            if (isTaskTerminal(payload.status)) {
                isSubmittingStop = false;
                currentTask = await loadDpjsTask(taskId);
                await refreshTaskListAndDashboard("/api/dpjs/tasks", renderDpjsTasks);
                updateDpjsResultMessage(currentTask);
            } else {
                renderDpjsResult(currentTask);
                updateDpjsResultMessage(currentTask);
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
            currentTask = buildRunningTask(runResult.task, "DPJS task started");
            isSubmittingStop = false;
            document.getElementById("log-console").textContent = "等待任务日志...";
            document.getElementById("summary-current-task").textContent = runResult.task_id;
            renderDpjsResult(currentTask);
            syncDpjsRunButton(currentTask, isSubmittingStop);
            socket = connectDpjsSocket(runResult.task_id);
            result.textContent = "DPJS 任务已启动";
            result.className = "form-result success";
            updateDpjsResultMessage(currentTask);
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
    renderTaskRows(
        (tasks || []).map((task) => ({
            task_uuid: task.task_uuid,
            cells: [
                { className: "code-text dpjs-inline-scroll dpjs-drag-scroll", value: task.task_uuid },
                { className: badgeClass(task.status), value: task.status },
                { className: "dpjs-inline-scroll dpjs-drag-scroll", value: task.target_url },
                { className: "dpjs-inline-scroll dpjs-drag-scroll", value: task.created_at },
            ],
        })),
        { bodyId: "video-tasks-body", columns: 4, emptyText: "暂无视频任务", rowClass: "dpjs-task-row", includeTaskId: true },
    );
}

function loadVideoSummary(task) {
    if (!task) {
        return { updatedAt: "-", summary: "-", resultJson: {} };
    }
    const resultJson = task.result_json || {};
    const itemCount = Number(resultJson.item_count || 0);
    const downloadCount = Number(resultJson.download_count || 0);
    const errorCount = Array.isArray(resultJson.errors) ? resultJson.errors.length : 0;
    const updatedAt = formatText(task.completed_at || task.started_at || task.updated_at || task.created_at);
    const summaryParts = [
        `status=${formatText(task.status)}`,
        `items=${itemCount}`,
        `downloaded=${downloadCount}`,
    ];
    if (task.error_message) {
        summaryParts.push(`error=${formatText(task.error_message)}`);
    } else if (errorCount > 0) {
        summaryParts.push(`errors=${errorCount}`);
    }
    return { updatedAt, summary: summaryParts.join(" · "), resultJson };
}

async function loadVideoTask(taskId) {
    const data = await requestJson(`/api/video/tasks/${encodeURIComponent(taskId)}`);
    if (!data.ok || !data.task) return null;

    const task = data.task;
    renderVideoResult(task);

    const consoleEl = document.getElementById("video-log-console");
    if (consoleEl) {
        consoleEl.textContent = data.logs && data.logs.length
            ? data.logs.map((item) => item.message).join("\n")
            : "等待视频任务日志...";
    }
    return task;
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

    const { updatedAt, summary, resultJson } = loadVideoSummary(task);
    currentTaskEl.textContent = formatText(task.task_uuid);
    targetEl.textContent = formatText(task.target_url);
    updatedEl.textContent = updatedAt;
    summaryEl.textContent = summary;

    if (Object.keys(resultJson).length > 0) {
        resultEl.textContent = JSON.stringify(resultJson, null, 2);
    } else if (task.error_message) {
        resultEl.textContent = task.error_message;
    } else {
        resultEl.textContent = "等待任务结果...";
    }

    updateTaskBadge(task.status || "待命", task.message || task.error_message || "", "video-task-status-badge");
}

function buildVideoPayload() {
    const platformSelect = document.getElementById("video-platform");
    const customPlatformInput = document.getElementById("video-platform-custom");
    const rawPlatform = platformSelect?.value || "video:generic";
    const customPlatform = (customPlatformInput?.value || "").trim();
    const platform = customPlatform || rawPlatform;

    return {
        page_url: document.getElementById("video-page-url").value,
        platform,
        save_dir: document.getElementById("video-save-dir").value,
        max_count: Number(document.getElementById("video-max-count").value || 0),
        quality: document.getElementById("video-quality").value,
        proxy_url: document.getElementById("video-proxy-url").value || null,
        download_media: document.getElementById("video-download-media").checked,
        headless: document.getElementById("video-headless").checked,
        extra_headers: parseJsonField(document.getElementById("video-extra-headers").value, {}),
        notes: document.getElementById("video-notes").value,
        parser_enabled: document.getElementById("video-parser-enabled")?.checked ?? false,
        parser_code: document.getElementById("video-parser-code")?.value ?? "",
    };
}

function readVideoPayload() {
    try {
        return { ok: true, payload: buildVideoPayload() };
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
}

function getVideoPlatformCode(config) {
    const platform = String(config?.platform || "").trim();
    if (platform.startsWith("video:")) return platform;
    const adapterType = String(config?.adapter?.type || "").trim();
    const candidate = adapterType && adapterType !== "generic" ? adapterType : (platform || "bilibili");
    return `video:${candidate}`;
}

function setVideoConfig(config) {
    const download = config.download || {};
    const request = config.request || {};
    const parser = config.parser || {};
    const runtime = config.runtime || {};

    document.getElementById("video-page-url").value = formatText(runtime.page_url || config.page_url_template, "");
    document.getElementById("video-save-dir").value = formatText(download.save_dir, "data/video-downloads");
    document.getElementById("video-max-count").value = Math.max(1, Number(download.max_count || 1));
    document.getElementById("video-quality").value = formatText(download.quality, "source");
    document.getElementById("video-proxy-url").value = formatText(request.proxy_url, "");
    document.getElementById("video-download-media").checked = (download.mode || "file") === "file";
    document.getElementById("video-headless").checked = request.headless !== false;
    document.getElementById("video-extra-headers").value = JSON.stringify(request.extra_headers || { Referer: "", Cookie: "" }, null, 2);
    document.getElementById("video-notes").value = formatText(config.notes, "");

    const platformSelect = document.getElementById("video-platform");
    if (platformSelect) {
        platformSelect.value = getVideoPlatformCode(config);
    }

    const parserEnabledEl = document.getElementById("video-parser-enabled");
    const parserCodeEl = document.getElementById("video-parser-code");
    if (parserEnabledEl) parserEnabledEl.checked = !!parser.enabled;
    if (parserCodeEl) parserCodeEl.value = formatText(parser.code, parserCodeEl.value || "");
}

function isVideoTaskStopping(task) {
    if (!task) return false;
    const message = String(task.message || task.error_message || "").toLowerCase();
    return isTaskRunning(task.status) && message.includes("stopping");
}

function syncVideoRunButton(task, isSubmittingStop = false) {
    const runBtn = document.getElementById("video-run-btn");
    if (!runBtn) return;
    const running = isTaskRunning(task?.status);
    const stopping = isSubmittingStop || isVideoTaskStopping(task);

    runBtn.classList.toggle("video-run-btn-active", running || stopping);
    runBtn.disabled = stopping;
    runBtn.textContent = stopping ? "停止中..." : running ? "停止运行" : "立即运行";
    runBtn.dataset.mode = running ? "stop" : "run";
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
    const resultHint = document.getElementById("video-result-hint");
    let socket = null;
    let currentTask = null;
    let isSubmittingStop = false;
    let statusPollTimer = null;

    initDpjsHorizontalDragScroll(page);

    const stopVideoStatusPoll = () => {
        if (statusPollTimer) {
            clearInterval(statusPollTimer);
            statusPollTimer = null;
        }
    };

    const updateVideoResultMessage = (task) => {
        updateTaskResultMessage(result, task, {
            completed: "视频任务已完成",
            cancelled: "视频任务已取消",
            failed: "视频任务失败",
        });
    };

        const refreshVideoTaskViews = async (taskId) => {
        currentTask = await loadVideoTask(taskId);
        await refreshTaskListAndDashboard("/api/video/tasks", renderVideoTasks);
        syncVideoRunButton(currentTask, isSubmittingStop);
        updateVideoResultMessage(currentTask);
    };

    const startVideoStatusPoll = (taskId) => {
        stopVideoStatusPoll();
        statusPollTimer = setInterval(async () => {
            if (!currentTask || currentTask.task_uuid !== taskId) {
                stopVideoStatusPoll();
                return;
            }
            if (!isTaskRunning(currentTask.status)) {
                stopVideoStatusPoll();
                return;
            }
            try {
                const nextTask = await loadVideoTask(taskId);
                if (!nextTask || currentTask?.task_uuid !== taskId) {
                    stopVideoStatusPoll();
                    return;
                }
                currentTask = nextTask;
                syncVideoRunButton(currentTask, isSubmittingStop);
                if (isTaskTerminal(currentTask.status)) {
                    isSubmittingStop = false;
                    await refreshVideoTaskViews(taskId);
                    stopVideoStatusPoll();
                }
            } catch {
            }
        }, 1500);
    };

    const connectVideoSocket = (taskId) => connectTaskSocket(taskId, {
        onLog: (payload) => {
            appendLogToElement("video-log-console", "等待视频任务日志...", payload.message);
        },
        onStatus: async (payload) => {
            const status = payload.status || "待命";
            const message = payload.message || "";
            updateTaskBadge(status, message, "video-task-status-badge");
            if (!currentTask || currentTask.task_uuid !== taskId) return;
            currentTask = {
                ...currentTask,
                status: payload.status || currentTask.status,
                message: payload.message || currentTask.message,
                error_message: payload.error_message || currentTask.error_message,
                started_at: payload.started_at || currentTask.started_at,
                completed_at: payload.completed_at || currentTask.completed_at,
                target_url: payload.target_url || currentTask.target_url,
            };
            if (isTaskTerminal(payload.status)) {
                isSubmittingStop = false;
                await refreshVideoTaskViews(taskId);
                stopVideoStatusPoll();
            } else {
                renderVideoResult(currentTask);
                syncVideoRunButton(currentTask, isSubmittingStop);
                updateVideoResultMessage(currentTask);
            }
        },
    });

    try {
        const initial = await requestJson("/api/video");
        const platforms = initial.platforms || [];
        const active = initial.active_platform || platforms[0] || null;
        const config = initial.config || {};

        const platformSelect = document.getElementById("video-platform");
        const customPlatformInput = document.getElementById("video-platform-custom");
        if (platformSelect) {
            const defaultOptions = [{ code: "video:bilibili", name: "Bilibili" }];
            const optionSource = platforms.length > 0 ? platforms : defaultOptions;
            platformSelect.innerHTML = optionSource.map((site) => `
                <option value="${escapeHtml(site.code)}">
                    ${escapeHtml(site.name || site.code)}
                </option>
            `).join("");
            if (active?.code) {
                platformSelect.value = active.code;
            } else {
                platformSelect.value = "video:bilibili";
            }
        }
        if (customPlatformInput) {
            customPlatformInput.value = "";
        }

        setVideoConfig(config);
        renderVideoTasks(initial.recent_tasks || []);
        if (initial.recent_tasks && initial.recent_tasks.length > 0) {
            currentTask = await loadVideoTask(initial.recent_tasks[0].task_uuid);
            if (isTaskRunning(currentTask?.status)) {
                socket = connectVideoSocket(currentTask.task_uuid);
                startVideoStatusPoll(currentTask.task_uuid);
            }
            syncVideoRunButton(currentTask, isSubmittingStop);
        } else {
            renderVideoResult(null);
            syncVideoRunButton(null, isSubmittingStop);
        }
        resultHint.textContent = VIDEO_HINT_TEXT;
    } catch (error) {
        if (result) {
            result.textContent = error.message;
            result.className = "form-result error";
        }
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        result.textContent = "保存中...";
        result.className = "form-result";
        try {
            const payloadResult = readVideoPayload();
            if (!payloadResult.ok) {
                result.textContent = payloadResult.message;
                result.className = "form-result error";
                return;
            }
            const saveResult = await requestJson("/api/video/config", {
                method: "PUT",
                body: JSON.stringify(payloadResult.payload),
            });
            result.textContent = saveResult.ok ? "视频配置已保存" : "保存失败";
            result.className = `form-result ${saveResult.ok ? "success" : "error"}`;
            if (saveResult.config) {
                setVideoConfig(saveResult.config);
            }
        } catch (error) {
            result.textContent = error.message;
            result.className = "form-result error";
        }
    });

    runBtn.addEventListener("click", async () => {
        const taskId = currentTask?.task_uuid;
        if (runBtn.dataset.mode === "stop" && taskId) {
            result.textContent = "停止中...";
            result.className = "form-result";
            isSubmittingStop = true;
            syncVideoRunButton(currentTask, isSubmittingStop);
            try {
                const stopResult = await requestJson(`/api/video/tasks/${encodeURIComponent(taskId)}/cancel`, {
                    method: "POST",
                });
                currentTask = {
                    ...currentTask,
                    status: stopResult.status === "cancelling" ? (currentTask?.status || "running") : currentTask?.status,
                    message: stopResult.status === "cancelling" ? "Video task stopping" : currentTask?.message,
                };
                renderVideoResult(currentTask);
                result.textContent = stopResult.ok ? "已提交停止请求" : (stopResult.message || "停止失败");
                result.className = `form-result ${stopResult.ok ? "success" : "error"}`;
                syncVideoRunButton(currentTask, isSubmittingStop);
                if (stopResult.ok) {
                    startVideoStatusPoll(taskId);
                } else {
                    isSubmittingStop = false;
                    currentTask = await loadVideoTask(taskId);
                    syncVideoRunButton(currentTask, isSubmittingStop);
                }
            } catch (error) {
                isSubmittingStop = false;
                result.textContent = error.message;
                result.className = "form-result error";
                syncVideoRunButton(currentTask, isSubmittingStop);
            }
            return;
        }

        result.textContent = "运行中...";
        result.className = "form-result";
        try {
            const payloadResult = readVideoPayload();
            if (!payloadResult.ok) {
                result.textContent = payloadResult.message;
                result.className = "form-result error";
                return;
            }
            const runResult = await requestJson("/api/video/run", {
                method: "POST",
                body: JSON.stringify(payloadResult.payload),
            });
            if (socket) socket.close();
            stopVideoStatusPoll();
            currentTask = buildRunningTask(runResult.task, "Video task started");
            isSubmittingStop = false;
            document.getElementById("video-log-console").textContent = "等待视频任务日志...";
            renderVideoResult(currentTask);
            syncVideoRunButton(currentTask, isSubmittingStop);
            socket = connectVideoSocket(runResult.task_id);
            startVideoStatusPoll(runResult.task_id);
            result.textContent = "视频任务已启动";
            result.className = "form-result success";
            const list = await requestJson("/api/video/tasks");
            renderVideoTasks(list.tasks || []);
            currentTask = await loadVideoTask(runResult.task_id);
            syncVideoRunButton(currentTask, isSubmittingStop);
        } catch (error) {
            isSubmittingStop = false;
            result.textContent = error.message;
            result.className = "form-result error";
            syncVideoRunButton(currentTask, isSubmittingStop);
        }
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

    document.getElementById("video-tasks-body")?.addEventListener("click", async (event) => {
        const row = event.target.closest("tr[data-task-id]");
        if (!row) return;
        const taskId = row.dataset.taskId;
        if (!taskId) return;
        if (socket) socket.close();
        stopVideoStatusPoll();
        isSubmittingStop = false;
        socket = connectVideoSocket(taskId);
        currentTask = await loadVideoTask(taskId);
        if (isTaskRunning(currentTask?.status)) {
            startVideoStatusPoll(taskId);
        }
        syncVideoRunButton(currentTask, isSubmittingStop);
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

