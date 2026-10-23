// 球隊管理密碼（tools/gate.js，V01.13.01）的測試
// 只測「這支手機上的通行證還有沒有效」：不連網、不驗簽章（使用者決定的基本機制，防一般人誤闖）。
// 通行證格式和 gas/Auth.gs 的 authIssueToken_ 相同：base64url(JSON{exp, role}) + '.' + 簽章
const assert = require('assert');
const { tokenValid } = require('../tools/gate');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✅ ' + name); }
  catch (e) { console.log('  ❌ ' + name + '\n     ' + e.message); process.exitCode = 1; }
};
// 做一張通行證（和 GAS 一樣：base64url、去掉補齊的 =）
const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (payload, sig = 'c2lnbmF0dXJl') => b64url(JSON.stringify(payload)) + '.' + sig;
const NOW = Date.UTC(2026, 9, 24, 4, 0, 0);   // 2026-10-24 12:00（台灣）
const DAY = 24 * 60 * 60 * 1000;

console.log('球隊管理密碼 tools/gate.js');

test('沒過期的通行證 → 放行（30 天的第 1 天、第 29 天）', () => {
  assert.strictEqual(tokenValid(token({ exp: NOW + 30 * DAY, role: 'staff' }), NOW), true);
  assert.strictEqual(tokenValid(token({ exp: NOW + DAY, role: 'staff' }), NOW), true);
});

test('已過期、剛好到期 → 擋', () => {
  assert.strictEqual(tokenValid(token({ exp: NOW - 1, role: 'staff' }), NOW), false);
  assert.strictEqual(tokenValid(token({ exp: NOW, role: 'staff' }), NOW), false);
});

test('壞掉的通行證：空白、null、沒有「.」、亂碼、不是 JSON、沒有到期時間、到期時間不是數字 → 擋', () => {
  [null, undefined, '', 'abc', '!!!.sig', b64url('not json') + '.sig', token({ role: 'staff' }), token({ exp: String(NOW + DAY) }), 'a.b.c']
    .forEach((t) => assert.strictEqual(tokenValid(t, NOW), false, JSON.stringify(t)));
});

test('base64url 的 -、_ 和沒補齊的 = 都讀得懂', () => {
  // 這個 payload 編碼後含 - 和 _，長度也不是 4 的倍數
  const p = { exp: NOW + DAY, role: 'staff', x: '>>>???~~~' };
  const t = token(p);
  assert.ok(/[-_]/.test(t.split('.')[0]) && t.split('.')[0].length % 4 !== 0, '測試資料要含 - 或 _、而且沒補齊');
  assert.strictEqual(tokenValid(t, NOW), true);
});

test('實際 GAS 發的通行證格式（gas/Auth.gs）也讀得懂', () => {
  const { createGasContext } = require('./gas_mock');
  const { ctx } = createGasContext({ files: ['gas/Code.gs', 'gas/Auth.gs', 'gas/Pitchers.gs', 'gas/Backup.gs'], props: { TEAM_PASSCODE: 'abc' } });
  const r = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'login', passcode: 'abc' }) } }).getContent());
  assert.strictEqual(tokenValid(r.token, Date.now()), true);
  assert.strictEqual(tokenValid(r.token, Date.now() + 31 * DAY), false);
});

console.log(`\n共 ${passed} 項通過`);
