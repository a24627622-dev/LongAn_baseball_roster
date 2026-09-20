// 共用測試框架：把 lineup.html 的 <script> 抽出來在 VM 裡執行（極簡 Vue 替身），
// 後端實際執行 gas/Code.gs + Auth.gs + Pitchers.gs，試算表用模擬物件。
// tests/test_lineup_logic.js 與 tests/test_scenarios.js 共用這個檔案。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { createGasContext, MockSpreadsheet } = require('./gas_mock');

const html = fs.readFileSync(path.join(__dirname, '..', 'lineup.html'), 'utf8');
const scriptMatch = html.match(/<script>\r?\n([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  throw new Error('在 lineup.html 找不到內嵌的 <script> 區塊（檢查換行符號與 script 標籤格式）');
}
const script = scriptMatch[1];

// ---------- 極簡 Vue 替身 ----------
function makeVue(captured) {
  return {
    ref: (v) => ({ value: v }),
    computed: (fn) => ({ get value() { return fn(); } }),
    watch: (sources, cb) => captured.watchers.push({ sources, cb }),
    onMounted: (cb) => { captured.mounted = cb; },
    createApp: (def) => ({ mount: () => { captured.state = def.setup(); } }),
  };
}

// ---------- GAS 後端：實際執行 Code.gs + Auth.gs + Pitchers.gs，試算表用模擬物件 ----------
function makeBackend(props) {
  const ss = new MockSpreadsheet();
  const gas = createGasContext({ files: ['gas/Code.gs', 'gas/Auth.gs', 'gas/Pitchers.gs'], props, spreadsheet: ss });
  const calls = [];
  const handle = (data) => {
    const out = gas.ctx.doPost({ postData: { contents: JSON.stringify(data) } });
    const r = JSON.parse(out.getContent());
    const blocked = r && /^AUTH_/.test(r.code || '');
    if (!blocked && !['login', 'authStatus'].includes(data.action)) calls.push(data);
    return r;
  };
  const backend = { gas, calls, ss, handle: null };
  backend.handle = handle;
  return backend;
}
const gameSheet = (backend) => Object.values(backend.ss.sheets).find(sh => sh.name !== '調度紀錄');
// 讀出投手表：「順序」表頭下方，E 欄是 先發投手/後援投手 的列
function pitcherRows(backend) {
  const sh = gameSheet(backend);
  const h = sh.rows.findIndex(r => r && r[0] === '順序');
  const out = [];
  for (let i = h + 1; i < sh.rows.length; i++) {
    const r = sh.rows[i] || [];
    if (r[4] !== '先發投手' && r[4] !== '後援投手') break;
    out.push(`${r[4]}:${r[3]}`);
  }
  return out.join(',');
}
function batterNames(backend) {
  const sh = gameSheet(backend);
  const h = sh.rows.findIndex(r => r && r[0] === '打順');
  const out = [];
  for (let i = h + 1; i < sh.rows.length; i++) {
    const r = sh.rows[i] || [];
    if (r[4] !== '先發' && r[4] !== '替補') break;
    out.push(`${r[0]}${r[1].split(' ')[0]}${r[3]}`);
  }
  return out;
}

const ROSTER = [
  ['1', '陳一', true], ['2', '林二'], ['3', '黃三'], ['4', '張四'], ['5', '李五'],
  ['6', '王六'], ['7', '吳七'], ['8', '劉八'], ['9', '蔡九'], ['10', '楊十'],
  ['11', '許投', true], ['12', '鄭投', true], ['13', '謝替'], ['14', '郭替'],
].map(([n, name, isPitcher], i) => ({ id: i + 1, '背號': n, '球員姓名': name, isPitcher: !!isPitcher, isAttended: true }));

function boot({ props = {}, draft = null, loginPasscode = null, token = null } = {}) {
  const captured = { watchers: [] };
  const backend = makeBackend(props);
  const alerts = [];
  const storage = {
    longan_player_list: JSON.stringify(ROSTER),
  };
  if (draft) storage.longan_lineup_draft = JSON.stringify(draft);
  if (token) storage.longan_auth_token = token;
  let app;
  const ctx = {
    Vue: makeVue(captured),
    console, JSON, Date, Math, Promise, Set, Array, Object, String, parseInt, Error, URLSearchParams,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    escape: (s) => s.replace(/[^\w@*_+\-./]/g, c => { const h = c.charCodeAt(0).toString(16).toUpperCase(); return c.charCodeAt(0) < 256 ? '%' + h.padStart(2, '0') : '%u' + h.padStart(4, '0'); }),
    decodeURIComponent,
    alert: (m) => alerts.push(String(m)),
    confirm: () => true,
    localStorage: {
      getItem: k => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: k => { delete storage[k]; },
    },
    location: { reload() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async (url, opts) => {
      const data = JSON.parse(opts.body);
      const r = backend.handle(data);
      // 模擬使用者在登入視窗輸入密碼
      if (r && r.code === 'AUTH_REQUIRED' && loginPasscode !== null) {
        setTimeout(async () => {
          const s = app;
          if (!s.authModal.value.open) return;
          s.authModal.value.passcode = loginPasscode;
          await s.submitLogin();
          if (s.authModal.value.open) s.cancelLogin(); // 密碼錯誤 → 使用者按取消
        }, 0);
      }
      return { text: async () => JSON.stringify(r) };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  app = captured.state;
  captured.mounted(); // onMounted：讀快取名單 → restoreDraft
  const saveDraft = () => captured.watchers[0].cb();
  return { app, backend, alerts, storage, saveDraft };
}

const byName = (app, name) => app.players.value.find(p => p['球員姓名'] === name).id;
function setStarters(app, spec) {
  // spec: [[pos, name], ...] 共 9 棒
  app.lineup.value = spec.map(([pos, name]) => ({ positionCode: pos, playerId: byName(app, name) }));
}
function sub(app, order, name, pos) {
  app.openSubModal(order);
  app.subModal.value.selectedPlayerOption = name === 'SAME' ? 'SAME_PLAYER' : byName(app, name);
  app.subModal.value.selectedPosCode = pos;
  const willCancel = app.willCancelDH.value;
  app.confirmSubstitution();
  return willCancel;
}
function dhPitcherChange(app, name) {
  app.pitcherModal.value.selectedPlayerId = byName(app, name);
  app.confirmIndependentPitcherChange();
}
const pitcherNames = (app) => app.activePitchers.value.map(p => p.name).join(',');
const lastUpload = (backend) => backend.calls[backend.calls.length - 1];

const NINE = [['CF', '林二'], ['3B', '黃三'], ['SS', '張四'], ['C', '李五'], ['RF', '王六'], ['P', '陳一'], ['1B', '吳七'], ['2B', '劉八'], ['LF', '蔡九']];
const DH9 = [['CF', '林二'], ['3B', '黃三'], ['SS', '張四'], ['C', '李五'], ['RF', '王六'], ['DH', '楊十'], ['1B', '吳七'], ['2B', '劉八'], ['LF', '蔡九']];

const tick = () => new Promise(r => setTimeout(r, 5));

module.exports = {
  script, makeVue, makeBackend, gameSheet, pitcherRows, batterNames,
  ROSTER, boot, byName, setStarters, sub, dhPitcherChange,
  pitcherNames, lastUpload, NINE, DH9, tick,
};
