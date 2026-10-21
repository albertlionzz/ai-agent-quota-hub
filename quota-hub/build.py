#!/usr/bin/env python3
"""把 template + css + js 拼成单文件 HTML。占位符必须恰好命中一次，否则抛错。"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
OUT = ROOT.parent / "AI-Agent免费额度调度中台.html"

tpl = (ASSETS / "template.html").read_text(encoding="utf-8")
css = (ASSETS / "style.css").read_text(encoding="utf-8")
data = (ASSETS / "data.js").read_text(encoding="utf-8")
app = (ASSETS / "app.js").read_text(encoding="utf-8")
pipe = (ASSETS / "pipeline.js").read_text(encoding="utf-8")
cap = (ASSETS / "capability.js").read_text(encoding="utf-8")
orch = (ASSETS / "orchestrator.js").read_text(encoding="utf-8")
access = (ASSETS / "access.js").read_text(encoding="utf-8")
verify = (ASSETS / "verify.js").read_text(encoding="utf-8")
usage = (ASSETS / "usage.js").read_text(encoding="utf-8")
palette = (ASSETS / "palette.js").read_text(encoding="utf-8")

# 模块必须注入到 app.js 的 IIFE 内部，才能共用 $ / esc / PLATFORMS 等。
# 顺序有讲究：orchestrator 依赖 pipeline 的 dailyCapacity/pipeScriptable；
# access 依赖 pipeline 的 PIPE_BASE 端点表，两者都必须排在 pipeline 之后；
# verify 依赖 pipeline 的 downloadFile/copyText，同样必须排在 pipeline 之后。
# usage 是无依赖纯函数，放最前面，方便 renderWallet 与测试共同使用。
for ph, payload in [
    ("/*__USAGE__*/", usage),
    ("/*__CAP__*/", cap),
    ("/*__PIPE__*/", pipe),
    ("/*__ORCH__*/", orch),
    ("/*__ACCESS__*/", access),
    ("/*__VERIFY__*/", verify),
    ("/*__PALETTE__*/", palette),
]:
    if app.count(ph) != 1:
        raise SystemExit(f"app.js 中占位符 {ph} 命中 {app.count(ph)} 次，应为 1 次")
    app = app.replace(ph, payload)

parts = [("/*__STYLE__*/", css), ("/*__DATA__*/", data), ("/*__APP__*/", app)]

for ph, payload in parts:
    hits = tpl.count(ph)
    if hits != 1:
        raise SystemExit(f"占位符 {ph} 命中 {hits} 次，应为 1 次")
    tpl = tpl.replace(ph, payload)

OUT.write_text(tpl, encoding="utf-8")
size = OUT.stat().st_size
print(f"OK -> {OUT}")
print(f"   大小 {size:,} 字节 / {size/1024:.1f} KB")
