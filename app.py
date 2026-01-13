import os
import uuid
import threading
from flask import Flask, render_template, request, jsonify, send_file
from flask_cors import CORS
import yt_dlp

app = Flask(__name__)
CORS(app)

DOWNLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'downloads')
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# 存储下载任务状态
download_tasks = {}


def get_video_info(url):
    """获取视频信息和可用格式"""
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

        # 筛选出720p及以上的格式
        formats = []
        seen_qualities = set()

        for f in info.get('formats', []):
            height = f.get('height')
            if height and height >= 720:
                quality = f'{height}p'
                if quality not in seen_qualities:
                    seen_qualities.add(quality)
                    formats.append({
                        'quality': quality,
                        'height': height,
                        'ext': 'mp4'
                    })

        # 按清晰度排序
        formats.sort(key=lambda x: x['height'], reverse=True)

        # 如果没有找到格式，添加默认的720p和1080p选项
        if not formats:
            formats = [
                {'quality': '1080p', 'height': 1080, 'ext': 'mp4'},
                {'quality': '720p', 'height': 720, 'ext': 'mp4'}
            ]

        return {
            'title': info.get('title', 'Unknown'),
            'thumbnail': info.get('thumbnail', ''),
            'duration': info.get('duration', 0),
            'formats': formats
        }


def download_video_task(task_id, url, quality):
    """后台下载任务"""
    try:
        download_tasks[task_id]['status'] = 'downloading'

        height = int(quality.replace('p', ''))
        output_path = os.path.join(DOWNLOAD_DIR, f'{task_id}.%(ext)s')

        ydl_opts = {
            'format': f'bestvideo[height<={height}]+bestaudio/best[height<={height}]',
            'outtmpl': output_path,
            'merge_output_format': 'mp4',
            'quiet': True,
            'no_warnings': True,
            'progress_hooks': [lambda d: update_progress(task_id, d)],
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        # 查找下载的文件
        for file in os.listdir(DOWNLOAD_DIR):
            if file.startswith(task_id):
                download_tasks[task_id]['status'] = 'completed'
                download_tasks[task_id]['filename'] = file
                return

        download_tasks[task_id]['status'] = 'error'
        download_tasks[task_id]['error'] = '文件未找到'

    except Exception as e:
        download_tasks[task_id]['status'] = 'error'
        download_tasks[task_id]['error'] = str(e)


def update_progress(task_id, d):
    """更新下载进度"""
    if d['status'] == 'downloading':
        total = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
        downloaded = d.get('downloaded_bytes', 0)
        if total > 0:
            progress = (downloaded / total) * 100
            download_tasks[task_id]['progress'] = round(progress, 1)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/info', methods=['POST'])
def get_info():
    """获取视频信息"""
    data = request.get_json()
    url = data.get('url', '')

    if not url:
        return jsonify({'error': '请提供YouTube链接'}), 400

    try:
        info = get_video_info(url)
        return jsonify(info)
    except Exception as e:
        return jsonify({'error': f'获取视频信息失败: {str(e)}'}), 400


@app.route('/api/download', methods=['POST'])
def start_download():
    """开始下载视频"""
    data = request.get_json()
    url = data.get('url', '')
    quality = data.get('quality', '720p')

    if not url:
        return jsonify({'error': '请提供YouTube链接'}), 400

    task_id = str(uuid.uuid4())[:8]
    download_tasks[task_id] = {
        'status': 'pending',
        'progress': 0,
        'filename': None,
        'error': None
    }

    # 启动后台下载任务
    thread = threading.Thread(target=download_video_task, args=(task_id, url, quality))
    thread.daemon = True
    thread.start()

    return jsonify({'task_id': task_id})


@app.route('/api/status/<task_id>')
def get_status(task_id):
    """获取下载状态"""
    task = download_tasks.get(task_id)
    if not task:
        return jsonify({'error': '任务不存在'}), 404
    return jsonify(task)


@app.route('/api/file/<task_id>')
def download_file(task_id):
    """下载已完成的文件"""
    task = download_tasks.get(task_id)
    if not task or task['status'] != 'completed':
        return jsonify({'error': '文件未就绪'}), 404

    file_path = os.path.join(DOWNLOAD_DIR, task['filename'])
    if not os.path.exists(file_path):
        return jsonify({'error': '文件不存在'}), 404

    return send_file(
        file_path,
        as_attachment=True,
        download_name=task['filename']
    )


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=54321, debug=True)
