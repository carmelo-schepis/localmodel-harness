"""Exercise auth, companion errors, and streamed event forwarding without a database."""
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient


def unauthenticated():
    raise HTTPException(status_code=401)


auth=types.ModuleType('open_webui.utils.auth')
auth.get_verified_user=unauthenticated
spec=importlib.util.spec_from_file_location('hugo_proxy',Path(__file__).resolve().parents[2]/'backend/open_webui/routers/hugo.py')
proxy=importlib.util.module_from_spec(spec)
with patch.dict('sys.modules',{'open_webui.utils.auth':auth}):
    spec.loader.exec_module(proxy)
RealAsyncClient=httpx.AsyncClient


class ProxyTest(unittest.TestCase):
    def setUp(self):
        self.app=FastAPI();self.app.include_router(proxy.router,prefix='/research')
        self.client=TestClient(self.app)

    def test_requires_login(self):
        self.assertEqual(self.client.get('/research/health').status_code,401)
        self.assertEqual(self.client.post('/research/research',json={'query':'test'}).status_code,401)

    def test_forwards_events_and_body(self):
        self.app.dependency_overrides[unauthenticated]=lambda: {'id':'fixture'}
        def upstream(request):
            self.assertEqual(request.url.path,'/research')
            self.assertIn(b'"query":"test"',request.content)
            return httpx.Response(200,content=b'{"type":"started"}\n{"type":"completed"}\n')
        with patch.object(proxy.httpx,'AsyncClient',side_effect=lambda **kw:RealAsyncClient(transport=httpx.MockTransport(upstream),**kw)):
            response=self.client.post('/research/research',json={'query':'test','model':'small'})
        self.assertEqual(response.status_code,200)
        self.assertEqual([line['type'] for line in map(__import__('json').loads,response.text.splitlines())],['started','completed'])
        self.assertIn('application/x-ndjson',response.headers['content-type'])

    def test_unavailable_companion_does_not_leak_details(self):
        self.app.dependency_overrides[unauthenticated]=lambda: {'id':'fixture'}
        def upstream(request): return httpx.Response(500,text='private internal diagnostics')
        with patch.object(proxy.httpx,'AsyncClient',side_effect=lambda **kw:RealAsyncClient(transport=httpx.MockTransport(upstream),**kw)):
            self.assertEqual(self.client.get('/research/health').status_code,503)
            response=self.client.post('/research/research',json={'query':'test'})
        self.assertEqual(response.status_code,502)
        self.assertNotIn('private',response.text)


if __name__=='__main__': unittest.main()
