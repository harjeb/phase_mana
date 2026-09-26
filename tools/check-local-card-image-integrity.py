"""Decode every image in the configured library without modifying any files.
Run: python tools/check-local-card-image-integrity.py [report.json]
Requires Pillow. This checks readability, not card identity or translation.
"""
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image

config = json.loads(Path('card-images.config.json').read_text(encoding='utf8'))
root = Path(os.environ.get('PHASE_MANA_CARD_IMAGES') or config['dir'])
output = Path(sys.argv[1] if len(sys.argv) > 1 else 'tools/local-card-images-integrity.json')
files = [p for p in root.rglob('*') if p.suffix.lower() in ('.webp', '.png', '.jpg', '.jpeg')]


def check(path):
    try:
        with Image.open(path) as image:
            image.load()
        return None
    except Exception as error:
        return {'path': path.relative_to(root).as_posix(), 'error': str(error)}


started = time.time()
invalid = []
with ThreadPoolExecutor(max_workers=8) as pool:
    for i, result in enumerate(pool.map(check, files), 1):
        if result:
            invalid.append(result)
        if i % 5000 == 0:
            print(f'{i}/{len(files)} decoded; {len(invalid)} invalid', flush=True)
report = {'library': str(root), 'checked': len(files), 'seconds': round(time.time()-started, 1), 'invalid': invalid}
output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
