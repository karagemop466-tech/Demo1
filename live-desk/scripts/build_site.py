#!/usr/bin/env python3
"""Copy only the static website files into the GitHub Pages artifact directory."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.site-dist'
if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir()
for name in ('index.html', 'styles.css', 'app.js'):
    shutil.copy2(ROOT / name, OUT / name)
shutil.copytree(ROOT / 'pages', OUT / 'pages')
(OUT / '.nojekyll').write_text('', encoding='utf-8')
print(f'Prepared static site in {OUT.relative_to(ROOT)}')
