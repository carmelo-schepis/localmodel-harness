#!/usr/bin/env python3
"""Build this checkout and create/update a TrueNAS-managed HUGO Custom App."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import time
from datetime import datetime, timezone
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def run(*args, timeout=1800):
    return subprocess.check_output(args, cwd=ROOT, text=True, timeout=timeout).strip()


def mid(method, *args, job=False):
    return json.loads(run('midclt', 'call', *(['-j'] if job else []), method, *(json.dumps(a) for a in args)))


def compose_config(revision, image, research_image, data_dir, bind, port, ollama_urls, model, startup_timeout=900):
    return {'services': {
        'app': {
            'image': image, 'pull_policy': 'never', 'restart': 'unless-stopped',
            'depends_on': {'research': {'condition': 'service_healthy'}},
            'ports': [f'{bind}:{port}:8080'],
            'volumes': [{'type': 'bind', 'source': str(data_dir), 'target': '/app/backend/data', 'bind': {'create_host_path': False}}],
            'environment': {
                'WEBUI_NAME': 'HUGO Harness', 'WEBUI_AUTH': 'true',
                'PYTHONDONTWRITEBYTECODE': '1',
                'WEBUI_SECRET_KEY_FILE': '/app/backend/data/.webui_secret_key',
                'WEBUI_BUILD_HASH': revision,
                'OLLAMA_BASE_URLS': ';'.join(ollama_urls),
                'HUGO_RESEARCH_SERVICE_URL': 'http://research:8787',
                'ENABLE_VERSION_UPDATE_CHECK': 'false',
            },
            'healthcheck': {'test': ['CMD', 'curl', '-f', 'http://localhost:8080/health'], 'interval': '15s', 'timeout': '5s', 'start_period': f'{startup_timeout}s', 'retries': 5},
        },
        'research': {
            'image': research_image, 'pull_policy': 'never', 'restart': 'unless-stopped',
            'environment': {'OLLAMA_BASE_URL': ollama_urls[-1], 'OLLAMA_MODEL': model, 'ALLOWED_ORIGINS': 'http://app:8080'},
        },
    }}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', default='hugo-harness')
    parser.add_argument('--data-dir', type=Path, help='Existing persistent /mnt path; default creates a dataset on the configured Apps pool')
    parser.add_argument('--bind', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=3000)
    parser.add_argument('--ollama-url', action='append', help='Ollama native root URL; repeat for multiple servers')
    parser.add_argument('--research-model', default='qwen3.5:2b')
    parser.add_argument('--startup-timeout', type=int, default=900, help='First-start readiness budget in seconds (60-1800)')
    parser.add_argument('--image', help='Use an already-built image labelled with this exact source revision')
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Run with sudo python3 scripts/truenas-install.py')
    if not re.fullmatch(r'[a-z][a-z0-9-]{0,38}[a-z0-9]|[a-z]', args.name):
        parser.error('Invalid TrueNAS app name')
    if not 1 <= args.port <= 65535:
        parser.error('Port must be between 1 and 65535')
    if not 60 <= args.startup_timeout <= 1800:
        parser.error('Startup timeout must be between 60 and 1800 seconds')
    if args.data_dir is None:
        pool=mid('docker.config').get('pool')
        if not pool:
            parser.error('Configure an Apps pool in TrueNAS first')
        dataset=f'{pool}/{args.name}'
        args.data_dir=Path('/mnt')/dataset
        if not mid('pool.dataset.query', [['name','=',dataset]]):
            mid('pool.dataset.create', {'name':dataset,'type':'FILESYSTEM'})
            os.chmod(args.data_dir,0o700)
    if not args.data_dir.is_absolute() or args.data_dir.is_symlink() or not str(args.data_dir).startswith('/mnt/'):
        parser.error('Data directory must be an absolute, nonsymlink /mnt path')
    if (args.data_dir / 'harness.sqlite').exists():
        parser.error('Legacy harness data has a different schema. Choose a separate Open WebUI data directory.')
    revision = run('git', 'rev-parse', 'HEAD')
    if run('git', 'status', '--porcelain', '--untracked-files=no'):
        parser.error('Checkout has tracked changes; commit or preserve them before building')
    ollama_urls = args.ollama_url or ['http://100.84.10.124:11434']
    for url in ollama_urls:
        if not re.match(r'^https?://[^/]+(?:/[^\s]*)?$', url) or url.rstrip('/').endswith('/v1'):
            parser.error('Use native Ollama URLs, without /v1')
    image = args.image or f'hugo-harness:{revision[:12]}'
    research_image = f'hugo-research:{revision[:12]}'
    # Build and validate before interrupting the installed app.
    if not args.image:
        subprocess.run(['docker','build','--build-arg',f'BUILD_HASH={revision}','--build-arg','BUILD_CHANNEL=main','--label',f'org.opencontainers.image.revision={revision}','--label','org.opencontainers.image.source=https://github.com/carmelo-schepis/localmodel-harness','-t',image,'.'],cwd=ROOT,check=True)
    actual_revision = run('docker','image','inspect',image,'--format','{{index .Config.Labels "org.opencontainers.image.revision"}}')
    if actual_revision != revision:
        parser.error('Image revision does not match this checkout; refusing to deploy stale code')
    subprocess.run(['docker','build','-t',research_image,'harness-services/deep-research'],cwd=ROOT,check=True)
    args.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    cfg = compose_config(revision,image,research_image,args.data_dir,args.bind,args.port,ollama_urls,args.research_model,args.startup_timeout)
    backup = args.data_dir.parent / f'{args.name}-backups' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup.mkdir(parents=True, mode=0o700)
    os.chmod(backup.parent,0o700)
    os.umask(0o077)
    config_path = backup/'new-compose.json'
    config_path.write_text(json.dumps(cfg,indent=2))
    run('docker','compose','-f',str(config_path),'config','--quiet')
    existing = mid('app.query',[['name','=',args.name]])
    old = mid('app.config',args.name) if existing else None
    if old:
        (backup/'previous-compose.json').write_text(json.dumps(old,indent=2))
        mid('app.stop',args.name,job=True)
    data_paths = {str(args.data_dir)}
    if old:
        for service in old.get('services',{}).values():
            for volume in service.get('volumes',[]):
                if isinstance(volume,dict) and volume.get('type')=='bind' and volume.get('target') in ['/app/data','/app/backend/data']:
                    data_paths.add(volume['source'])
    for index, path in enumerate(sorted(data_paths)):
        if Path(path).is_dir():
            with tarfile.open(backup/f'data-{index}.tar','w') as archive:
                archive.add(path,arcname=Path(path).name)
    (backup/'data-paths.json').write_text(json.dumps(sorted(data_paths)))
    print(f'Backup: {backup}',flush=True)
    try:
        if old:
            mid('app.update',args.name,{'custom_compose_config':cfg},job=True)
        else:
            mid('app.create',{'app_name':args.name,'custom_app':True,'custom_compose_config':cfg},job=True)
        host='127.0.0.1' if args.bind=='0.0.0.0' else args.bind
        deadline=time.monotonic()+args.startup_timeout
        while True:
            try:
                with urlopen(f'http://{host}:{args.port}/health',timeout=5) as response:
                    if json.load(response).get('status') is True: break
            except Exception:
                pass
            if time.monotonic()>deadline: raise RuntimeError('App health check timed out')
            time.sleep(2)
        info=mid('app.query',[['name','=',args.name]])[0]
        print(json.dumps({'app':info['name'],'state':info['state'],'revision':revision,'data_dir':str(args.data_dir)}))
    except Exception:
        if old:
            print(f'Update failed. Restoring previous app configuration; data backups are in {backup}.',flush=True)
            mid('app.update',args.name,{'custom_compose_config':old},job=True)
        raise


if __name__ == '__main__':
    main()
