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
import ssl
import struct
import subprocess
import tempfile
import time
import unittest
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parents[2]


class WS:
    def __init__(self, port, cookie, origin=None, host=None, context=None):
        self.socket = socket.create_connection(('127.0.0.1', port), timeout=4)
        if context: self.socket = context.wrap_socket(self.socket, server_hostname='127.0.0.1')
        self.socket.settimeout(9)
        self.reader = self.socket.makefile('rb')
        origin = origin if origin is not None else f'{"https" if context else "http"}://127.0.0.1:{port}'
        host = host or f'127.0.0.1:{port}'
        key = base64.b64encode(os.urandom(16)).decode()
        headers = f'GET /ws HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nCookie: {cookie}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'
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
    secure = False
    context = None
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='sofapad-integration-')
        cls.pair_file = Path(cls.directory.name) / 'pair.json'
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0)); cls.port = probe.getsockname()[1]
        cls.origin = f'{"https" if cls.secure else "http"}://127.0.0.1:{cls.port}'
        tls_args = []
        if cls.secure:
            cert = Path(cls.directory.name) / 'certificate.pem'; key = Path(cls.directory.name) / 'private-key.pem'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', str(key), '-out', str(cert)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            cls.context = ssl.create_default_context(cafile=str(cert))
            tls_args = ['--tls-cert', str(cert), '--tls-key', str(key)]
        cls.process = subprocess.Popen([str(ROOT / '.build/debug/SofaPad'), '--preview-server', '--port', str(cls.port), '--web-root', str(ROOT / 'Web/dist'), '--pair-file', str(cls.pair_file)] + tls_args, stdout=subprocess.DEVNULL)
        for _ in range(200):
            if cls.pair_file.exists(): break
            if cls.process.poll() is not None: raise RuntimeError('Preview exited before startup')
            time.sleep(0.05)
        pair_url = json.loads(cls.pair_file.read_text())['url']
        cls.token = parse_qs(urlparse(pair_url).fragment)['pair'][0]
        status, headers, _ = cls.request('POST', '/api/pair', {'token': cls.token, 'name': 'Integration browser'})
        assert status == 200
        cls.cookie_header = headers['set-cookie']
        cls.cookie = cls.cookie_header.split(';')[0]
    @classmethod
    def tearDownClass(cls):
        cls.process.terminate(); cls.process.wait(timeout=8); cls.directory.cleanup()
    @classmethod
    def request(cls, method, path, value=None, **extra):
        connection = http.client.HTTPSConnection('127.0.0.1', cls.port, timeout=5, context=cls.context) if cls.secure else http.client.HTTPConnection('127.0.0.1', cls.port, timeout=5)
        headers = {'Origin': cls.origin, **extra}
        body = json.dumps(value) if value is not None else None
        if body is not None: headers['Content-Type'] = 'application/json'
        connection.request(method, path, body, headers)
        response = connection.getresponse(); data = response.read()
        result = response.status, dict(response.getheaders()), data
        connection.close()
        return result[0], {k.lower(): v for k, v in result[1].items()}, result[2]
    def socket(self, **extra):
        ws = WS(self.port, self.cookie, context=self.context, **extra); self.addCleanup(ws.close); return ws
    def test_01_static_and_cookie_security(self):
        status, headers, data = self.request('GET', '/')
        self.assertEqual(status, 200); self.assertIn('frame-ancestors', headers['content-security-policy'])
        self.assertIn(b'SofaPad', data); self.assertEqual(headers['cache-control'], 'no-store')
        status, headers, data = self.request('GET', '/api/status', Cookie=self.cookie)
        self.assertTrue(json.loads(data)['authenticated']); self.assertTrue(json.loads(data)['preview'])
        self.assertEqual(self.request('GET', '/../../etc/passwd')[0], 404)
        self.assertEqual(self.request('GET', '/remote.js')[0], 404)
        self.assertNotIn(b'remote-mode', self.request('GET', '/')[2])
    def test_02_token_replay_host_origin(self):
        self.assertEqual(self.request('POST', '/api/pair', {'token': self.token, 'name': 'replay'})[0], 403)
        self.assertEqual(self.request('GET', '/', Host='evil.example')[0], 403)
        self.assertEqual(self.request('GET', '/', Origin='http://evil.example')[0], 403)
        self.assertEqual(self.request('POST', '/api/forget', Origin='http://evil.example', Cookie=self.cookie)[0], 403)
        bad = WS(self.port, '', origin=self.origin, context=self.context); self.addCleanup(bad.close); self.assertNotEqual(bad.status, 101)
        self.assertNotEqual(self.socket(origin='http://evil.example').status, 101)
        self.assertNotEqual(self.socket(host='evil.example').status, 101)
    def test_03_session_busy_ping_and_reconnect(self):
        one = self.socket(); first_id = one.hello()
        two = self.socket(); self.assertEqual(two.receive()['reason'], 'busy'); two.close()
        one.send(json.dumps({'type': 'ping', 'v': 2, 'sessionID': first_id, 'seq': 1, 'nonce': 'roundtrip'}))
        self.assertEqual(one.receive(), {'type': 'pong', 'nonce': 'roundtrip'})
        one.close(); three = self.socket(); self.assertNotEqual(first_id, three.hello())
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
        one = self.socket(); one.hello(); result = one.receive()
        self.assertEqual(result.get('reason'), 'timeout')
        two = self.socket(); two.hello()
    def test_08_no_hello_timeout(self):
        ws = self.socket(); self.assertEqual(ws.receive().get('reason'), 'timeout')
    def test_09_oversized_http(self):
        self.assertEqual(self.request('POST', '/api/pair', {'token': 'x' * 17000, 'name': 'x'})[0], 413)
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
    def test_99_revocation_disconnects_and_invalidates_cookie(self):
        ws = self.socket(); ws.hello()
        status, headers, _ = self.request('POST', '/api/forget', Cookie=self.cookie)
        self.assertEqual(status, 200); self.assertIn('Max-Age=0', headers['set-cookie'])
        self.assertEqual(ws.receive()['reason'], 'revoked')
        _, _, body = self.request('GET', '/api/status', Cookie=self.cookie)
        self.assertFalse(json.loads(body)['authenticated'])


class TLSServerTests(ServerTests):
    secure = True
    def test_12_secure_cookie_and_scheme_policy(self):
        self.assertTrue(self.cookie.startswith('__Host-sofapad='))
        for flag in ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']:
            self.assertIn(flag, self.cookie_header)
        self.assertEqual(self.context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(self.context.check_hostname)
        self.assertEqual(self.request('GET', '/', Origin=f'http://127.0.0.1:{self.port}')[0], 403)
        self.assertNotEqual(self.socket(origin=f'http://127.0.0.1:{self.port}').status, 101)
    def test_13_plaintext_cannot_access_tls_port(self):
        with socket.create_connection(('127.0.0.1', self.port), timeout=3) as connection:
            connection.sendall(b'GET / HTTP/1.1\r\nHost: localhost\r\n\r\n')
            try: response = connection.recv(64)
            except ConnectionResetError: response = b''
            self.assertNotIn(b'200 OK', response)


if __name__ == '__main__': unittest.main(verbosity=2)
