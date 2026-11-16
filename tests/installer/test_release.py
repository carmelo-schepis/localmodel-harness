import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]

def load(name, filename):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/filename)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

installer=load('installer','truenas-install.py')
builder=load('builder','build-prebuilt-image.py')


class ReleaseTest(unittest.TestCase):
    def test_custom_app_keeps_research_private_and_secret_persistent(self):
        cfg=installer.compose_config('a'*40,'app:revision','research:revision',Path('/mnt/pool/apps/hugo-webui'),'100.64.0.1',3001,['http://one:11434','http://two:11434'],'small:model',startup_timeout=240)
        app=cfg['services']['app']; research=cfg['services']['research']
        self.assertNotIn('ports',research)
        self.assertEqual(app['ports'],['100.64.0.1:3001:8080'])
        self.assertEqual(app['volumes'][0]['target'],'/app/backend/data')
        self.assertTrue(app['environment']['WEBUI_SECRET_KEY_FILE'].startswith('/app/backend/data/'))
        self.assertEqual(app['environment']['OLLAMA_BASE_URLS'],'http://one:11434;http://two:11434')
        self.assertEqual(research['environment']['OLLAMA_BASE_URL'],'http://two:11434')
        self.assertEqual(app['pull_policy'],'never')
        self.assertNotIn('build',app)
        self.assertEqual(app['healthcheck']['start_period'],'240s')
        self.assertEqual(app['environment']['PYTHONDONTWRITEBYTECODE'],'1')

    def test_stopped_updated_app_is_started(self):
        with patch.object(installer,'mid',return_value=[{'state':'STOPPED'}]) as middleware:
            installer.start_if_stopped('hugo-harness')
        self.assertEqual(middleware.call_args_list[-1].args,('app.start','hugo-harness'))

    def test_auto_started_rollback_is_not_started_twice(self):
        with patch.object(installer,'mid',return_value=[{'state':'DEPLOYING'}]) as middleware:
            installer.start_if_stopped('hugo-harness')
        self.assertEqual(middleware.call_count,1)

    def test_prebuilt_release_rejects_stale_or_modified_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);(folder/'index.html').write_text('release')
            (folder/'.hugo-release.json').write_text(json.dumps({'revision':'abc','files':{'index.html':hashlib.sha256(b'release').hexdigest()}}))
            builder.verify_frontend(folder,'abc')
            with self.assertRaisesRegex(ValueError,'different Git revision'): builder.verify_frontend(folder,'old')
            (folder/'index.html').write_text('modified')
            with self.assertRaisesRegex(ValueError,'checksums'): builder.verify_frontend(folder,'abc')


if __name__=='__main__': unittest.main()
