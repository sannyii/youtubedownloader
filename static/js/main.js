let currentUrl = '';

// 下载任务管理器 - 使用 localStorage 持久化
const TaskManager = {
    STORAGE_KEY: 'youtube_download_tasks',

    getTasks() {
        const data = localStorage.getItem(this.STORAGE_KEY);
        return data ? JSON.parse(data) : {};
    },

    saveTasks(tasks) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(tasks));
    },

    addTask(taskId, title, quality) {
        const tasks = this.getTasks();
        tasks[taskId] = {
            id: taskId,
            title: title,
            quality: quality,
            status: 'pending',
            progress: 0,
            createdAt: Date.now()
        };
        this.saveTasks(tasks);
        return tasks[taskId];
    },

    updateTask(taskId, updates) {
        const tasks = this.getTasks();
        if (tasks[taskId]) {
            Object.assign(tasks[taskId], updates);
            this.saveTasks(tasks);
        }
        return tasks[taskId];
    },

    removeTask(taskId) {
        const tasks = this.getTasks();
        delete tasks[taskId];
        this.saveTasks(tasks);
    },

    getActiveTasks() {
        const tasks = this.getTasks();
        return Object.values(tasks).filter(t =>
            t.status === 'pending' || t.status === 'downloading'
        );
    },

    getCompletedTasks() {
        const tasks = this.getTasks();
        return Object.values(tasks).filter(t => t.status === 'completed');
    },

    clearCompleted() {
        const tasks = this.getTasks();
        for (const id in tasks) {
            if (tasks[id].status === 'completed' || tasks[id].status === 'error') {
                delete tasks[id];
            }
        }
        this.saveTasks(tasks);
    }
};

// 状态轮询管理
let pollingIntervals = {};

function startPolling(taskId) {
    if (pollingIntervals[taskId]) return;

    pollingIntervals[taskId] = setInterval(() => checkTaskStatus(taskId), 1000);
}

function stopPolling(taskId) {
    if (pollingIntervals[taskId]) {
        clearInterval(pollingIntervals[taskId]);
        delete pollingIntervals[taskId];
    }
}

async function checkTaskStatus(taskId) {
    try {
        const response = await fetch(`/api/status/${taskId}`);
        const data = await response.json();

        if (data.status === 'downloading') {
            TaskManager.updateTask(taskId, {
                status: 'downloading',
                progress: data.progress || 0
            });
        } else if (data.status === 'completed') {
            TaskManager.updateTask(taskId, {
                status: 'completed',
                progress: 100,
                filename: data.filename
            });
            stopPolling(taskId);
        } else if (data.status === 'error') {
            TaskManager.updateTask(taskId, {
                status: 'error',
                error: data.error
            });
            stopPolling(taskId);
        }

        renderTaskQueue();
    } catch (error) {
        console.error('检查状态失败:', error);
    }
}

function renderTaskQueue() {
    const container = document.getElementById('task-queue');
    if (!container) return;

    const activeTasks = TaskManager.getActiveTasks();
    const completedTasks = TaskManager.getCompletedTasks();
    const allTasks = [...activeTasks, ...completedTasks];

    if (allTasks.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    const tasksHtml = allTasks.map(task => {
        const shortTitle = task.title.length > 30
            ? task.title.substring(0, 30) + '...'
            : task.title;

        let statusHtml = '';
        let actionHtml = '';

        if (task.status === 'pending' || task.status === 'downloading') {
            statusHtml = `
                <div class="task-progress">
                    <div class="task-progress-bar" style="width: ${task.progress}%"></div>
                </div>
                <span class="task-percent">${task.progress}%</span>
            `;
        } else if (task.status === 'completed') {
            statusHtml = '<span class="task-status-done">✓ 完成</span>';
            actionHtml = `<button class="task-save-btn" onclick="downloadTaskFile('${task.id}')">保存</button>`;
        } else if (task.status === 'error') {
            statusHtml = '<span class="task-status-error">✗ 失败</span>';
        }

        return `
            <div class="task-item" data-task-id="${task.id}">
                <div class="task-info">
                    <span class="task-title">${shortTitle}</span>
                    <span class="task-quality">${task.quality}</span>
                </div>
                <div class="task-status">
                    ${statusHtml}
                    ${actionHtml}
                    <button class="task-remove-btn" onclick="removeTask('${task.id}')" title="移除">×</button>
                </div>
            </div>
        `;
    }).join('');

    const activeCount = activeTasks.length;
    const headerText = activeCount > 0
        ? `下载队列 (${activeCount} 个进行中)`
        : '下载队列';

    container.innerHTML = `
        <div class="task-queue-header">
            <span>${headerText}</span>
            ${completedTasks.length > 0 ? '<button class="clear-completed-btn" onclick="clearCompleted()">清除已完成</button>' : ''}
        </div>
        <div class="task-list">
            ${tasksHtml}
        </div>
    `;
}

function downloadTaskFile(taskId) {
    window.location.href = `/api/file/${taskId}`;
}

function removeTask(taskId) {
    stopPolling(taskId);
    TaskManager.removeTask(taskId);
    renderTaskQueue();
}

function clearCompleted() {
    TaskManager.clearCompleted();
    renderTaskQueue();
}

// 初始化 - 恢复未完成的任务轮询
function initTaskManager() {
    const activeTasks = TaskManager.getActiveTasks();
    activeTasks.forEach(task => {
        startPolling(task.id);
    });
    renderTaskQueue();
}

async function fetchVideoInfo() {
    const urlInput = document.getElementById('url-input');
    const fetchBtn = document.getElementById('fetch-btn');
    const videoInfo = document.getElementById('video-info');
    const fetchLoading = document.getElementById('fetch-loading');

    const url = urlInput.value.trim();

    if (!url) {
        showError('请输入YouTube视频链接');
        return;
    }

    if (!isValidYouTubeUrl(url)) {
        showError('请输入有效的YouTube视频链接');
        return;
    }

    hideError();
    videoInfo.classList.add('hidden');

    fetchBtn.disabled = true;
    fetchBtn.textContent = '获取中...';
    fetchLoading.classList.remove('hidden');

    try {
        const response = await fetch('/api/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || '获取视频信息失败');
        }

        currentUrl = url;
        displayVideoInfo(data);

    } catch (error) {
        showError(error.message);
    } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = '获取视频';
        fetchLoading.classList.add('hidden');
    }
}

function displayVideoInfo(info) {
    const videoInfo = document.getElementById('video-info');
    const thumbnail = document.getElementById('thumbnail');
    const title = document.getElementById('video-title');
    const duration = document.getElementById('video-duration');
    const qualitySelect = document.getElementById('quality');

    thumbnail.src = info.thumbnail || '/static/img/placeholder.png';
    title.textContent = info.title;
    duration.textContent = formatDuration(info.duration);

    qualitySelect.innerHTML = '';
    info.formats.forEach(format => {
        const option = document.createElement('option');
        option.value = format.quality;

        let sizeText = '';
        if (format.size > 0) {
            const sizeMB = (format.size / (1024 * 1024)).toFixed(1);
            sizeText = ` (约 ${sizeMB} MB)`;
        }

        option.textContent = format.quality + sizeText;
        qualitySelect.appendChild(option);
    });

    videoInfo.classList.remove('hidden');
}

async function startDownload() {
    const downloadBtn = document.getElementById('download-btn');
    const quality = document.getElementById('quality').value;
    const title = document.getElementById('video-title').textContent;

    downloadBtn.disabled = true;
    downloadBtn.textContent = '添加中...';

    try {
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: currentUrl,
                quality,
                title: title
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || '下载请求失败');
        }

        // 添加到任务队列
        TaskManager.addTask(data.task_id, title, quality);
        startPolling(data.task_id);
        renderTaskQueue();

        // 清空输入，准备下一个
        document.getElementById('url-input').value = '';
        document.getElementById('video-info').classList.add('hidden');
        currentUrl = '';

    } catch (error) {
        showError(error.message);
    } finally {
        downloadBtn.disabled = false;
        downloadBtn.textContent = '下载视频';
    }
}

function isValidYouTubeUrl(url) {
    const patterns = [
        /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]+/,
        /^(https?:\/\/)?youtu\.be\/[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/embed\/[\w-]+/
    ];
    return patterns.some(pattern => pattern.test(url));
}

function formatDuration(seconds) {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) {
        return `时长: ${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `时长: ${m}:${String(s).padStart(2, '0')}`;
}

function showError(message) {
    const errorElement = document.getElementById('error-message');
    errorElement.textContent = message;
    errorElement.classList.add('show');
}

function hideError() {
    const errorElement = document.getElementById('error-message');
    errorElement.classList.remove('show');
}

// 页面加载初始化
document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('url-input');
    if (urlInput) {
        urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                fetchVideoInfo();
            }
        });
    }

    // 初始化任务管理器
    initTaskManager();
});
