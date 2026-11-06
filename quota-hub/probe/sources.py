#!/usr/bin/env python3
"""复核「交叉校验」引用的三个外部来源，产出 crosscheck-sources.json。

和 probe.py 是两件事，别混：
  - probe.py  探的是 **端点连通性**（GET /models，不耗额度）
  - sources.py 只抓 **来源公开的核实 / 巡检时间戳**，不解析、不采信任何额度数字

为什么只抓时间戳：额度口径是人工比对得出的，脚本没有能力替人判断
「谁说得对」。能自动化的只有「这份台账上次说是什么时候更新的」，
所以 CI 每 6 小时复核一次日期，让页面能显示「口径距今多少天」，
而不是一句含糊的「核对至某日」。抓不到就标 unreachable / offline，
保留基线日期并如实说明——绝不假装更新过。

零依赖（仅标准库），任何单源失败都不让 CI 红。
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.request import Request, urlopen

UA = 'quota-hub-sources/1 (+https://github.com/albertlionzz/ai-agent-quota-hub)'

# 与 assets/crosscheck.js 的 CC_SOURCES_BASE 一一对应。
# 抓不到外部数据时退回这里，status 标清楚是基线。
BASE = [
    {
        'id': 'freetoken', 'name': 'FreeToken', 'checkedAt': '2026-10-22',
        'axis': '额度口径', 'url': 'https://github.com/AIPMAndy/FreeToken/blob/main/data/providers.json',
    },
    {
        'id': 'intel', 'name': 'free-llm-intel', 'checkedAt': '2026-11-03',
        'axis': '额度口径', 'url': 'https://github.com/rockbenben/free-llm-intel',
    },
    {
        'id': 'relays', 'name': 'justjavac/free-models', 'checkedAt': None,
        'axis': '中转覆盖', 'url': 'https://models.denohub.com/catalog.json',
    },
]

RAW_FREETOKEN = 'https://raw.githubusercontent.com/AIPMAndy/FreeToken/main/data/providers.json'
RAW_INTEL = 'https://raw.githubusercontent.com/rockbenben/free-llm-intel/main/README.md'
CATALOG = 'https://models.denohub.com/catalog.json'

# 上游 README 把时间戳用 Markdown 加粗包住：「最近一次巡检：**2026-11-06 10:43:18**」。
# 早期版本没有 **，也没有时分秒，所以两种都要认；\s* 与 \*{0,2} 专门吃掉这层排版符。
INTEL_SCAN = re.compile(
    r'最近一次巡检[：:]\s*\*{0,2}\s*(\d{4}-\d{2}-\d{2})'
    r'(?:[\s*T]+(\d{2}:\d{2}:\d{2}))?'
)


def utc_now():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def fetch(url, timeout):
    req = Request(url, headers={'User-Agent': UA, 'Accept': '*/*'})
    with urlopen(req, timeout=timeout) as r:
        return r.read(), dict(r.headers.items())


def norm_date(s):
    """只接受 YYYY-MM-DD，别的时间格式宁可返回 None。"""
    if isinstance(s, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', s.strip()):
        return s.strip()
    return None


def header_date(headers):
    """HTTP 时间头 → ISO UTC。Last-Modified 优先，其次 Date。"""
    for key in ('Last-Modified', 'Date'):
        raw = headers.get(key) or headers.get(key.lower())
        if not raw:
            continue
        try:
            dt = parsedate_to_datetime(raw)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), key
        except (TypeError, ValueError, OverflowError):
            continue
    return None, None


def probe_freetoken(timeout, fetched_at):
    body, _ = fetch(RAW_FREETOKEN, timeout)
    obj = json.loads(body.decode('utf-8'))
    d = norm_date(obj.get('updated'))
    if not d:
        return None, 'no-date', 'providers.json 缺 updated 字段'
    n = len(obj.get('providers') or [])
    return d, 'ok', '台账 updated 字段 · 共 %d 条 provider' % n


def probe_intel(timeout, fetched_at):
    body, _ = fetch(RAW_INTEL, timeout)
    text = body.decode('utf-8', 'replace')
    m = INTEL_SCAN.search(text)
    if not m:
        return None, 'no-date', 'README 未找到「最近一次巡检」时间戳'
    # 原文没标时区，所以只取日期粒度，不硬凑成 UTC —— 差 8 小时比假装精确到秒好
    return m.group(1), 'ok', 'README 巡检时间戳 %s%s（原文未标时区，按日期粒度记）' % (
        m.group(1), (' ' + m.group(2)) if m.group(2) else '')


def probe_relays(timeout, fetched_at):
    _, headers = fetch(CATALOG, timeout)
    iso, key = header_date(headers)
    if iso:
        return iso, 'ok', 'HTTP %s 响应头（随每次部署更新）' % key
    # catalog.json 是静态生成、无内嵌版本号。没有时间头就只记抓取时间，
    # 并标 no-date，页面不会把它当成「来源核实日期」。
    return fetched_at, 'no-date', '无可靠时间头，仅记录本次抓取时间，不代表来源更新日期'


PROBES = {
    'freetoken': probe_freetoken,
    'intel': probe_intel,
    'relays': probe_relays,
}


def collect(offline, timeout, only, fetched_at):
    out = []
    for b in BASE:
        row = dict(b)
        if only and b['id'] not in only:
            # 没选中的不复核，但保留基线，status 说清楚
            row.update({'status': 'offline', 'note': '本次未复核（--only 过滤）', 'checkedAt': b['checkedAt']})
            out.append(row)
            continue
        if offline:
            row.update({'status': 'offline', 'note': '离线模式，沿用基线日期', 'checkedAt': b['checkedAt']})
            out.append(row)
            continue
        try:
            d, status, note = PROBES[b['id']](timeout, fetched_at)
            row.update({
                'checkedAt': d or b['checkedAt'],
                'status': status,
                'note': note,
            })
        except Exception as exc:  # 单源失败不影响其它源，也不让 CI 红
            row.update({
                'checkedAt': b['checkedAt'],
                'status': 'unreachable',
                'note': '联网复核失败（%s），沿用基线' % str(exc)[:120],
            })
        out.append(row)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default='crosscheck-sources.json', help='输出路径（默认仓库根）')
    ap.add_argument('--timeout', type=float, default=10.0, help='单个请求超时秒数')
    ap.add_argument('--offline', action='store_true', help='不联网，全部沿用基线并标 offline')
    ap.add_argument('--only', default='', help='只复核这些 id，逗号分隔')
    ap.add_argument('--runner', default='', help='执行环境标记，默认读 GITHUB_ACTIONS')
    args = ap.parse_args(argv)

    fetched_at = utc_now()
    runner = args.runner or ('github-actions' if os.environ.get('GITHUB_ACTIONS') == 'true' else 'local')
    only = set(x.strip() for x in args.only.split(',') if x.strip()) if args.only else None
    sources = collect(args.offline, args.timeout, only, fetched_at)

    doc = {
        'schema': 1,
        'fetchedAt': fetched_at,
        'runner': runner,
        'note': '只复核来源公开的时间戳，不解析额度内容；抓不到时 status=unreachable 并沿用基线。',
        'sources': sources,
    }

    out = os.path.abspath(args.out)
    parent = os.path.dirname(out)
    if parent and not os.path.isdir(parent):
        os.makedirs(parent, exist_ok=True)
    tmp = out + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write('\n')
    os.replace(tmp, out)

    for s in sources:
        print('  %-10s %-12s %s  %s' % (s['id'], s['status'], s['checkedAt'] or '-', s['note']))
    print('OK -> %s  (%d 源, %s)' % (out, len(sources), runner))
    return 0


if __name__ == '__main__':
    sys.exit(main())
