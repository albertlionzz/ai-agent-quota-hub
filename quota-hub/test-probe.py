#!/usr/bin/env python3
"""探活脚本的测试：分类语义、密钥不泄露、结构合法性。
用本地 http.server 造假端点，所以不依赖外网——CI 里也能跑。"""
import json
import os
import re
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'probe'))
import probe  # noqa: E402

PASS = [0]
FAIL = [0]


def T(name, fn):
    try:
        fn()
        PASS[0] += 1
        print('  ok   ' + name)
    except AssertionError as e:
        FAIL[0] += 1
        print('  FAIL ' + name + '\n       ' + str(e))


def eq(a, b, msg=''):
    assert a == b, '%s 期望 %r，实际 %r' % (msg, b, a)


def assert_in(needle, hay):
    assert needle in (hay or ''), '期望包含 %r，实际 %r' % (needle, hay)


def assert_not_in(needle, hay):
    assert needle not in (hay or ''), '不应包含 %r，实际 %r' % (needle, hay)


def assert_true(c, msg=''):
    assert c, msg or '断言失败'



ROUTES = {
    '/ok/models': (200, {'data': [{'id': 'a'}, {'id': 'b'}, {'id': 'c'}]}),
    '/auth/models': (401, {'error': {'message': 'invalid key sk-verysecret1234567890'}}),
    '/nf/models': (404, {'error': 'no route matched with those values'}),
    '/boom/models': (500, {'error': 'internal'}),
    '/empty/models': (200, {}),
    '/gk/models': (403, {'error': {'message': 'The request is missing a valid API key.'}}),
    '/deny/models': (403, {'error': 'Access denied.'}),
    '/chat/chat/completions': (200, {'choices': []}),
}


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.respond()

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n:
            self.rfile.read(n)
        self.respond()

    def respond(self):
        code, body = ROUTES.get(self.path, (404, {'error': 'not found'}))
        if self.path == '/slow/models':
            import time
            time.sleep(2)
            code, body = 200, {}
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *a):
        pass


srv = HTTPServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % PORT


def ep(path, probe_type='models', model=None):
    return {'id': 'x', 'name': 'X', 'base': BASE, 'path': path, 'probe': probe_type, 'model': model, 'env': 'X_KEY'}


print('classify 语义')
T('200 → ok', lambda: eq(probe.classify(200, False), 'ok'))
T('204 → ok', lambda: eq(probe.classify(204, False), 'ok'))
T('401 无 key → auth（端点存在）', lambda: eq(probe.classify(401, False), 'auth'))
T('401 有 key → badkey', lambda: eq(probe.classify(401, True), 'badkey'))
T('403 → forbidden（不是 auth）', lambda: eq(probe.classify(403, False), 'forbidden'))
T('403 带 key 也是 forbidden', lambda: eq(probe.classify(403, True), 'forbidden'))
T('404 → notfound', lambda: eq(probe.classify(404, True), 'notfound'))
T('429 → ratelimited', lambda: eq(probe.classify(429, True), 'ratelimited'))
T('502 → server', lambda: eq(probe.classify(502, True), 'server'))
T('418 → error', lambda: eq(probe.classify(418, True), 'error'))
T('None → unreachable', lambda: eq(probe.classify(None, True), 'unreachable'))

print('真实 HTTP 往返')
T('200 且能数出模型数', lambda: (lambda r: (eq(r['status'], 'ok'), eq(r.get('models'), 3)))(probe.probe_one(ep('/ok/models'))))
T('200 但无 data 字段时不瞎猜数量', lambda: (lambda r: (eq(r['status'], 'ok'), eq('models' in r, False)))(probe.probe_one(ep('/empty/models'))))
T('401 归 auth 并带出原因', lambda: (lambda r: (eq(r['status'], 'auth'), assert_in('invalid key', r['detail'])))(probe.probe_one(ep('/auth/models'))))
T('404 归 notfound 并带出原文', lambda: (lambda r: (eq(r['status'], 'notfound'), assert_in('no route', r['detail'])))(probe.probe_one(ep('/nf/models'))))
T('500 归 server', lambda: (lambda r: eq(r['status'], 'server'))(probe.probe_one(ep('/boom/models'))))
T('POST chat 探针能发出', lambda: (lambda r: eq(r['status'], 'ok'))(probe.probe_one(ep('/chat/chat/completions', 'chat', 'm1'))))
T('chat 缺 model 直接报错而不是发出去', lambda: (lambda r: eq(r['status'], 'error'))(probe.probe_one(ep('/chat/chat/completions', 'chat', None))))
T('403 说「缺 API key」→ 归 auth，不归被拒绝', lambda: (lambda r: eq(r['status'], 'auth'))(probe.probe_one(ep('/gk/models'))))
T('403 说「缺 API key」但带了 key → 归 badkey', lambda: (lambda r: eq(r['status'], 'badkey'))(probe.probe_one(ep('/gk/models'), key='sk-abcdefghijklmnop')))
T('403 只说 Access denied → 保持 forbidden', lambda: (lambda r: eq(r['status'], 'forbidden'))(probe.probe_one(ep('/deny/models'))))
T('超时归 unreachable', lambda: (lambda r: eq(r['status'], 'unreachable'))(probe.probe_one(ep('/slow/models'), timeout=0.3)))
T('连不上的端口归 unreachable', lambda: (lambda r: eq(r['status'], 'unreachable'))(
    probe.probe_one({'id': 'y', 'base': 'http://127.0.0.1:9', 'path': '/models', 'probe': 'models', 'env': 'Y'})))

print('密钥不泄露')


def no_leak():
    key = 'sk-verysecret1234567890'
    r = probe.probe_one(ep('/auth/models'), key=key)
    blob = json.dumps(r, ensure_ascii=False)
    assert key not in blob, '错误信息里带出了 key：' + blob
    eq(r['status'], 'badkey')


T('错误体回显 key 时被抹掉', no_leak)
T('redact 处理 Bearer 之类的前缀', lambda: assert_not_in('sk-abc', probe.redact('Authorization: Bearer sk-abcdefghijklmn', 'sk-abcdefghijklmn')))
T('redact 截断到 160 字符', lambda: assert_true(len(probe.redact('x' * 500, None)) <= 160))

print('CLI 与产物')


def offline():
    out = os.path.join(HERE, '.tmp-offline.json')
    rc = subprocess.call([sys.executable, os.path.join(HERE, 'probe', 'probe.py'),
                          '--offline', '--out', out], stdout=subprocess.DEVNULL)
    eq(rc, 0, 'offline 退出码')
    d = json.load(open(out, encoding='utf-8'))
    eq(d['schema'], 1)
    eq(d['counts']['skipped'], d['total'], 'offline 应全部 skipped')
    for k in ('generatedAt', 'runner', 'total', 'probed', 'counts', 'results'):
        assert k in d, '缺字段 ' + k
    os.remove(out)


T('--offline 生成合法结构', offline)


def endpoints_doc():
    d = json.load(open(os.path.join(HERE, 'probe', 'endpoints.json'), encoding='utf-8'))
    eq(d['schema'], 1)
    assert d['count'] == len(d['endpoints']), 'count 与条目数不一致'
    ids = [e['id'] for e in d['endpoints']]
    eq(len(ids), len(set(ids)), 'id 有重复')
    for e in d['endpoints']:
        assert e['base'].startswith('https://'), e['id'] + ' base 不是 https'
        assert e['path'].startswith('/'), e['id'] + ' path 不以 / 开头'
        assert e['env'].isupper(), e['id'] + ' env 不是全大写'


T('endpoints.json 结构合法', endpoints_doc)


def committed_probe():
    p = os.path.join(HERE, '..', 'probe.json')
    if not os.path.exists(p):
        return
    d = json.load(open(p, encoding='utf-8'))
    eq(d['schema'], 1)
    assert d['generatedAt'].endswith('Z'), 'generatedAt 不是 UTC 格式'
    ids = set(e['id'] for e in json.load(open(os.path.join(HERE, 'probe', 'endpoints.json'), encoding='utf-8'))['endpoints'])
    for k, v in d['results'].items():
        assert k in ids, 'probe.json 里出现未知 id：' + k
        assert v['status'] in probe.STATUSES, k + ' 的状态不在枚举内：' + v['status']
        blob = json.dumps(v, ensure_ascii=False)
        assert not re.search(r'sk-[A-Za-z0-9_-]{12,}', blob), k + ' 的 detail 里疑似带出了 key：' + blob
        assert not re.search(r'AIza[0-9A-Za-z_-]{20,}', blob), k + ' 里疑似带出了 Google key'
        assert isinstance(v.get('keyed'), bool), k + ' 的 keyed 不是布尔值'


T('仓库里的 probe.json 结构合法且无未知 id', committed_probe)


def statuses_cover():
    js = open(os.path.join(HERE, 'assets', 'probe.js'), encoding='utf-8').read()
    for s in probe.STATUSES:
        assert ("  %s:" % s) in js or ("'%s'" % s) in js, 'probe.js 没有处理状态 ' + s


T('probe.js 的 PROBE_STATUS 覆盖脚本所有状态', statuses_cover)


print('\n合计 %d 项，失败 %d 项' % (PASS[0] + FAIL[0], FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
