// ==========================================================================
// 龍安棒球隊 - 本機開發伺服器（不需要安裝任何套件，只要 Node.js）
//
// 啟動：在專案根目錄執行   node dev/server.js
// 然後用瀏覽器開啟：       http://localhost:8080/lineup.html
//
// 它做三件事：
//   1. 把專案資料夾當成網站提供（跟 GitHub Pages 一樣的檔案）
//   2. 在 /gas 模擬 Google Apps Script：實際執行 gas/ 裡的 Code.gs、Auth.gs、Pitchers.gs，
//      但寫入的是「假的試算表」（存在 dev/data/sheets.json），完全不會碰到正式的 Google 試算表
//   3. 在 /dev 提供檢視頁，可以看假試算表目前的內容、清空重來
//
// 每次請求都會重新讀取 .gs 檔，所以在 VS Code 改完 .gs 存檔後，不用重開伺服器。
// 按 Ctrl + C 停止伺服器。
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createGasContext, MockSheet, MockSpreadsheet } = require('../tests/gas_mock');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sheets.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const ROSTER_FILE = path.join(__dirname, 'roster.json');
const GAS_FILES = ['gas/Code.gs', 'gas/Auth.gs', 'gas/Pitchers.gs'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.md': 'text/plain; charset=utf-8',
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) { return fallback; }
}

// ---------- 設定（dev/config.json，可自行修改，改完不用重開）----------
function loadConfig() {
  const cfg = readJson(CONFIG_FILE, {});
  return {
    port: cfg.port || 8080,
    TEAM_PASSCODE: cfg.TEAM_PASSCODE == null ? 'longan-dev' : String(cfg.TEAM_PASSCODE),
    AUTH_ENFORCED: cfg.AUTH_ENFORCED ? 'true' : 'false',
    delayMs: cfg.delayMs || 0,
  };
}

// 指令碼屬性與快取在伺服器執行期間共用（登入錯誤次數、AUTH_SECRET 才不會每次重置）
const propsStore = {};
const cacheStore = {};

// ---------- 假試算表：讀取／存檔 ----------
function buildRosterSheet() {
  const roster = readJson(ROSTER_FILE, []);
  const headers = ['背號', '球員姓名', '守位一', '守位二', '守位三'];
  const rows = [headers];
  const bg = [[]];
  roster.forEach(p => {
    rows.push(headers.map(h => (p[h] == null ? '' : p[h])));
    bg.push(['', p.isPitcher ? '#ffd966' : '']); // 姓名欄塗黃色 = 投手（跟正式試算表規則一樣）
  });
  return new MockSheet('球員名單', rows, bg);
}

function loadSpreadsheet() {
  const ss = new MockSpreadsheet();
  const saved = readJson(DATA_FILE, {});
  Object.keys(saved).forEach(name => { ss.sheets[name] = new MockSheet(name, saved[name].rows, saved[name].bg); });
  ss.sheets['球員名單'] = buildRosterSheet(); // 名單一律以 dev/roster.json 為準
  return ss;
}

function saveSpreadsheet(ss) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const out = {};
  Object.keys(ss.sheets).forEach(name => {
    if (name === '球員名單') return;
    out[name] = { rows: ss.sheets[name].rows, bg: ss.sheets[name].bg };
  });
  fs.writeFileSync(DATA_FILE, JSON.stringify(out, null, 1), 'utf8');
}

function runGas(fn, arg) {
  const cfg = loadConfig();
  propsStore.TEAM_PASSCODE = cfg.TEAM_PASSCODE;
  propsStore.AUTH_ENFORCED = cfg.AUTH_ENFORCED;
  const ss = loadSpreadsheet();
  const { ctx, logs } = createGasContext({ files: GAS_FILES, spreadsheet: ss, propsStore, cacheStore });
  const output = ctx[fn](arg);
  saveSpreadsheet(ss);
  logs.forEach(l => console.log('   [Logger] ' + l));
  return output.getContent();
}

// ---------- 檢視頁 ----------
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function devPage() {
  const ss = loadSpreadsheet();
  const cfg = loadConfig();
  const names = Object.keys(ss.sheets).sort((a, b) => (a === '球員名單' ? -1 : b === '球員名單' ? 1 : a.localeCompare(b)));
  const tables = names.map(name => {
    const sh = ss.sheets[name];
    const width = Math.max(1, ...sh.rows.map(r => (r || []).length));
    const body = sh.rows.map((r, i) => {
      const cells = [];
      for (let j = 0; j < width; j++) {
        const v = (r || [])[j];
        const isF = typeof v === 'string' && v.startsWith('=');
        cells.push(`<td class="${isF ? 'f' : ''}" title="${esc(v)}">${isF ? 'ƒ' : esc(v)}</td>`);
      }
      return `<tr><th>${i + 1}</th>${cells.join('')}</tr>`;
    }).join('');
    const colHead = Array.from({ length: width }, (_, j) => `<th>${String.fromCharCode(65 + (j % 26))}${j >= 26 ? '*' : ''}</th>`).join('');
    return `<details ${name !== '球員名單' ? 'open' : ''}><summary>${esc(name)}（${sh.getLastRow()} 列）</summary>
      <div class="wrap"><table><tr><th></th>${colHead}</tr>${body}</table></div></details>`;
  }).join('');
  return `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>本機假試算表</title><style>
body{font-family:system-ui,sans-serif;margin:16px;background:#f8fafc;color:#0f172a}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.bar a,.bar button{padding:6px 12px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;text-decoration:none;font-size:14px;cursor:pointer}
.bar .danger{background:#fee2e2;border-color:#fca5a5}
.info{font-size:13px;color:#475569;margin:0 0 12px}
details{background:#fff;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:12px;padding:8px}
summary{font-weight:700;cursor:pointer}
.wrap{overflow:auto;max-height:70vh;margin-top:8px}
table{border-collapse:collapse;font-size:12px;white-space:nowrap}
td,th{border:1px solid #e2e8f0;padding:2px 6px}
th{background:#f1f5f9;position:sticky;top:0}
td.f{color:#94a3b8;text-align:center}
</style></head><body>
<h2>🧪 本機假試算表</h2>
<p class="info">隊務密碼：<b>${esc(cfg.TEAM_PASSCODE)}</b>　｜　強制登入（AUTH_ENFORCED）：<b>${cfg.AUTH_ENFORCED}</b>　｜　設定檔：dev/config.json　｜　公式儲存格以 ƒ 表示（滑鼠停留可看內容）</p>
<div class="bar">
  <a href="/lineup.html" target="_blank">開啟陣容調度助手</a>
  <a href="/index.html" target="_blank">開啟首頁</a>
  <button onclick="location.reload()">重新整理</button>
  <form method="post" action="/dev/reset" onsubmit="return confirm('確定清空所有假比賽資料？（球員名單不受影響）')"><button class="danger">清空假資料</button></form>
</div>
${tables}
</body></html>`;
}

// ---------- HTTP ----------
function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  const t0 = Date.now();

  if (pathname === '/gas') {
    const cfg = loadConfig();
    if (req.method === 'GET') {
      try {
        const out = runGas('doGet', { parameter: Object.fromEntries(url.searchParams) });
        console.log(`GET  /gas  → 球員名單 (${Date.now() - t0}ms)`);
        return setTimeout(() => send(res, 200, out, 'application/json; charset=utf-8'), cfg.delayMs);
      } catch (e) {
        console.error('❌ doGet 發生錯誤：', e);
        return send(res, 500, JSON.stringify({ success: false, message: 'doGet 錯誤：' + e.message }), 'application/json; charset=utf-8');
      }
    }
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let action = '?';
        try { action = JSON.parse(body).action; } catch (e) { /* 交給 doPost 處理 */ }
        try {
          const out = runGas('doPost', { postData: { contents: body, type: 'text/plain' } });
          const r = JSON.parse(out);
          console.log(`POST /gas  action=${action}  → ${r.success === false ? '❌ ' + (r.code || '') + ' ' + (r.message || '') : '✅ ' + (r.message || 'OK')} (${Date.now() - t0}ms)`);
          setTimeout(() => send(res, 200, out, 'application/json; charset=utf-8'), cfg.delayMs);
        } catch (e) {
          console.error(`❌ doPost(action=${action}) 發生錯誤：`, e);
          send(res, 500, JSON.stringify({ success: false, message: 'doPost 錯誤：' + e.message }), 'application/json; charset=utf-8');
        }
      });
      return;
    }
  }

  if (pathname === '/dev' || pathname === '/dev/') return send(res, 200, devPage(), 'text/html; charset=utf-8');
  if (pathname === '/dev/reset' && req.method === 'POST') {
    try { fs.unlinkSync(DATA_FILE); } catch (e) { /* 本來就沒有 */ }
    console.log('🧹 已清空假試算表資料');
    res.writeHead(303, { Location: '/dev' });
    return res.end();
  }

  // 靜態檔案
  let file = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(ROOT) || /[\\/](\.git|dev[\\/]data)([\\/]|$)/.test(file)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err2, data) => {
      if (err2) return send(res, 404, '找不到檔案：' + pathname);
      send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    });
  });
});

const PORT = Number(process.env.PORT) || loadConfig().port;
server.listen(PORT, () => {
  const cfg = loadConfig();
  console.log('');
  console.log('⚾ 龍安棒球隊 本機開發伺服器已啟動');
  console.log(`   陣容調度助手：http://localhost:${PORT}/lineup.html`);
  console.log(`   首頁：        http://localhost:${PORT}/`);
  console.log(`   假試算表檢視：http://localhost:${PORT}/dev`);
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  lan.forEach(ip => console.log(`   手機（同一個 Wi-Fi）：http://${ip}:${PORT}/lineup.html`));
  console.log(`   隊務密碼：${cfg.TEAM_PASSCODE}　強制登入：${cfg.AUTH_ENFORCED}（dev/config.json 可修改）`);
  console.log('   資料只寫到 dev/data/sheets.json，不會動到正式 Google 試算表。按 Ctrl + C 停止。');
  console.log('');
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`❌ 連接埠 ${PORT} 已被占用：可能伺服器已經開著，或改用  $env:PORT=8081; node dev/server.js`);
  else console.error(e);
  process.exit(1);
});
