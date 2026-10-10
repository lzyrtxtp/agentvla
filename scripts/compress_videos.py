"""Compress demos; publish the size-budgeted 1080p overview without re-encoding."""
import hashlib
import json
import os
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / '_site'
CACHE = ROOT / '.web-video-cache'
CACHE.mkdir(exist_ok=True)
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')
VERSION = 'web-v1'
manifest = json.loads((ROOT / 'assets-manifest.json').read_text())


def compress(item):
    original = SITE / item['path']
    if item.get('passthrough'):
        result = {'source': item['path'], 'path': item['path'],
                  'original_bytes': item['size'], 'bytes': original.stat().st_size,
                  'sha256': hashlib.sha256(original.read_bytes()).hexdigest()}
        assert result['bytes'] == item['size'] and result['sha256'] == item['sha256']
        print(original.name, 'preserved without re-encoding', flush=True)
        return result
    output = original.with_name(original.stem + '.web.mp4')
    overview = original.name == 'overview.mp4'
    crf, rate, buf, keyframes = ('30', '850k', '1700k', '80') if overview else ('26', '1500k', '3000k', '40')
    cache = CACHE / (item['sha256'] + '-' + VERSION + '.mp4')
    if not cache.exists():
        temporary = cache.with_suffix('.tmp.mp4')
        subprocess.run([
            FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(original),
            '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'slow',
            '-crf', crf, '-maxrate', rate, '-bufsize', buf, '-g', keyframes,
            '-pix_fmt', 'yuv420p', '-threads', '2', '-c:a', 'copy',
            '-movflags', '+faststart', str(temporary)
        ], check=True)
        if temporary.stat().st_size >= original.stat().st_size:
            shutil.copy2(original, temporary)
        temporary.replace(cache)
    shutil.copy2(cache, output)
    result = {'source': item['path'], 'path': str(output.relative_to(SITE)),
              'original_bytes': item['size'], 'bytes': output.stat().st_size,
              'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}
    # Only the staged publication copy is removed; ROOT/assets retains the originals.
    original.unlink()
    print(output.name, result['original_bytes'], '->', result['bytes'], flush=True)
    return result


if __name__ == '__main__':
    videos = [item for item in manifest if item['path'].endswith('.mp4')]
    with ThreadPoolExecutor(max_workers=2) as pool:
        report = list(pool.map(compress, videos))
    (SITE / 'web-video-manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Total video bytes:', sum(r['original_bytes'] for r in report), '->', sum(r['bytes'] for r in report))
