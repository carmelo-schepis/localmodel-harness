import json
import os
from pathlib import Path
import socket
import subprocess
import time
import unittest
import urllib.request
import urllib.error

ROOT=Path(__file__).resolve().parents[2]


class CompanionCorsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        cls.url=f'http://127.0.0.1:{port}'
        cls.process=subprocess.Popen(['node',str(ROOT/'harness-services/deep-research/server.js')],env={**os.environ,'PORT':str(port),'ALLOWED_ORIGINS':'http://app:8080'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                with urllib.request.urlopen(cls.url+'/health',timeout=1):return
            except OSError:time.sleep(.05)
        cls.process.terminate();cls.process.wait()
        raise RuntimeError('Companion failed to start')

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate();cls.process.wait(timeout=5)

    def test_backend_post_without_origin_reaches_request_validation(self):
        request=urllib.request.Request(self.url+'/research',data=b'{}',headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=3) as response:
            self.assertEqual(response.status,200)
            events=[json.loads(line) for line in response.read().splitlines()]
        self.assertEqual(events[-1]['type'],'error')
        # An empty query is rejected before any outbound search or model call.
        self.assertIn('query',events[-1]['message'].lower())

    def test_disallowed_browser_origin_is_still_rejected(self):
        request=urllib.request.Request(self.url+'/research',data=b'{}',headers={'Content-Type':'application/json','Origin':'https://outside.invalid'})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request,timeout=3)
        self.assertEqual(caught.exception.code,403)
