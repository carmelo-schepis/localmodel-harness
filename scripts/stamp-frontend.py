#!/usr/bin/env python3
"""Record the source commit and checksums of a completed frontend build."""
import hashlib
import json
from pathlib import Path
import subprocess

root=Path(__file__).resolve().parents[1]
folder=root/'build'
if not (folder/'index.html').is_file():
    raise SystemExit('Build the frontend first')
revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
files={str(p.relative_to(folder)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(folder.rglob('*')) if p.is_file() and p.name!='.hugo-release.json'}
(folder/'.hugo-release.json').write_text(json.dumps({'revision':revision,'files':files},indent=2))
print(f'Stamped {len(files)} frontend files for {revision}')
