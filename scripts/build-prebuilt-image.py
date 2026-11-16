#!/usr/bin/env python3
"""Package a checksummed frontend with this revision's standard backend image."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]


def verify_frontend(folder, revision):
    manifest=json.loads((folder/'.hugo-release.json').read_text())
    if manifest['revision']!=revision:
        raise ValueError('Frontend was built from a different Git revision')
    actual={str(p.relative_to(folder)):hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.rglob('*') if p.is_file() and p.name!='.hugo-release.json'}
    if actual!=manifest['files'] or 'index.html' not in actual:
        raise ValueError('Frontend files do not match their recorded checksums')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-image',help='Reuse a local standard Open WebUI image only when its runtime dependency files exactly match')
    args=parser.parse_args()
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    verify_frontend(ROOT/'build',revision)
    source=(ROOT/'Dockerfile').read_text()
    base_image=None
    if args.base_image:
        base_id=subprocess.check_output(['docker','image','inspect',args.base_image,'--format','{{.Id}}'],text=True).strip()
        # BuildKit interprets a raw sha256 ID as a Docker Hub repository.
        # Give the verified local image an immutable, content-derived tag first.
        base_image='hugo-runtime:'+base_id.removeprefix('sha256:')[:16]
        subprocess.run(['docker','tag',base_id,base_image],check=True)
        check="import hashlib,json,os; print(json.dumps({'hashes':{n:hashlib.sha256(open('/app/backend/'+n,'rb').read()).hexdigest() for n in ['requirements.txt','requirements-slim.txt']},'slim':os.getenv('USE_SLIM_DOCKER','false')}))"
        runtime=json.loads(subprocess.check_output(['docker','run','--rm','--entrypoint','python',base_image,'-c',check],text=True))
        expected={n:hashlib.sha256((ROOT/'backend'/n).read_bytes()).hexdigest() for n in ['requirements.txt','requirements-slim.txt']}
        if runtime['hashes']!=expected or runtime['slim'].lower()=='true':
            raise ValueError('Base image runtime dependencies do not match the standard source image')

    prefix=source.split('######## WebUI frontend ########')[0]
    backend=source.split('######## WebUI backend ########',1)[1]
    frontend='''\nFROM scratch AS build
COPY build /app/build
COPY backend /app/backend
COPY CHANGELOG.md /app/CHANGELOG.md
COPY package.json /app/package.json
'''
    with tempfile.NamedTemporaryFile(mode='w',suffix='.Dockerfile') as dockerfile:
        if base_image:
            dockerfile.write(f'FROM {base_image}\nCOPY build /app/build\nCOPY backend /app/backend\nCOPY CHANGELOG.md /app/CHANGELOG.md\nCOPY package.json /app/package.json\nENV WEBUI_BUILD_HASH={revision}\n')
        else:
            dockerfile.write(prefix+frontend+backend)
        dockerfile.flush()
        subprocess.run(['docker','build','-f',dockerfile.name,'--build-arg',f'BUILD_HASH={revision}','--build-arg','BUILD_CHANNEL=main','--label',f'org.opencontainers.image.revision={revision}','--label','org.opencontainers.image.source=https://github.com/carmelo-schepis/localmodel-harness','-t',f'hugo-harness:{revision[:12]}','.'],cwd=ROOT,check=True)


if __name__=='__main__':
    main()
