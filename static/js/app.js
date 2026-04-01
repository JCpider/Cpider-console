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
    const consoleEl = document.getElementById("log-console");
    if (!consoleEl) return;
    if (consoleEl.textContent === "等待任务日志...") {
        consoleEl.textContent = message;
    } else {
        consoleEl.textContent += `\n${message}`;
    }
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

function formatText(value, fallback = "-") {
    if (value === null || value === undefined || value === "") return fallback;
    return String(value);
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
            <td class="code-text">${formatText(task.task_uuid)}</td>
            <td>${formatText(task.task_type)}</td>
            <td><span class="${badgeClass(task.status)}">${formatText(task.status)}</span></td>
            <td>${formatText(task.target_url)}</td>
            <td>${formatText(task.created_at)}</td>
        </tr>
    `).join("");
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

function updateTaskBadge(status, message) {
    const badge = document.getElementById("task-status-badge");
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
    const raw = typeof value === "string" ? value : JSON.stringify(value || {});
    let inString = false;
    let escaped = false;
    let formatted = "";

    for (const char of raw) {
        formatted += char;
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\" && inString) {
            escaped = true;
            continue;
        }
        if (char === "\"") {
            inString = !inString;
            continue;
        }
        if (char === "," && !inString) {
            formatted += "\n";
        }
    }

    return formatted;
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
    const summary = document.getElementById("dpjs-result-summary")?.textContent || "-";
    const content = [
        `任务 ID: ${formatText(task.task_uuid)}`,
        `状态: ${formatText(task.status)}`,
        `目标 URL: ${formatText(task.target_url)}`,
        `创建时间: ${formatText(task.created_at)}`,
        `最近更新时间: ${formatText(task.updated_at || task.completed_at || task.started_at)}`,
        `结果摘要: ${summary}`,
        task.error_message ? `错误信息: ${task.error_message}` : null,
        "",
        "结果内容:",
        resultPreview,
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
        updateDpjsDownloadButtons(null);
        return;
    }

    if (task.result_json && Object.keys(task.result_json).length > 0) {
        const results = Array.isArray(task.result_json.results) ? task.result_json.results : [];
        const requestCount = Number(task.result_json.request_count || results.length || 0);
        if (results.length > 0) {
            const currentIndex = Math.min(Math.max(pageIndex, 0), results.length - 1);
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
            const saveResult = await requestJson("/api/dpjs/config", {
                method: "PUT",
                body: JSON.stringify(buildDpjsPayload()),
            });
            result.textContent = saveResult.ok ? "DPJS 配置已保存" : "保存失败";
            result.className = `form-result ${saveResult.ok ? "success" : "error"}`;
            setDpjsConfig(saveResult.config || buildDpjsPayload());
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

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await initDashboard();
        await initSettings();
        await initDpjsSpider();
    } catch (error) {
        appendLog(`[error] ${error.message}`);
        const result = document.getElementById("settings-result") || document.getElementById("dpjs-form-result");
        if (result) {
            result.textContent = error.message;
            result.className = "form-result error";
        }
    }
});
