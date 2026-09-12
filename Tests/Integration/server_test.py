"""Real HTTP/WS loopback tests against the Swift server; no system input is generated.

Uses only Python's standard library. The small RFC frame client is test code;
production networking uses SwiftNIO's decoder and aggregator.
"""
import base64
import http.client
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]


class WS:
    def __init__(self, port, origin=None, host=None):
        self.socket = socket.create_connection(('127.0.0.1', port), timeout=4)
        self.socket.settimeout(9)
        self.reader = self.socket.makefile('rb')
        origin = origin if origin is not None else f'http://127.0.0.1:{port}'
        host = host or f'127.0.0.1:{port}'
        key = base64.b64encode(os.urandom(16)).decode()
        headers = f'GET /ws HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'
        self.socket.sendall(headers.encode())
        status_line = self.reader.readline().split()
        self.status = int(status_line[1]) if len(status_line) > 1 else 0
        while self.reader.readline() not in (b'\r\n', b''):
            pass
    def send(self, value, opcode=1, final=True, masked=True):
        payload = value.encode() if isinstance(value, str) else value
        mask = os.urandom(4)
        size = len(payload)
        header = bytes([(128 if final else 0) | opcode])
        flag = 128 if masked else 0
        if size < 126: header += bytes([flag | size])
        elif size <= 65535: header += bytes([flag | 126]) + struct.pack('!H', size)
        else: header += bytes([flag | 127]) + struct.pack('!Q', size)
        if masked: header += mask; payload = bytes(v ^ mask[i % 4] for i, v in enumerate(payload))
        self.socket.sendall(header + payload)
    def receive(self):
        header = self.reader.read(2)
        if len(header) != 2: return {'type': 'closed'}
        length = header[1] & 127
        if length == 126: length = struct.unpack('!H', self.reader.read(2))[0]
        elif length == 127: length = struct.unpack('!Q', self.reader.read(8))[0]
        payload = self.reader.read(length)
        if header[0] & 15 == 8: return {'type': 'closed'}
        return json.loads(payload)
    def hello(self):
        self.send('{"type":"hello","v":2}')
        result = self.receive()
        if result.get('type') != 'ready': raise AssertionError(f'Expected ready: {result}')
        self.ready = result
        return result['sessionID']
    def close(self):
        self.reader.close(); self.socket.close()
        time.sleep(0.025)


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='sofapad-integration-')
        cls.info_file = Path(cls.directory.name) / 'server.json'
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0)); cls.port = probe.getsockname()[1]
        cls.origin = f'http://127.0.0.1:{cls.port}'
        cls.process = subprocess.Popen([str(ROOT / '.build/debug/SofaPad'), '--preview-server', '--port', str(cls.port),
                                        '--web-root', str(ROOT / 'Web/dist'), '--info-file', str(cls.info_file)], stdout=subprocess.DEVNULL)
        for _ in range(200):
            if cls.info_file.exists(): break
            if cls.process.poll() is not None: raise RuntimeError('Preview exited before startup')
            time.sleep(0.05)
        cls.url = json.loads(cls.info_file.read_text())['url']
    @classmethod
    def tearDownClass(cls):
        cls.process.terminate(); cls.process.wait(timeout=8); cls.directory.cleanup()
    @classmethod
    def request(cls, method, path, value=None, **extra):
        connection = http.client.HTTPConnection('127.0.0.1', cls.port, timeout=5)
        headers = {'Origin': cls.origin, **extra}
        body = json.dumps(value) if value is not None else None
        if body is not None: headers['Content-Type'] = 'application/json'
        connection.request(method, path, body, headers)
        response = connection.getresponse(); data = response.read()
        result = response.status, {k.lower(): v for k, v in response.getheaders()}, data
        connection.close()
        return result
    @classmethod
    def raw_request(cls, method, path, body, **extra):
        connection = http.client.HTTPConnection('127.0.0.1', cls.port, timeout=5)
        connection.request(method, path, body, {'Origin': cls.origin, 'Content-Type': 'application/json', **extra})
        response = connection.getresponse(); data = response.read()
        result = response.status, {k.lower(): v for k, v in response.getheaders()}, data
        connection.close()
        return result
    def socket(self, **extra):
        ws = WS(self.port, **extra); self.addCleanup(ws.close); return ws
    def test_01_static_status_and_unknown_paths(self):
        status, headers, data = self.request('GET', '/')
        self.assertEqual(status, 200)
        self.assertIn('ws://127.0.0.1:', headers['content-security-policy'])
        self.assertNotIn('wss://', headers['content-security-policy'])
        self.assertIn(b'SofaPad', data); self.assertEqual(headers['cache-control'], 'no-store')
        status, headers, data = self.request('GET', '/api/status')
        state = json.loads(data)
        self.assertEqual(status, 200); self.assertTrue(state['preview']); self.assertEqual(state['v'], 2)
        self.assertNotIn('authenticated', state)
        self.assertEqual(self.request('GET', '/../../etc/passwd')[0], 404)
        self.assertEqual(self.request('GET', '/remote.js')[0], 404)
        self.assertEqual(self.request('GET', '/api/pair')[0], 404)
    def test_01b_every_built_web_asset_is_served(self):
        # A module missing from a hand-written list used to 404 while the page still looked
        # fine up to the first import, leaving the phone stuck on "正在连接 Mac…".
        for asset in sorted((ROOT / 'Web' / 'dist').iterdir()):
            if asset.suffix not in ('.js', '.css', '.html'): continue
            status, headers, data = self.request('GET', '/' + asset.name)
            self.assertEqual(status, 200, f'{asset.name} must be served')
            self.assertTrue(data, f'{asset.name} must not be empty')
        self.assertGreaterEqual(len(list((ROOT / 'Web' / 'dist').glob('*.js'))), 4)
    def test_02_host_and_origin(self):
        self.assertEqual(self.request('GET', '/', Host='evil.example')[0], 403)
        self.assertEqual(self.request('GET', '/', Origin='http://evil.example')[0], 403)
        self.assertEqual(self.request('GET', '/', Origin='https://127.0.0.1:%d' % self.port)[0], 403)
        self.assertNotEqual(self.socket(origin='http://evil.example').status, 101)
        self.assertNotEqual(self.socket(host='evil.example').status, 101)
    def test_03_parallel_sessions_ping_and_reconnect(self):
        one = self.socket(); first_id = one.hello()
        # A second browser controls the Mac at the same time, with its own session.
        two = self.socket(); second_id = two.hello()
        self.assertNotEqual(first_id, second_id)
        for socket, session, nonce in [(one, first_id, 'first'), (two, second_id, 'second')]:
            socket.send(json.dumps({'type': 'ping', 'v': 2, 'sessionID': session, 'seq': 1, 'nonce': nonce}))
            self.assertEqual(socket.receive(), {'type': 'pong', 'nonce': nonce})
        one.close()
        two.send(json.dumps({'type': 'ping', 'v': 2, 'sessionID': second_id, 'seq': 2, 'nonce': 'still-here'}))
        self.assertEqual(two.receive(), {'type': 'pong', 'nonce': 'still-here'})
        two.close(); three = self.socket(); self.assertNotIn(three.hello(), [first_id, second_id])
    def test_04_library_fragment_reassembly(self):
        ws = self.socket()
        ws.send('{"type":"hello",', final=False); ws.send('"v":2}', opcode=0)
        self.assertEqual(ws.receive()['type'], 'ready')
    def test_05_shared_protocol_fixtures_over_wire(self):
        fixtures = json.loads((ROOT / 'Protocol/fixtures/messages.json').read_text())
        for fixture_index, fixture in enumerate(fixtures):
            with self.subTest(fixture=fixture['name']):
                ws = self.socket(); session = ws.hello()
                for raw in fixture['messages']:
                    ws.send(raw.replace('test-session', session).replace('11111111-2222-3333-4444-555555555555', ws.ready['pasteEpoch']).replace(':fixture', f':fixture-{fixture_index}'))
                    if fixture['valid'] and json.loads(raw).get('type') == 'paste': self.assertEqual(ws.receive().get('status'), 'executed')
                if fixture['valid']:
                    if fixture['name'] == 'heartbeat': self.assertEqual(ws.receive()['type'], 'pong')
                    ws.send(json.dumps({'type': 'ping', 'v': 2, 'sessionID': session, 'seq': 99, 'nonce': 'fixture'}))
                    self.assertEqual(ws.receive()['type'], 'pong')
                else:
                    self.assertIn(ws.receive()['type'], ['disconnect', 'closed'])
                ws.close()
    def test_06_unmasked_frame_rejected(self):
        ws = self.socket(); ws.send('{"type":"hello","v":2}', masked=False)
        self.assertEqual(ws.receive()['reason'], 'protocol')
    def test_07_heartbeat_timeout_releases_owner(self):
        one = self.socket(); one.hello(); self.assertEqual(one.receive().get('reason'), 'timeout')
        two = self.socket(); two.hello()
    def test_08_no_hello_timeout(self):
        ws = self.socket(); self.assertEqual(ws.receive().get('reason'), 'timeout')
    def test_09_oversized_http(self):
        self.assertEqual(self.raw_request('POST', '/api/status', json.dumps({'token': 'x' * 17000}))[0], 413)
    def test_10_paste_dedupe_across_reconnect_and_reject_conflict(self):
        one = self.socket(); first = one.hello(); request_id = one.ready['pasteEpoch'] + ':integration'
        text = '  中文 👨‍👩‍👧‍👦 e\u0301\n第二行\n'
        one.send(json.dumps(dict(type='paste', v=2, sessionID=first, seq=1, requestID=request_id, text=text)))
        result = one.receive(); self.assertEqual(result['status'], 'executed'); self.assertFalse(result['duplicate'])
        one.close(); two = self.socket(); second = two.hello()
        two.send(json.dumps(dict(type='paste', v=2, sessionID=second, seq=1, requestID=request_id, text=text)))
        result = two.receive(); self.assertEqual(result['status'], 'executed'); self.assertTrue(result['duplicate'])
        two.send(json.dumps(dict(type='paste', v=2, sessionID=second, seq=2, requestID=request_id, text='changed')))
        self.assertEqual(two.receive()['status'], 'id_conflict')
        two.send(json.dumps(dict(type='paste', v=2, sessionID=second, seq=3, requestID='00000000-0000-0000-0000-000000000000:old', text=text)))
        self.assertEqual(two.receive()['status'], 'expired')
    def test_11_drag_disconnect_allows_fresh_session(self):
        one = self.socket(); first = one.hello()
        one.send(json.dumps(dict(type='drag', v=2, sessionID=first, seq=1, phase='begin', dx=12, dy=3)))
        one.close(); two = self.socket(); second = two.hello()
        two.send(json.dumps(dict(type='click', v=2, sessionID=second, seq=1, button='left', count=1)))
        two.send(json.dumps(dict(type='ping', v=2, sessionID=second, seq=2, nonce='after-drag')))
        self.assertEqual(two.receive()['type'], 'pong')


if __name__ == '__main__':
    unittest.main(verbosity=2)
