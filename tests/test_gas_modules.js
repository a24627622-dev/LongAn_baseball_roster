const assert = require('assert');
const { createGasContext, MockSpreadsheet } = require('./gas_mock');
const fs = require('fs');
const path = require('path');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✅ ' + name); }
  catch (e) { console.log('  ❌ ' + name + '\n     ' + e.message); process.exitCode = 1; }
};
const out = (o) => JSON.parse(o.getContent());

console.log('Auth.gs');
{
  const files = ['gas/Auth.gs'];

  test('未設定密碼時，登入回傳 AUTH_NOT_CONFIGURED', () => {
    const { ctx } = createGasContext({ files });
    assert.strictEqual(out(ctx.authGate_({ action: 'login', passcode: 'x' })).code, 'AUTH_NOT_CONFIGURED');
  });

  test('密碼正確 → 取得 token；token 驗證通過', () => {
    const { ctx } = createGasContext({ files, props: { TEAM_PASSCODE: '龍安2026' } });
    const r = out(ctx.authGate_({ action: 'login', passcode: '龍安2026' }));
    assert.ok(r.success && r.token);
    assert.strictEqual(ctx.authVerifyToken_(r.token), true);
  });

  test('密碼錯誤 → AUTH_FAILED，不給 token', () => {
    const { ctx } = createGasContext({ files, props: { TEAM_PASSCODE: 'abc' } });
    const r = out(ctx.authGate_({ action: 'login', passcode: 'abd' }));
    assert.strictEqual(r.code, 'AUTH_FAILED');
    assert.ok(!r.token);
  });

  test('連錯 10 次後鎖住，連正確密碼也暫時不能登入', () => {
    const { ctx, cache } = createGasContext({ files, props: { TEAM_PASSCODE: 'abc' } });
    for (let i = 0; i < 10; i++) ctx.authGate_({ action: 'login', passcode: 'no' });
    assert.strictEqual(out(ctx.authGate_({ action: 'login', passcode: 'abc' })).code, 'AUTH_LOCKED');
    delete cache.auth_fail_count; // 模擬 10 分鐘過後快取過期
    assert.strictEqual(out(ctx.authGate_({ action: 'login', passcode: 'abc' })).success, true);
  });

  test('登入成功後錯誤次數歸零', () => {
    const { ctx, cache } = createGasContext({ files, props: { TEAM_PASSCODE: 'abc' } });
    for (let i = 0; i < 5; i++) ctx.authGate_({ action: 'login', passcode: 'no' });
    ctx.authGate_({ action: 'login', passcode: 'abc' });
    assert.ok(!('auth_fail_count' in cache));
  });

  test('強制模式：沒 token 的寫入被擋 (AUTH_REQUIRED)', () => {
    const { ctx } = createGasContext({ files, props: { TEAM_PASSCODE: 'abc', AUTH_ENFORCED: 'true' } });
    assert.strictEqual(out(ctx.authGate_({ action: 'saveStarters' })).code, 'AUTH_REQUIRED');
  });

  test('強制模式：有效 token 放行 (回傳 null)', () => {
    const { ctx } = createGasContext({ files, props: { TEAM_PASSCODE: 'abc', AUTH_ENFORCED: 'TRUE' } });
    const token = out(ctx.authGate_({ action: 'login', passcode: 'abc' })).token;
    assert.strictEqual(ctx.authGate_({ action: 'saveSubstitutions', token }), null);
  });

  test('測試模式 (AUTH_ENFORCED 未設)：沒 token 也放行', () => {
    const { ctx } = createGasContext({ files, props: { TEAM_PASSCODE: 'abc' } });
    assert.strictEqual(ctx.authGate_({ action: 'saveStarters' }), null);
  });

  test('竄改 token 內容 → 驗證失敗', () => {
    const { ctx } = createGasContext({ files, props: { TEAM_PASSCODE: 'abc', AUTH_ENFORCED: 'true' } });
    const token = out(ctx.authGate_({ action: 'login', passcode: 'abc' })).token;
    const [, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 9e12, role: 'staff' })).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.' + sig;
    assert.strictEqual(ctx.authVerifyToken_(forged), false);
    assert.strictEqual(ctx.authVerifyToken_('garbage'), false);
    assert.strictEqual(ctx.authVerifyToken_('a.b.c'), false);
    assert.strictEqual(ctx.authVerifyToken_(''), false);
  });

  test('token 過期 → 驗證失敗', () => {
    let t = Date.now();
    const { ctx } = createGasContext({ files, props: { TEAM_PASSCODE: 'abc' }, now: () => t });
    const token = out(ctx.authGate_({ action: 'login', passcode: 'abc' })).token;
    t += 29 * 86400000;
    assert.strictEqual(ctx.authVerifyToken_(token), true);
    t += 2 * 86400000;
    assert.strictEqual(ctx.authVerifyToken_(token), false);
  });

  test('rotateAuthSecret 後，舊 token 全部失效', () => {
    const { ctx } = createGasContext({ files, props: { TEAM_PASSCODE: 'abc' } });
    const token = out(ctx.authGate_({ action: 'login', passcode: 'abc' })).token;
    ctx.rotateAuthSecret();
    assert.strictEqual(ctx.authVerifyToken_(token), false);
  });

  test('authStatus 回報強制模式與 token 狀態', () => {
    const { ctx } = createGasContext({ files, props: { TEAM_PASSCODE: 'abc', AUTH_ENFORCED: 'true' } });
    const r = out(ctx.authGate_({ action: 'authStatus', token: 'x' }));
    assert.deepStrictEqual([r.enforced, r.valid], [true, false]);
  });

  test('checkAuthSetup 不會把密碼寫進紀錄', () => {
    const { ctx, logs } = createGasContext({ files, props: { TEAM_PASSCODE: 'secret-xyz' } });
    ctx.checkAuthSetup();
    assert.ok(!logs.join('\n').includes('secret-xyz'));
  });
}

console.log('Pitchers.gs');
{
  const { ctx } = createGasContext({ files: ['gas/Pitchers.gs'] });
  const P = (id, number, name, extra = {}) => ({ id, number, name, pos: 'P', ...extra });
  const X = (id, number, name, pos, extra = {}) => ({ id, number, name, pos, ...extra });
  const names = arr => arr.map(p => `${p.role}:${p.name}`).join(',');

  test('一般 9 人：沒有 data.pitchers 時，從打序找到先發投手', () => {
    const r = ctx.resolvePitchers_({ lineup: [X(1, '10', '甲', 'CF'), P(2, '18', '乙')] });
    assert.strictEqual(names(r), '先發:乙');
  });

  test('一般 9 人 + 中途換投（舊版 payload，只有 activeLineup）', () => {
    const r = ctx.resolvePitchers_({ activeLineup: [
      { starter: P(2, '18', '乙'), substitutes: [P(5, '21', '丙', { timestamp: 200 })] },
      { starter: X(1, '10', '甲', 'CF'), substitutes: [P(6, '33', '丁', { timestamp: 100 })] },
    ] });
    assert.strictEqual(names(r), '先發:乙,後援:丁,後援:丙');
  });

  test('全場 DH：投手不在打序，data.pitchers 正確帶入先發與後援', () => {
    const r = ctx.resolvePitchers_({
      activeLineup: [{ starter: X(1, '10', '甲', 'DH'), substitutes: [] }],
      pitchers: [P(9, '18', '投A', { reason: '先發投手 (DH制)' }), P(8, '21', '投B', { reason: '比賽中更換投手' })],
    });
    assert.strictEqual(names(r), '先發:投A,後援:投B');
    assert.strictEqual(r[0].note, '先發投手 (DH制)');
  });

  test('DH 中途取消：同一位投手重複出現只保留一列', () => {
    const r = ctx.resolvePitchers_({ pitchers: [P(9, '18', '投A'), P(9, '18', '投A'), P(7, '5', '投C')] });
    assert.strictEqual(names(r), '先發:投A,後援:投C');
  });

  test('姓名前面的「↳ 」會被清掉，空白姓名被略過', () => {
    const r = ctx.resolvePitchers_({ pitchers: [P(9, 18, '↳ 投A'), P(0, '', '')] });
    assert.deepStrictEqual([r.length, r[0].name, r[0].number], [1, '投A', '18']);
  });

  test('空 payload 不會出錯', () => {
    assert.strictEqual(ctx.resolvePitchers_({}).length, 0);
    assert.strictEqual(ctx.resolvePitchers_(null).length, 0);
  });
}

console.log('\nBackup.gs（實況賽事紀錄的雲端備份：一場一頁「賽事紀錄_比賽ID」、一筆紀錄一列）');
{
  const files = ['gas/Code.gs', 'gas/Auth.gs', 'gas/Pitchers.gs', 'gas/Backup.gs'];
  const GC = require('../game-core');
  const g0830 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', '2026-08-30_G4_雨人.events.json'), 'utf8'));
  const GID = g0830.setup.id;                 // 2026-08-30_G4_雨人
  const SHEET = '賽事紀錄_2026-08-30_G4_雨人';
  // 手機端送出的內容：開賽設定＋表格列（game-core.js 的 sheetRows，前 n 筆紀錄）
  const payload = (n = g0830.events.length, setup = g0830.setup) => ({
    action: 'saveRecordBackup', gameId: setup.id, setup, rows: GC.sheetRows(setup, g0830.events.slice(0, n)),
  });
  const make = (props) => { const ss = new MockSpreadsheet(); const g = createGasContext({ files, props, spreadsheet: ss }); return { ss, ...g }; };
  const post = (ctx, data) => out(ctx.doPost({ postData: { contents: JSON.stringify(data) } }));
  const values = (ss, name = SHEET) => ss.getSheetByName(name).getDataRange().getValues();
  const load = (ctx, gameId = GID) => post(ctx, { action: 'loadRecordBackup', gameId });

  test('第一次上傳：建立「賽事紀錄_比賽ID」分頁，上方是比賽資料，空一列後是半局標題和紀錄', () => {
    const { ss, ctx } = make();
    const r = post(ctx, payload(3));
    assert.strictEqual(r.success, true);
    const v = values(ss);
    assert.deepStrictEqual(v.slice(0, 4).map((x) => x.slice(0, 2)),
      [['比賽 ID', GID], ['比賽日期', '2026-08-30'], ['比賽場次', 'G4'], ['對手名稱', '雨人']]);
    assert.deepStrictEqual([v[4][0], v[5][0]], ['建立時間', '更新時間']);
    assert.ok(v[4][1] && v[5][1], '時間沒寫');
    assert.deepStrictEqual(v[6].slice(0, 4), ['', '', '', '']);
    assert.deepStrictEqual(v[7].slice(0, 4), ['一局上', '龍安攻', '0分', '']);   // 前 3 筆還沒有人得分
    assert.deepStrictEqual(v[8].slice(0, 4), ['第一棒', '二滾', '#56 蘇垣華', '二壘滾地球出局']);
    assert.strictEqual(v.length, 11);
  });

  test('再上傳整頁重寫：紀錄變少（復原過）時，下面多出來的舊列要清掉', () => {
    const { ss, ctx } = make();
    post(ctx, payload(20));
    post(ctx, payload(2));
    const v = values(ss);
    assert.strictEqual(v.length, 10);
    assert.deepStrictEqual(v[9].slice(0, 3), ['第二棒', '四壞', '#17 蘇巽雄']);
  });

  test('重寫時「建立時間」保留第一次的，「更新時間」換成這次的', () => {
    const { ss, ctx } = make();
    post(ctx, payload(3));
    const sh = ss.getSheetByName(SHEET);
    sh.getRange(5, 2).setValue('2026/08/30 09:00');
    sh.getRange(6, 2).setValue('2026/08/30 09:00');
    post(ctx, payload(4));
    const v = values(ss);
    assert.strictEqual(v[4][1], '2026/08/30 09:00');
    assert.notStrictEqual(v[5][1], '2026/08/30 09:00');
  });

  test('8/30 整場 69 筆存進去再讀回：開賽設定和每一筆紀錄完全一樣', () => {
    const { ctx } = make();
    assert.strictEqual(post(ctx, payload()).success, true);
    const r = load(ctx);
    assert.strictEqual(r.success, true);
    assert.deepStrictEqual(r.record, { setup: g0830.setup, events: g0830.events });
  });

  test('讀回時略過半局標題列和空白列（中間被人插了空白列也一樣）', () => {
    const { ss, ctx } = make();
    post(ctx, payload(10));
    ss.getSheetByName(SHEET).insertRowsAfter(9, 2);
    assert.deepStrictEqual(load(ctx).record.events, g0830.events.slice(0, 10));
  });

  test('讀不存在的比賽 → 找不到（success false）', () => {
    const { ctx } = make();
    const r = load(ctx);
    assert.strictEqual(r.success, false);
    assert.match(r.message, /找不到這場比賽的雲端備份/);
  });

  test('E 欄被改壞：讀回失敗，訊息指出第幾列', () => {
    const { ss, ctx } = make();
    post(ctx, payload(3));
    ss.getSheetByName(SHEET).getRange(10, 5).setValue('{壞掉');
    const r = load(ctx);
    assert.strictEqual(r.success, false);
    assert.match(r.message, /第 10 列/);
  });

  test('異常輸入：比賽 ID 格式錯、缺開賽設定或表格列、開賽設定的 ID 不同、紀錄列沒有資料 → 拒絕，不建立分頁', () => {
    const { ss, ctx } = make();
    const ok = payload(3);
    const bad = [
      { ...ok, gameId: '亂打' },
      { ...ok, setup: undefined },
      { ...ok, rows: undefined },
      { ...ok, gameId: '2026-08-30_G3_雨人' },
      { ...ok, rows: [{ type: 'event', cells: ['', '', '', ''] }] },
      { ...ok, rows: [{ type: 'event', cells: ['a'], ev: { t: 'end' } }] },
    ];
    bad.forEach((d) => assert.strictEqual(post(ctx, d).success, false, JSON.stringify(d).slice(0, 80)));
    assert.match(post(ctx, bad[1]).message, /不完整/);
    assert.deepStrictEqual(Object.keys(ss.sheets), []);
  });

  test('對手名稱有特殊字元：分頁名稱照陣容調度工具的規則換成「-」，讀得回來；同名分頁屬於別場時拒絕', () => {
    const { ss, ctx } = make();
    const setup = { ...g0830.setup, id: '2026-08-30_G4_A/B', opponent: 'A/B' };
    const p = { ...payload(2, setup), setup };
    assert.strictEqual(post(ctx, p).success, true);
    assert.ok(ss.getSheetByName('賽事紀錄_2026-08-30_G4_A-B'));
    assert.deepStrictEqual(load(ctx, '2026-08-30_G4_A/B').record.events, g0830.events.slice(0, 2));
    const other = { ...g0830.setup, id: '2026-08-30_G4_A-B', opponent: 'A-B' };
    assert.strictEqual(post(ctx, { ...payload(2, other), setup: other }).success, false);
    assert.strictEqual(load(ctx, '2026-08-30_G4_A-B').success, false);
  });

  test('強制登入模式：沒登入不能備份、也不能讀備份', () => {
    const { ctx } = make({ TEAM_PASSCODE: 'abc', AUTH_ENFORCED: 'true' });
    assert.strictEqual(post(ctx, payload(1)).code, 'AUTH_REQUIRED');
    assert.strictEqual(load(ctx).code, 'AUTH_REQUIRED');
    const token = post(ctx, { action: 'login', passcode: 'abc' }).token;
    assert.strictEqual(post(ctx, { ...payload(1), token }).success, true);
  });

  test('只動這一場的分頁：不寫「調度紀錄」流水簿、不建立比賽分頁、不碰其他分頁', () => {
    const { ss, ctx } = make();
    ss.insertSheet('2026-08-30_G4_雨人').getRange(1, 1).setValue('陣容');
    post(ctx, payload(3));
    load(ctx);
    assert.deepStrictEqual(Object.keys(ss.sheets).sort(), ['2026-08-30_G4_雨人', SHEET].sort());
    assert.strictEqual(ss.getSheetByName('2026-08-30_G4_雨人').getRange(1, 1).getValues()[0][0], '陣容');
  });

  test('任何一格超過 5 萬字 → 拒絕並說明原因，不寫入', () => {
    const { ss, ctx } = make();
    const long = 'x'.repeat(50001);
    const p = payload(1);
    p.rows.push({ type: 'event', cells: ['備註', '', '', long], ev: { t: 'note', text: long } });
    const r = post(ctx, p);
    assert.strictEqual(r.success, false);
    assert.match(r.message, /5 萬字/);
    assert.ok(!ss.getSheetByName(SHEET));
  });
}

console.log('\nCode.gs finishGame 帶成績（實況賽事紀錄比賽完成：最終名單、成績、逐局比分寫進比賽分頁）');
{
  const files = ['gas/Code.gs', 'gas/Auth.gs', 'gas/Pitchers.gs', 'gas/Backup.gs'];
  const GC = require('../game-core');
  const g = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', '2026-08-30_G4_雨人.events.json'), 'utf8'));
  const gameInfo = { date: '2026-08-30', gameNum: 'G4', opponent: '雨人' };
  const SHEET = '2026-08-30_G4_雨人';
  const fin = GC.sheetFinal(g.setup, g.events);
  const make = () => { const ss = new MockSpreadsheet(); const c = createGasContext({ files, spreadsheet: ss }); return { ss, ...c }; };
  const post = (ctx, data) => out(ctx.doPost({ postData: { contents: JSON.stringify(data) } }));
  // 陣容調度先上傳先發，比賽分頁才存在
  const starters = (ctx) => post(ctx, { action: 'saveStarters', gameInfo, lineup: fin.activeLineup.map((x) => x.starter), pitchers: [fin.pitchers[0]] });
  const finish = (ctx, extra = {}) => post(ctx, { action: 'finishGame', gameInfo, requireSheet: true, ...fin, ...extra });
  const sheetOf = (ss) => ss.getSheetByName(SHEET);
  const values = (ss) => sheetOf(ss).getDataRange().getValues();
  const rowIdx = (ss, header, test) => { const v = values(ss); const h = v.findIndex((r) => r[0] === header); for (let i = h + 1; i < v.length; i++) if (test(v[i])) return i; return -1; };
  const batterRow = (ss, name, nth = 0) => { const v = values(ss); const h = v.findIndex((r) => r[0] === '打順'); return v.slice(h + 1).filter((r) => String(r[3]).replace(/^↳\s*/, '') === name)[nth]; };
  const pitcherRow = (ss, num) => values(ss)[rowIdx(ss, '順序', (r) => String(r[2]) === num)];

  test('帶成績：打者第一列寫 AB～SB 與成績上傳時間，換守位那一列維持「-」', () => {
    const { ss, ctx } = make();
    starters(ctx);
    const r = finish(ctx);
    assert.strictEqual(r.success, true, r.message);
    assert.deepStrictEqual(batterRow(ss, '蘇垣華').slice(5, 15), [3, 1, 1, 1, 0, 0, 2, 0, 0, 0]);
    assert.ok(batterRow(ss, '蘇垣華')[20], '成績上傳時間沒寫');
    assert.deepStrictEqual(batterRow(ss, '蘇垣華', 1).slice(5, 15), Array(10).fill('-'));
    assert.deepStrictEqual(batterRow(ss, '駱家鈞').slice(5, 15), [2, 1, 0, 0, 0, 0, 0, 1, 2, 1]);
  });

  test('手填的打者成績被工具的值覆蓋', () => {
    const { ss, ctx } = make();
    starters(ctx);
    const sh = sheetOf(ss);
    const v = values(ss);
    const r = v.findIndex((x) => x[3] === '蘇垣華') + 1;
    sh.getRange(r, 6).setValue(9);
    finish(ctx);
    assert.strictEqual(batterRow(ss, '蘇垣華')[5], 3);
  });

  test('投手表：IP～WP 寫入，ER 保留手填的值', () => {
    const { ss, ctx } = make();
    starters(ctx);
    finish(ctx);
    const r = rowIdx(ss, '順序', (x) => String(x[2]) === '56') + 1;
    sheetOf(ss).getRange(r, 9).setValue(4);
    finish(ctx);
    assert.deepStrictEqual(pitcherRow(ss, '1').slice(5, 14), ['2.0', 0, 1, '', 1, 1, 0, 1, 0]);
    assert.deepStrictEqual(pitcherRow(ss, '56').slice(5, 14), ['3.0', 6, 7, 4, 1, 7, 0, 0, 0]);
  });

  test('逐局比分：第 6、7 列寫雙方每局得分與 R、H、E；龍安的 R、H 維持接打者合計的公式', () => {
    const { ss, ctx } = make();
    starters(ctx);
    finish(ctx);
    const v = values(ss);
    assert.deepStrictEqual(v[5].slice(0, 6), ['龍安', 2, 5, 0, 0, 0]);
    assert.match(String(v[5][6]), /^=G\d+$/);
    assert.match(String(v[5][7]), /^=H\d+$/);
    assert.strictEqual(v[5][8], 2);
    assert.deepStrictEqual(v[6].slice(0, 9), ['雨人', 0, 0, 6, 0, 0, 6, 8, 2]);
  });

  test('沒打的半局寫空白', () => {
    const { ss, ctx } = make();
    starters(ctx);
    const ls = { us: [1, '', '', '', ''], opp: [0, '', '', '', ''], usRHE: [1, 1, 0], oppRHE: [0, 0, 0], overflow: false };
    finish(ctx, { linescore: ls });
    const v = values(ss);
    assert.deepStrictEqual(v[5].slice(1, 6), [1, '', '', '', '']);
    assert.deepStrictEqual(v[6].slice(1, 9), [0, '', '', '', '', 0, 0, 0]);
  });

  test('不帶成績（陣容調度的比賽結案）：行為不變，手填成績與逐局比分都保留', () => {
    const { ss, ctx } = make();
    starters(ctx);
    const sh = sheetOf(ss);
    const r = values(ss).findIndex((x) => x[3] === '蘇垣華') + 1;
    sh.getRange(r, 6).setValue(9);
    sh.getRange(7, 2).setValue(3);
    const res = post(ctx, { action: 'finishGame', gameInfo, activeLineup: fin.activeLineup, pitchers: fin.pitchers });
    assert.strictEqual(res.success, true);
    assert.strictEqual(batterRow(ss, '蘇垣華')[5], 9);
    assert.strictEqual(values(ss)[6][1], 3);
    assert.strictEqual(batterRow(ss, '蘇垣華')[20], '');
  });

  test('寫完用 getGameLineup 回讀：每一棒的名單和工具送出的一致（陣容調度能回讀）', () => {
    const { ctx } = make();
    starters(ctx);
    finish(ctx);
    const r = post(ctx, { action: 'getGameLineup', gameInfo });
    const brief = (p) => `${p.number}|${p.name}|${p.posLabel}`;
    assert.deepStrictEqual(r.data.activeLineup.map((x) => [x.starter, ...x.substitutes].map(brief)),
      fin.activeLineup.map((x) => [x.starter, ...x.substitutes].map(brief)));
    assert.deepStrictEqual(r.data.pitchers.map((p) => p.number), ['1', '56']);
  });

  test('成績資料格式不對：只寫名單、不動成績與逐局比分，回傳警告', () => {
    const { ss, ctx } = make();
    starters(ctx);
    const bad = [
      { stats: { batting: 'x', pitching: [] } },
      { stats: { ...fin.stats, batting: [{ ...fin.stats.batting[0], AB: '三' }] } },
      { stats: { ...fin.stats, pitching: [{ ...fin.stats.pitching[0], IP: '2.5' }] } },
      { linescore: { ...fin.linescore, us: [1, 2] } },
    ];
    bad.forEach((extra) => {
      const r = finish(ctx, extra);
      assert.strictEqual(r.success, true);
      assert.match(r.warning || '', /成績/);
    });
    assert.deepStrictEqual(batterRow(ss, '蘇垣華').slice(5, 15), Array(10).fill(''));
    assert.deepStrictEqual(batterRow(ss, '李浩偉').slice(0, 5), ['2', 'PR (代跑)', '21', '↳ 李浩偉', '替補']);
    assert.deepStrictEqual(values(ss)[6].slice(1, 6), ['', '', '', '', '']);
  });

  test('比賽分頁不存在（陣容調度沒上傳先發）：回傳提醒，不建立分頁', () => {
    const { ss, ctx } = make();
    const r = finish(ctx);
    assert.strictEqual(r.success, false);
    assert.match(r.message, /請先用陣容調度上傳先發/);
    assert.ok(!ss.getSheetByName(SHEET));
  });
}

console.log(`\n共 ${passed} 項通過` + (process.exitCode ? '（有失敗）' : ''));
