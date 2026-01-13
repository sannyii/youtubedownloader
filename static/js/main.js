let currentUrl = '';
let currentTaskId = null;
let statusCheckInterval = null;

async function fetchVideoInfo() {
    const urlInput = document.getElementById('url-input');
    const fetchBtn = document.getElementById('fetch-btn');
    const errorMessage = document.getElementById('error-message');
    const videoInfo = document.getElementById('video-info');
    const downloadProgress = document.getElementById('download-progress');

    const url = urlInput.value.trim();

    if (!url) {
        showError('请输入YouTube视频链接');
        return;
    }

    // 验证URL格式
    if (!isValidYouTubeUrl(url)) {
        showError('请输入有效的YouTube视频链接');
        return;
    }

    // 隐藏之前的信息
    hideError();
    videoInfo.classList.add('hidden');
    downloadProgress.classList.add('hidden');

    // 显示加载状态
    fetchBtn.disabled = true;
    fetchBtn.textContent = '获取中...';

    try {
        const response = await fetch('/api/info', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
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

    // 填充清晰度选项
    qualitySelect.innerHTML = '';
    info.formats.forEach(format => {
        const option = document.createElement('option');
        option.value = format.quality;
        option.textContent = format.quality;
        qualitySelect.appendChild(option);
    });

    videoInfo.classList.remove('hidden');
}

async function startDownload() {
    const downloadBtn = document.getElementById('download-btn');
    const quality = document.getElementById('quality').value;
    const downloadProgress = document.getElementById('download-progress');
    const progressText = document.getElementById('progress-text');
    const progressPercent = document.getElementById('progress-percent');
    const progressFill = document.getElementById('progress-fill');
    const downloadFileBtn = document.getElementById('download-file-btn');

    downloadBtn.disabled = true;
    downloadBtn.textContent = '开始下载...';

    // 显示进度区域
    downloadProgress.classList.remove('hidden');
    downloadFileBtn.classList.add('hidden');
    progressText.textContent = '准备下载...';
    progressPercent.textContent = '0%';
    progressFill.style.width = '0%';

    try {
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url: currentUrl, quality }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || '下载请求失败');
        }

        currentTaskId = data.task_id;
        progressText.textContent = '正在下载...';

        // 开始轮询下载状态
        statusCheckInterval = setInterval(checkDownloadStatus, 1000);

    } catch (error) {
        showError(error.message);
        downloadBtn.disabled = false;
        downloadBtn.textContent = '下载视频';
    }
}

async function checkDownloadStatus() {
    if (!currentTaskId) return;

    try {
        const response = await fetch(`/api/status/${currentTaskId}`);
        const data = await response.json();

        const progressText = document.getElementById('progress-text');
        const progressPercent = document.getElementById('progress-percent');
        const progressFill = document.getElementById('progress-fill');
        const downloadBtn = document.getElementById('download-btn');
        const downloadFileBtn = document.getElementById('download-file-btn');

        if (data.status === 'downloading') {
            const progress = data.progress || 0;
            progressPercent.textContent = `${progress}%`;
            progressFill.style.width = `${progress}%`;
            progressText.textContent = '正在下载...';

        } else if (data.status === 'completed') {
            clearInterval(statusCheckInterval);
            statusCheckInterval = null;

            progressPercent.textContent = '100%';
            progressFill.style.width = '100%';
            progressText.textContent = '下载完成!';

            downloadBtn.disabled = false;
            downloadBtn.textContent = '下载视频';
            downloadFileBtn.classList.remove('hidden');

        } else if (data.status === 'error') {
            clearInterval(statusCheckInterval);
            statusCheckInterval = null;

            showError(data.error || '下载失败');
            downloadBtn.disabled = false;
            downloadBtn.textContent = '下载视频';
        }

    } catch (error) {
        console.error('检查状态失败:', error);
    }
}

function downloadFile() {
    if (currentTaskId) {
        window.location.href = `/api/file/${currentTaskId}`;
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

// 回车键触发获取
document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('url-input');
    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            fetchVideoInfo();
        }
    });
});
