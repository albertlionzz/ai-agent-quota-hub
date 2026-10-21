/* ============================================================
   钱包备份的导出 / 导入（纯函数）
   ------------------------------------------------------------
   解决的问题：数据只存在浏览器 localStorage 里，换设备或清缓存就没了。
   这里只负责「序列化」与「校验归一」，不碰 DOM，方便单测。
   导入必须挑剔：宁可报错让人重来，也不要把半截脏数据写进钱包——
   一旦写坏，用户看到的余量就是错的，而他还以为是对的。
   ============================================================ */

const WIO_SCHEMA = 1;

/* 导出载荷 */
function walletPayload(wallet, now) {
  const at = now instanceof Date ? now : new Date(now || Date.now());
  return {
    app: 'ai-agent-quota-hub',
    schema: WIO_SCHEMA,
    exportedAt: at.toISOString(),
    dataDate: (typeof DATA_DATE !== 'undefined' ? DATA_DATE : null),
    wallet: wallet || {}
  };
}

/* 备份文件名：带上日期，方便区分多次导出 */
function walletFileName(now) {
  return 'quota-hub-wallet-' + todayKey(now) + '.json';
}

/* 解析并归一。
   knownIds: Set，用来剔掉平台库里不存在的 id（旧版本备份、手改文件）。
   返回 { ok, error, entries, unknown, bad, meta } —— ok 为 false 时 error 说人话。 */
function parseWalletBackup(text, knownIds, now) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: '文件是空的。' };
  }

  let raw;
  try { raw = JSON.parse(text); }
  catch (e) { return { ok: false, error: '不是合法的 JSON，可能是导出时被截断了。' }; }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '文件结构不对：顶层应该是对象。' };
  }

  /* 两种来源都接受：本工具导出的 {wallet:{...}}，或一份裸的 {平台id:{...}}。
     裸 map 的判定要求「至少有一个 key 是已知平台 id」——
     否则随便一个 JSON 都会被当成钱包，导进去全是未知项。 */
  let map = null;
  if (raw.wallet && typeof raw.wallet === 'object' && !Array.isArray(raw.wallet)) {
    map = raw.wallet;
  } else if (knownIds) {
    const keys = Object.keys(raw);
    if (keys.some(k => knownIds.has(k))) map = raw;
  }

  if (!map) {
    return { ok: false, error: '文件里找不到 wallet 字段，看起来不是本工具导出的备份。' };
  }

  const entries = {};
  const unknown = [];
  let bad = 0;

  Object.keys(map).forEach(id => {
    const v = map[id];
    if (!v || typeof v !== 'object' || Array.isArray(v)) { bad++; return; }
    if (knownIds && !knownIds.has(id)) { unknown.push(id); return; }

    const used = parseTok(v.used);
    entries[id] = {
      enabled: v.enabled !== false,
      used: used == null ? 0 : used,
      usedDate: typeof v.usedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.usedDate)
        ? v.usedDate : null,
      note: typeof v.note === 'string' ? v.note.slice(0, 80) : ''
    };
  });

  const n = Object.keys(entries).length;
  if (!n) {
    const tail = unknown.length ? `（其中 ${unknown.length} 个平台 id 不在当前平台库里）` : '';
    return { ok: false, error: '没有可导入的平台' + tail, unknown };
  }

  return {
    ok: true,
    entries,
    unknown,
    bad,
    meta: { schema: raw.schema || null, exportedAt: raw.exportedAt || null, dataDate: raw.dataDate || null }
  };
}

/* 两种合并方式：
   merge   —— 只补当前清单里没有的平台，已有平台的原样保留（不动别人的用量）
   replace —— 整份替换 */
function applyWalletBackup(current, entries, mode) {
  const cur = current || {};
  if (mode === 'replace') return Object.assign({}, entries);

  const out = Object.assign({}, cur);
  Object.keys(entries || {}).forEach(id => {
    if (!out[id]) out[id] = entries[id];
  });
  return out;
}

/* 导入预览的人类可读摘要 */
function describeBackup(entries, current) {
  const ids = Object.keys(entries || {});
  const exist = ids.filter(id => current && current[id]);
  const fresh = ids.filter(id => !(current && current[id]));
  return { total: ids.length, existCount: exist.length, freshCount: fresh.length, ids };
}
