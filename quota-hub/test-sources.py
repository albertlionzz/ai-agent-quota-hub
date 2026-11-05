#!/usr/bin/env python3
"""sources.py 单测：离线兜底、字段解析、单源失败不扩散、产物结构合法。"""
import importlib.util
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('qh_sources', os.path.join(HERE, 'probe', 'sources.py'))
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)

PASS = 0
FAIL = 0


def ok(name, fn):
    global PASS, FAIL
    try:
        fn()
        PASS += 1
        print('  ok   ' + name)
    except Exception as e:
        FAIL += 1
        print('  FAIL ' + name + '\n       ' + str(e))


def eq(a, b, msg=''):
    assert a == b, '%s (got %r, want %r)' % (msg, a, b)


# ---------- 字段解析 ----------
ok('norm_date 只收 YYYY-MM-DD', lambda: (
    eq(S.norm_date('2026-10-22'), '2026-10-22'),
    eq(S.norm_date(' 2026-11-03 '), '2026-11-03'),
    eq(S.norm_date('2026/10/22'), None),
    eq(S.norm_date(None), None),
    eq(S.norm_date('garbage'), None),
))

ok('INTEL_SCAN 匹配带时间戳的巡检行', lambda: (
    eq(S.INTEL_SCAN.search('最近一次巡检：2026-11-03 11:50:08').group(1), '2026-11-03'),
    eq(S.INTEL_SCAN.search('最近一次巡检：2026-11-03 11:50:08').group(2), '11:50:08'),
))
ok('INTEL_SCAN 也认半角冒号与纯日期', lambda: (
    eq(S.INTEL_SCAN.search('最近一次巡检: 2026-11-05').group(1), '2026-11-05'),
    eq(S.INTEL_SCAN.search('最近一次巡检: 2026-11-05').group(2), None),
))
ok('INTEL_SCAN 不匹配无关文本', lambda: eq(S.INTEL_SCAN.search('本页更新于 2026-11-05'), None))

ok('header_date 优先 Last-Modified 并转成 UTC', lambda: (
    eq(S.header_date({'Last-Modified': 'Wed, 04 Nov 2026 12:00:00 GMT',
                      'Date': 'Wed, 04 Nov 2026 13:00:00 GMT'})[0], '2026-11-04T12:00:00Z'),
    eq(S.header_date({'Last-Modified': 'Wed, 04 Nov 2026 12:00:00 GMT'})[1], 'Last-Modified'),
))
ok('header_date 无 Last-Modified 时退回 Date', lambda: (
    eq(S.header_date({'date': 'Wed, 04 Nov 2026 13:00:00 GMT'})[1], 'Date'),
))
ok('header_date 无可靠头返回 (None, None)', lambda: (
    eq(S.header_date({}), (None, None)),
    eq(S.header_date({'Last-Modified': 'not-a-date'}), (None, None)),
))

# ---------- 离线 / 过滤 / 失败兜底 ----------
def t_offline():
    rows = S.collect(offline=True, timeout=1, only=None, fetched_at='2026-11-05T00:00:00Z')
    eq(len(rows), 3)
    eq([r['id'] for r in rows], ['freetoken', 'intel', 'relays'])
    eq([r['status'] for r in rows], ['offline'] * 3)
    eq(rows[0]['checkedAt'], '2026-10-22')
    eq(rows[2]['checkedAt'], None, 'relays 基线没有日期，不能编')
    for r in rows:
        assert r['note']
ok('离线模式三源全 offline 且沿用基线', t_offline)


def t_only():
    orig = dict(S.PROBES)
    called = []

    def fake_intel(timeout, fetched_at):
        called.append('intel')
        return ('2026-11-04', 'ok', 'fake')
    try:
        S.PROBES['intel'] = fake_intel
        S.PROBES['freetoken'] = lambda t, f: called.append('freetoken')
        S.PROBES['relays'] = lambda t, f: called.append('relays')
        rows = S.collect(offline=False, timeout=1, only={'intel'}, fetched_at='2026-11-05T00:00:00Z')
        eq(called, ['intel'], '只应真的请求被选中的源')
        eq(rows[0]['status'], 'offline')
        eq(rows[2]['status'], 'offline')
        eq(rows[1]['checkedAt'], '2026-11-04')
        eq(rows[1]['status'], 'ok')
    finally:
        S.PROBES.clear()
        S.PROBES.update(orig)
ok('--only 只复核选中的源，其余标 offline', t_only)


def t_failure():
    orig = dict(S.PROBES)

    def boom(timeout, fetched_at):
        raise RuntimeError('connection reset by peer')
    try:
        S.PROBES['freetoken'] = boom
        S.PROBES['intel'] = lambda t, f: ('2026-11-04', 'ok', 'ok')
        S.PROBES['relays'] = lambda t, f: ('2026-11-05T00:00:00Z', 'ok', 'ok')
        rows = S.collect(offline=False, timeout=1, only=None, fetched_at='2026-11-05T00:00:00Z')
        eq(rows[0]['status'], 'unreachable')
        eq(rows[0]['checkedAt'], '2026-10-22', '抓不到必须沿用基线，不能清空')
        assert 'connection reset' in rows[0]['note']
        eq(rows[1]['checkedAt'], '2026-11-04', '单源失败不影响其它源')
        eq(rows[2]['status'], 'ok')
    finally:
        S.PROBES.clear()
        S.PROBES.update(orig)
ok('单源异常被隔离，其余照常，失败源沿用基线', t_failure)


def t_nodate():
    orig = dict(S.PROBES)
    try:
        S.PROBES['freetoken'] = lambda t, f: (None, 'no-date', '缺 updated')
        S.PROBES['intel'] = lambda t, f: (None, 'no-date', '无巡检戳')
        S.PROBES['relays'] = lambda t, f: (f, 'no-date', '仅抓取时间')
        rows = S.collect(offline=False, timeout=1, only=None, fetched_at='2026-11-05T00:00:00Z')
        eq(rows[0]['checkedAt'], '2026-10-22')
        eq(rows[0]['status'], 'no-date')
        eq(rows[2]['checkedAt'], '2026-11-05T00:00:00Z')
    finally:
        S.PROBES.clear()
        S.PROBES.update(orig)
ok('no-date 不假装核实过，日期回退基线', t_nodate)

# ---------- 产物 ----------
def t_main():
    d = tempfile.mkdtemp(prefix='qh-sources-')
    out = os.path.join(d, 'crosscheck-sources.json')
    rc = S.main(['--offline', '--out', out, '--runner', 'unit-test'])
    eq(rc, 0)
    assert os.path.isfile(out)
    eq(os.path.exists(out + '.tmp'), False, '临时文件必须被原子替换掉')
    doc = json.load(open(out, encoding='utf-8'))
    eq(doc['schema'], 1)
    eq(doc['runner'], 'unit-test')
    eq(len(doc['sources']), 3)
    ids = [r['id'] for r in doc['sources']]
    eq(ids, [b['id'] for b in S.BASE], '产物 id 必须与前端 CC_SOURCES_BASE 对齐')
    for r in doc['sources']:
        for k in ('id', 'name', 'checkedAt', 'axis', 'url', 'status', 'note'):
            assert k in r, r['id'] + ' 缺字段 ' + k
    assert doc['fetchedAt'].endswith('Z')
ok('main(--offline) 产出结构合法且原子写', t_main)


def t_ids_match_js():
    """前端基线常量与 Python 基线必须逐字一致，否则快照覆盖会错位。"""
    p = os.path.join(HERE, 'assets', 'crosscheck.js')
    txt = open(p, encoding='utf-8').read()
    for b in S.BASE:
        assert "id: '%s'" % b['id'] in txt, '前端缺 id ' + b['id']
ok('Python 基线 id 与 crosscheck.js 对齐', t_ids_match_js)

print('\nsources.py 单测：%d 通过 / %d 失败' % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
