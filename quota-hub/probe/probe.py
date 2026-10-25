#!/usr/bin/env python3
"""免费额度探活：对 endpoints.json 里每一家发一次最便宜的请求，产出 probe.json。

设计原则（这几条决定了它能不能长期跑下去）：

1. **没 key 也要探**。401/403 在这里不是失败，而是「端点存在且要鉴权」的证据。
   真正值得报警的是 404——那说明 base_url 写错了，跟 key 无关。
   所以零 secret 的情况下这个脚本依然有用，它验的是「路对不对」，不是「钱够不够」。

2. **永远不写 key**。只用 Authorization / x-api-key 头，响应体不进 JSON，
   错误信息里出现的 key 串一律替换成 [redacted]，并且截到 160 字符。

3. **不判死刑**。任何单家失败都不让 CI 红，退出码为 0；
   只有 --strict 时才在出现 404 时返回 2（这种情况确实需要人看一眼）。

4. **可合并**。GitHub Actions 跑的是海外 runner，境内平台的可达性不代表你在境内的情况。
   --merge 让本地跑一遍的结果和 CI 的结果合并，各自带 runner 标记。
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

UA = 'quota-hub-probe/1 (+https://github.com/albertlionzz/ai-agent-quota-hub)'
STATUSES = ('ok', 'auth', 'badkey', 'forbidden', 'notfound', 'ratelimited', 'server', 'unreachable', 'error', 'skipped')

# 代理回 502 时代替上游报的连接失败，说明是网络层问题
CONNECT_FAIL = re.compile(
    r'connect failed|connection refused|actively refused|积极拒绝|ECONNREFUSED|'
    r'name or service not known|getaddrinfo|no such host|tunnel connection failed',
    re.I)


def utc_now():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def redact(text, key):
    """把可能出现在错误信息里的密钥抹掉，再截断。宁可少给信息，也不能泄 key。"""
    s = str(text or '')
    if key and len(key) >= 8:
        s = s.replace(key, '[redacted]')
    s = re.sub(r'(?i)(bearer|api[-_]?key|authorization)[=:\s]+[^\s,;"\']+', r'\1 [redacted]', s)
    s = ' '.join(s.split())
    return s[:160]


def classify(code, keyed):
    """HTTP 状态码 → 我们要表达的语义。keyed 决定 401 到底是「缺 key」还是「key 坏了」。"""
    if code is None:
        return 'unreachable'
    if 200 <= code < 300:
        return 'ok'
    if code == 401:
        return 'badkey' if keyed else 'auth'
    if code == 403:
        # 403 和 401 是两回事：401 是「你没出示证件」，403 是「出示了也不让进」。
        # 实测里 403 大多是地域封锁（Cerebras 明说 blocked the country or region）
        # 或 IP / 权限限制，归到「需鉴权」会误导人白白去换 key。
        return 'forbidden'
    if code == 404:
        return 'notfound'
    if code == 429:
        return 'ratelimited'
    if 500 <= code < 600:
        return 'server'
    return 'error'


def count_models(body):
    """从 /models 响应里数出模型数量；数不出来就返回 None，不猜。"""
    try:
        j = json.loads(body.decode('utf-8', 'replace'))
    except Exception:
        return None
    for key in ('data', 'models', 'result'):
        v = j.get(key) if isinstance(j, dict) else None
        if isinstance(v, list):
            return len(v)
    return None


def extract_msg(body):
    """尽量从错误体里取一句人能看懂的话。取不到就退化成原始文本。"""
    raw = body.decode('utf-8', 'replace') if isinstance(body, bytes) else str(body or '')
    try:
        j = json.loads(raw)
        if isinstance(j, dict):
            for path in (('error', 'message'), ('error',), ('message',), ('msg',), ('error_msg',), ('detail',)):
                cur = j
                for k in path:
                    cur = cur.get(k) if isinstance(cur, dict) else None
                if isinstance(cur, str) and cur.strip():
                    return cur.strip()
    except Exception:
        pass
    return ' '.join(raw.split())


def build_request(ep, key):
    # probeBase 是给「兼容端点没实现 /models」的平台准备的（商汤就是这种情况）
    url = (ep.get('probeBase') or ep['base']).rstrip('/') + ep['path']
    headers = {'User-Agent': UA, 'Accept': 'application/json'}
    data = None
    method = 'GET'
    if key:
        if ep.get('probe') == 'anthropic':
            headers['x-api-key'] = key
            headers['anthropic-version'] = '2023-06-01'
        else:
            headers['Authorization'] = 'Bearer ' + key
    if ep.get('probe') == 'chat':
        method = 'POST'
        data = json.dumps({
            'model': ep.get('model'),
            'max_tokens': 1,
            'messages': [{'role': 'user', 'content': 'hi'}],
        }).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    return urllib.request.Request(url, data=data, headers=headers, method=method)


def probe_one(ep, key=None, timeout=12):
    """探一家。永不抛异常——探活脚本自己崩掉是最糟的结果。"""
    if ep.get('probe') == 'chat' and not ep.get('model'):
        return {'status': 'error', 'http': None, 'ms': 0, 'keyed': bool(key), 'detail': 'chat 探针缺少 model id', 'at': utc_now()}
    t0 = time.time()
    try:
        req = build_request(ep, key)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            code = r.status
            body = r.read(65536)
    except urllib.error.HTTPError as e:
        code = e.code
        try:
            body = e.read(65536)
        except Exception:
            body = b''
    except Exception as e:  # 网络层：DNS / TLS / 连接被拒 / 超时
        return {
            'status': 'unreachable',
            'http': None,
            'ms': int((time.time() - t0) * 1000),
            'keyed': bool(key),
            'detail': redact('%s: %s' % (type(e).__name__, e), key),
            'at': utc_now(),
        }
    ms = int((time.time() - t0) * 1000)
    status = classify(code, bool(key))
    out = {'status': status, 'http': code, 'ms': ms, 'keyed': bool(key), 'at': utc_now()}
    if status == 'ok':
        n = count_models(body)
        if n is not None:
            out['models'] = n
    else:
        out['detail'] = redact(extract_msg(body), key)
        # 代理和企业网关在连不上上游时常常回 502/503/504，报文里带 connect failed。
        # 这种情况是「网络到不了」，不是「对方服务端挂了」——分开报，人才知道该找谁。
        if status == 'server' and CONNECT_FAIL.search(out['detail']):
            out['status'] = 'unreachable'
            status = 'unreachable'
    return out


def summarize(results):
    counts = dict((s, 0) for s in STATUSES)
    for r in results.values():
        counts[r.get('status', 'error')] = counts.get(r.get('status', 'error'), 0) + 1
    return counts


def merge_results(old, new):
    """以 id 为单位覆盖：本次跑到的用本次结果，没跑到的保留旧值（并标出来自旧文件）。"""
    merged = dict(old or {})
    for k, v in new.items():
        merged[k] = v
    return merged


def run(endpoints, keys, timeout=12, workers=6, only=None, offline=False, merge_from=None, runner=None):
    picked = [e for e in endpoints if not only or e['id'] in only]
    skipped_by_filter = [e['id'] for e in endpoints if only and e['id'] not in only]

    results = {}
    if offline:
        for e in picked:
            results[e['id']] = {'status': 'skipped', 'http': None, 'ms': 0, 'keyed': False, 'detail': 'offline 模式未发起请求', 'at': utc_now()}
    else:
        with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
            futs = {pool.submit(probe_one, e, keys.get(e['id']) or os.environ.get(e['env']), timeout): e for e in picked}
            for f in futs:
                e = futs[f]
                try:
                    results[e['id']] = f.result()
                except Exception as ex:  # 兜底，理论上不会走到
                    results[e['id']] = {'status': 'error', 'http': None, 'ms': 0, 'keyed': False, 'detail': redact(ex, None), 'at': utc_now()}

    for i in skipped_by_filter:
        results[i] = {'status': 'skipped', 'http': None, 'ms': 0, 'keyed': False, 'detail': '本次未选中', 'at': utc_now()}

    if merge_from:
        try:
            with open(merge_from, encoding='utf-8') as f:
                old = (json.load(f) or {}).get('results') or {}
            for k, v in results.items():
                if v.get('status') == 'skipped' and k in old:
                    results[k] = old[k]
        except FileNotFoundError:
            pass
        except Exception as ex:
            print('merge 失败，忽略：%s' % ex, file=sys.stderr)

    payload = {
        'schema': 1,
        'generatedAt': utc_now(),
        'runner': runner or ('github-actions' if os.environ.get('GITHUB_ACTIONS') else 'local'),
        'total': len(endpoints),
        'probed': len([1 for r in results.values() if r.get('status') != 'skipped']),
        'counts': summarize(results),
        'results': results,
    }
    return payload


def main(argv=None):
    ap = argparse.ArgumentParser(description='免费额度端点探活，产出 probe.json')
    ap.add_argument('--endpoints', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'endpoints.json'))
    ap.add_argument('--out', default='probe.json')
    ap.add_argument('--timeout', type=float, default=12)
    ap.add_argument('--workers', type=int, default=6)
    ap.add_argument('--only', default='', help='只探这些 id，逗号分隔')
    ap.add_argument('--offline', action='store_true', help='不发请求，只生成结构（测试用）')
    ap.add_argument('--merge', default='', help='合并已有的 probe.json（本次 skipped 的沿用旧值）')
    ap.add_argument('--runner', default='', help='标记执行环境：local / github-actions')
    ap.add_argument('--strict', action='store_true', help='出现 404 时退出码为 2')
    a = ap.parse_args(argv)

    with open(a.endpoints, encoding='utf-8') as f:
        doc = json.load(f) or {}
    endpoints = doc.get('endpoints') or []
    if not endpoints:
        print('endpoints.json 里没有端点，先跑 node probe/gen_endpoints.js', file=sys.stderr)
        return 1

    only = set(x.strip() for x in a.only.split(',') if x.strip()) or None
    payload = run(endpoints, keys={}, timeout=a.timeout, workers=a.workers,
                  only=only, offline=a.offline, merge_from=a.merge, runner=a.runner or None)

    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, sort_keys=False)
        f.write('\n')

    c = payload['counts']
    print('探活完成 %s → %s' % (payload['generatedAt'], a.out))
    print('  可访问 %d · 需鉴权 %d · key 无效 %d · 被拒绝 %d · 404 %d · 限流 %d · 5xx %d · 不可达 %d' % (
        c.get('ok', 0), c.get('auth', 0), c.get('badkey', 0), c.get('forbidden', 0),
        c.get('notfound', 0), c.get('ratelimited', 0), c.get('server', 0), c.get('unreachable', 0)))

    if a.strict and c.get('notfound'):
        print('发现 %d 个 404：base_url 可能需要修正' % c['notfound'], file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
