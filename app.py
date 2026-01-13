import os
import uuid
import threading
import time
import re
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, send_file
from flask_cors import CORS
import yt_dlp

app = Flask(__name__)
CORS(app)

DOWNLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'downloads')
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# 存储下载任务状态
download_tasks = {}

# 文件保留天数
FILE_RETENTION_DAYS = 30


def cleanup_old_files():
    """清理超过30天的旧文件"""
    while True:
        try:
            now = time.time()
            cutoff = now - (FILE_RETENTION_DAYS * 24 * 60 * 60)
            
            for filename in os.listdir(DOWNLOAD_DIR):
                filepath = os.path.join(DOWNLOAD_DIR, filename)
                if os.path.isfile(filepath):
                    file_mtime = os.path.getmtime(filepath)
                    if file_mtime < cutoff:
                        os.remove(filepath)
                        print(f'已清理过期文件: {filename}')
        except Exception as e:
            print(f'清理文件时出错: {e}')
        
        # 每天检查一次
        time.sleep(24 * 60 * 60)


# 启动清理线程
cleanup_thread = threading.Thread(target=cleanup_old_files, daemon=True)
cleanup_thread.start()


def sanitize_filename(title):
    """清理文件名，移除不合法字符"""
    # 移除不合法字符
    filename = re.sub(r'[\\/*?:"<>|]', '', title)
    # 替换空格为下划线
    filename = filename.replace(' ', '_')
    # 限制长度（保留空间给扩展名和task_id）
    if len(filename) > 100:
        filename = filename[:100]
    return filename


def get_video_info(url):
    """获取视频信息和可用格式"""
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

        # 筛选出720p及以上的格式，收集文件大小信息
        formats = []
        seen_qualities = {}

        # 获取最佳音频大小
        best_audio_size = 0
        for f in info.get('formats', []):
            if f.get('acodec') != 'none' and f.get('vcodec') == 'none':
                audio_size = f.get('filesize') or f.get('filesize_approx') or 0
                if audio_size > best_audio_size:
                    best_audio_size = audio_size

        for f in info.get('formats', []):
            height = f.get('height')
            if height and height >= 720:
                quality = f'{height}p'
                video_size = f.get('filesize') or f.get('filesize_approx') or 0
                
                # 保留每个清晰度中文件最大的（通常质量最好）
                if quality not in seen_qualities or video_size > seen_qualities[quality]['size']:
                    seen_qualities[quality] = {
                        'quality': quality,
                        'height': height,
                        'ext': 'mp4',
                        'size': video_size + best_audio_size
                    }

        formats = list(seen_qualities.values())
        
        # 按清晰度排序
        formats.sort(key=lambda x: x['height'], reverse=True)

        # 如果没有找到格式，添加默认的720p和1080p选项
        if not formats:
            formats = [
                {'quality': '1080p', 'height': 1080, 'ext': 'mp4', 'size': 0},
                {'quality': '720p', 'height': 720, 'ext': 'mp4', 'size': 0}
            ]

        return {
            'title': info.get('title', 'Unknown'),
            'thumbnail': info.get('thumbnail', ''),
            'duration': info.get('duration', 0),
            'formats': formats
        }


def download_video_task(task_id, url, quality, video_title):
    """后台下载任务"""
    try:
        download_tasks[task_id]['status'] = 'downloading'

        height = int(quality.replace('p', ''))
        
        # 使用视频标题作为文件名
        safe_title = sanitize_filename(video_title)
        filename = f'{safe_title}_{task_id}'
        output_path = os.path.join(DOWNLOAD_DIR, f'{filename}.%(ext)s')

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
            if file.startswith(safe_title) and task_id in file:
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
    title = data.get('title', 'video')

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
    thread = threading.Thread(target=download_video_task, args=(task_id, url, quality, title))
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
        mimetype='video/mp4',
        download_name=task['filename']
    )


@app.route('/videos')
def videos_page():
    """视频列表页面"""
    return render_template('videos.html')


@app.route('/api/videos')
def list_videos():
    """获取所有已下载的视频列表"""
    videos = []
    
    for filename in os.listdir(DOWNLOAD_DIR):
        filepath = os.path.join(DOWNLOAD_DIR, filename)
        if os.path.isfile(filepath) and filename.endswith('.mp4'):
            stat = os.stat(filepath)
            videos.append({
                'filename': filename,
                'size': stat.st_size,
                'size_mb': round(stat.st_size / (1024 * 1024), 2),
                'created': datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M'),
                'days_left': max(0, FILE_RETENTION_DAYS - int((time.time() - stat.st_mtime) / (24 * 60 * 60)))
            })
    
    # 按创建时间倒序排列
    videos.sort(key=lambda x: x['created'], reverse=True)
    return jsonify(videos)


@app.route('/api/videos/<filename>', methods=['DELETE'])
def delete_video(filename):
    """删除指定视频"""
    filepath = os.path.join(DOWNLOAD_DIR, filename)
    
    if not os.path.exists(filepath):
        return jsonify({'error': '文件不存在'}), 404
    
    try:
        os.remove(filepath)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/videos/<filename>/download')
def download_video_file(filename):
    """下载指定视频"""
    filepath = os.path.join(DOWNLOAD_DIR, filename)
    
    if not os.path.exists(filepath):
        return jsonify({'error': '文件不存在'}), 404
    
    return send_file(
        filepath,
        as_attachment=True,
        mimetype='video/mp4',
        download_name=filename
    )


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=54321, debug=True)
