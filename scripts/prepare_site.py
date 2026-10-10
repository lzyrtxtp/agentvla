"""Assemble the static site, verifying every original media file."""
import hashlib
import json
import shutil
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "_site"
ORIGIN = "https://agentvla.zlytr1314.chatgpt.site/"
SITE.mkdir(exist_ok=True)
for name in ("index.html", "styles.css", "light.css", "academic.css", "app.js", "task-progress.js", ".nojekyll"):
    shutil.copy2(ROOT / name, SITE / name)


def prepare(item):
    relative = Path(item["path"])
    if relative.is_absolute() or ".." in relative.parts or relative.parts[0] != "assets":
        raise ValueError("Invalid asset path")
    target = SITE / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    existing = ROOT / relative
    for attempt in range(3):
        try:
            if existing.exists():
                data = existing.read_bytes()
            else:
                request = Request(ORIGIN + relative.as_posix(), headers={"User-Agent": "Mozilla/5.0"})
                with urlopen(request, timeout=90) as response:
                    data = response.read(item["size"] + 1)
            if len(data) != item["size"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
                raise ValueError(f"Asset integrity mismatch: {relative}")
            target.write_bytes(data)
            return str(relative)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


manifest = json.loads((ROOT / "assets-manifest.json").read_text())
with ThreadPoolExecutor(max_workers=4) as pool:
    for asset in pool.map(prepare, manifest):
        print("Verified", asset)
print("Static site ready:", len(manifest), "original media files")
