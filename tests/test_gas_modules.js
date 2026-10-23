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

  // listRecordBackups：賽事成績發布工具（電腦用）的比賽選單，只列真的有雲端備份的比賽
  const list = (ctx, extra = {}) => post(ctx, { action: 'listRecordBackups', ...extra });
  const other = (id, date, gameNum, opponent) => ({ ...g0830.setup, id, date, gameNum, opponent });
  const save = (ctx, setup, n) => post(ctx, { ...payload(n, setup), setup });

  test('listRecordBackups：沒有任何備份 → 空清單', () => {
    const { ctx } = make();
    const r = list(ctx);
    assert.strictEqual(r.success, true);
    assert.deepStrictEqual(r.games, []);
  });

  test('listRecordBackups：兩場備份 → 比賽 ID、日期、場次、對手、更新時間，日期新的在前', () => {
    const { ss, ctx } = make();
    save(ctx, g0830.setup, 69);
    save(ctx, other('2026-10-25_G1_ZERO', '2026-10-25', 'G1', 'ZERO'), 3);
    ss.getSheetByName(SHEET).getRange(6, 2).setValue('2026/08/30 18:00:00');
    ss.getSheetByName('賽事紀錄_2026-10-25_G1_ZERO').getRange(6, 2).setValue('2026/10/25 12:00:00');
    const r = list(ctx);
    assert.deepStrictEqual(r.games.map((x) => [x.gameId, x.date, x.gameNum, x.opponent, x.updatedAt]), [
      ['2026-10-25_G1_ZERO', '2026-10-25', 'G1', 'ZERO', '2026/10/25 12:00:00'],
      [GID, '2026-08-30', 'G4', '雨人', '2026/08/30 18:00:00'],
    ]);
  });

  test('listRecordBackups：同一天兩場 → G2 在 G1 前面（新的在前）', () => {
    const { ctx } = make();
    save(ctx, other('2026-10-25_G1_ZERO', '2026-10-25', 'G1', 'ZERO'), 3);
    save(ctx, other('2026-10-25_G2_ZERO', '2026-10-25', 'G2', 'ZERO'), 3);
    assert.deepStrictEqual(list(ctx).games.map((x) => x.gameNum), ['G2', 'G1']);
  });

  test('listRecordBackups：最後一筆是「比賽完成」→ finished true；記到一半 → false', () => {
    const { ctx } = make();
    save(ctx, g0830.setup, 69);                                       // 8/30 第 69 筆是 { t: 'end' }
    save(ctx, other('2026-10-25_G1_ZERO', '2026-10-25', 'G1', 'ZERO'), 20);
    const byId = Object.fromEntries(list(ctx).games.map((x) => [x.gameId, x.finished]));
    assert.deepStrictEqual(byId, { [GID]: true, '2026-10-25_G1_ZERO': false });
  });

  test('listRecordBackups：不是「賽事紀錄_」開頭的分頁（比賽分頁、名單、調度紀錄）不列', () => {
    const { ss, ctx } = make();
    const fake = ss.insertSheet('2026-08-30_G4_雨人');          // 就算長得像備份（B1、E1 都有值）也不列
    fake.getRange(1, 2).setValue(GID); fake.getRange(1, 5).setValue(JSON.stringify(g0830.setup));
    ss.insertSheet('調度紀錄');
    save(ctx, g0830.setup, 3);
    assert.deepStrictEqual(list(ctx).games.map((x) => x.gameId), [GID]);
  });

  test('listRecordBackups：分頁名稱的特殊字元被換成「-」時，回傳第 1 列記的真正比賽 ID（讀得回來）', () => {
    const { ctx } = make();
    const setup = other('2026-08-30_G4_A/B', '2026-08-30', 'G4', 'A/B');
    save(ctx, setup, 2);
    const g = list(ctx).games;
    assert.deepStrictEqual(g.map((x) => [x.gameId, x.opponent]), [['2026-08-30_G4_A/B', 'A/B']]);
    assert.strictEqual(load(ctx, g[0].gameId).success, true);
  });

  test('listRecordBackups：「賽事紀錄_」分頁第 1 列被改壞或空白 → 跳過這頁，其他照列', () => {
    const { ss, ctx } = make();
    save(ctx, g0830.setup, 3);
    ss.insertSheet('賽事紀錄_空白');
    save(ctx, other('2026-10-25_G1_ZERO', '2026-10-25', 'G1', 'ZERO'), 3);
    ss.getSheetByName('賽事紀錄_2026-10-25_G1_ZERO').getRange(1, 2).setValue('亂打');
    const r = list(ctx);
    assert.strictEqual(r.success, true);
    assert.deepStrictEqual(r.games.map((x) => x.gameId), [GID]);
  });

  test('listRecordBackups：強制登入模式沒登入 → AUTH_REQUIRED；登入後可以列', () => {
    const { ctx } = make({ TEAM_PASSCODE: 'abc', AUTH_ENFORCED: 'true' });
    assert.strictEqual(list(ctx).code, 'AUTH_REQUIRED');
    const token = post(ctx, { action: 'login', passcode: 'abc' }).token;
    assert.strictEqual(list(ctx, { token }).success, true);
  });

  test('listRecordBackups：不變條件——清單裡每一場都用 loadRecordBackup 讀得回來，而且只讀不寫', () => {
    const { ss, ctx } = make();
    save(ctx, g0830.setup, 69);
    save(ctx, other('2026-10-25_G1_ZERO', '2026-10-25', 'G1', 'ZERO'), 5);
    const before = JSON.stringify(ss.sheets);
    const games = list(ctx).games;
    assert.strictEqual(JSON.stringify(ss.sheets), before);
    assert.strictEqual(games.length, 2);
    games.forEach((x) => assert.strictEqual(load(ctx, x.gameId).success, true, x.gameId));
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

  test('投手表：IP～WP 寫入；ER 寫工具的建議值（8/30 兩位都是 0），人改過的 ER 保留（V01.13.00 起）', () => {
    const { ss, ctx } = make();
    starters(ctx);
    finish(ctx);
    const r = rowIdx(ss, '順序', (x) => String(x[2]) === '56') + 1;
    sheetOf(ss).getRange(r, 9).setValue(4);
    finish(ctx);
    assert.deepStrictEqual(pitcherRow(ss, '1').slice(5, 14), ['2.0', 0, 1, 0, 1, 1, 0, 1, 0]);
    assert.deepStrictEqual(pitcherRow(ss, '56').slice(5, 14), ['3.0', 6, 7, 4, 1, 7, 0, 0, 0]);
  });

  // ---- 自責分建議值（ER-3、ER-4）：註解記工具的建議值，判斷不準的塗黃 ----
  const erRow = (ss, num) => rowIdx(ss, '順序', (x) => String(x[2]) === num) + 1;
  const erCell = (ss, num) => {
    const r = erRow(ss, num);
    const rng = sheetOf(ss).getRange(r, 9);
    return { v: rng.getValues()[0][0], note: rng.getNotes()[0][0], bg: rng.getBackgrounds()[0][0] };
  };
  const YELLOW = '#fff2cc';
  const withER = (er1, er56, flags56 = []) => ({ stats: { batting: fin.stats.batting,
    pitching: fin.stats.pitching.map((p) => ({ ...p, ER: p.number === '1' ? er1 : er56, erFlags: p.number === '1' ? [] : flags56 })) } });

  test('ER 格空白 → 寫入建議值，註解「工具建議 X」；有判斷不準的分 → 塗黃，註解列出原因', () => {
    const { ss, ctx } = make();
    starters(ctx);
    finish(ctx);
    const a = erCell(ss, '1');
    const b = erCell(ss, '56');
    assert.deepStrictEqual([a.v, a.note, a.bg], [0, '工具建議 0', '#ffffff']);
    assert.strictEqual(b.v, 0);
    assert.match(b.note, /^工具建議 0\n三局下：重建半局/);
    assert.strictEqual(b.bg, YELLOW);
  });

  test('ER 格還是上次的建議值 → 換成新的建議值（紀錄修正後重新寫入）', () => {
    const { ss, ctx } = make();
    starters(ctx);
    finish(ctx, withER(2, 3));
    finish(ctx, withER(1, 0));
    assert.deepStrictEqual([erCell(ss, '1').v, erCell(ss, '1').note, erCell(ss, '56').v], [1, '工具建議 1', 0]);
  });

  test('ER 格被人改過 → 保留人填的，註解「工具建議 X，已保留你填的 Y」，底色不動', () => {
    const { ss, ctx } = make();
    starters(ctx);
    finish(ctx);                                             // #56 塗黃
    sheetOf(ss).getRange(erRow(ss, '56'), 9).setValue(2);
    sheetOf(ss).getRange(erRow(ss, '1'), 9).setValue(1).setBackground('#ffffff');
    finish(ctx);
    const b = erCell(ss, '56');
    assert.deepStrictEqual([b.v, b.bg], [2, YELLOW]);           // 還沒清黃色：照舊黃
    assert.match(b.note, /^工具建議 0，已保留你填的 2/);
    assert.deepStrictEqual([erCell(ss, '1').v, erCell(ss, '1').note], [1, '工具建議 0，已保留你填的 1']);
    // 人確認後自己清掉黃色：重新寫入不會再塗回去
    sheetOf(ss).getRange(erRow(ss, '56'), 9).setBackground('#ffffff');
    finish(ctx);
    assert.strictEqual(erCell(ss, '56').bg, '#ffffff');
  });

  test('舊資料：ER 有手填值、沒有註解 → 保留', () => {
    const { ss, ctx } = make();
    starters(ctx);
    finish(ctx, withER(undefined, undefined));               // 舊版手機：沒帶 ER
    assert.deepStrictEqual([erCell(ss, '1').v, erCell(ss, '1').note], ['', '']);
    sheetOf(ss).getRange(erRow(ss, '1'), 9).setValue(3);
    finish(ctx);
    assert.deepStrictEqual([erCell(ss, '1').v, erCell(ss, '1').note], [3, '工具建議 0，已保留你填的 3']);
  });

  test('工具寫的格子：這次沒有判斷不準的分 → 清掉上次塗的黃色', () => {
    const { ss, ctx } = make();
    starters(ctx);
    finish(ctx);
    assert.strictEqual(erCell(ss, '56').bg, YELLOW);
    finish(ctx, withER(0, 0, []));
    assert.deepStrictEqual([erCell(ss, '56').bg, erCell(ss, '56').note], ['#ffffff', '工具建議 0']);
  });

  test('getGameER：回傳每位投手的 ER、空白當作還沒填（null）、黃色當作待確認', () => {
    const { ss, ctx } = make();
    starters(ctx);
    finish(ctx);
    sheetOf(ss).getRange(erRow(ss, '1'), 9).setValue('');
    const r = post(ctx, { action: 'getGameER', gameInfo });
    assert.strictEqual(r.success, true);
    assert.deepStrictEqual(r.pitchers.map((p) => [p.number, p.name, p.ER, p.pending]), [['1', '張容基', null, false], ['56', '蘇垣華', 0, true]]);
  });

  test('getGameER：比賽分頁不存在 → 回錯誤；強制登入時沒登入 → AUTH_REQUIRED', () => {
    const { ctx } = make();
    const r = post(ctx, { action: 'getGameER', gameInfo });
    assert.strictEqual(r.success, false);
    assert.match(r.message, /找不到/);
    const ss2 = new MockSpreadsheet();
    const c2 = createGasContext({ files, spreadsheet: ss2, props: { TEAM_PASSCODE: 'abc', AUTH_ENFORCED: 'true' } });
    assert.strictEqual(post(c2.ctx, { action: 'getGameER', gameInfo }).code, 'AUTH_REQUIRED');
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

console.log('\nCode.gs 板凳名單（V01.13.01：投手表下方空一列，「板凳（有到沒上場）」）');
{
  const files = ['gas/Code.gs', 'gas/Auth.gs', 'gas/Pitchers.gs', 'gas/Backup.gs'];
  const GC = require('../game-core');
  const g = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', '2026-08-30_G4_雨人.events.json'), 'utf8'));
  const gameInfo = { date: '2026-08-30', gameNum: 'G4', opponent: '雨人' };
  const SHEET = '2026-08-30_G4_雨人';
  const fin = GC.sheetFinal(g.setup, g.events);
  const make = () => { const ss = new MockSpreadsheet(); const c = createGasContext({ files, spreadsheet: ss }); return { ss, ...c }; };
  const post = (ctx, data) => out(ctx.doPost({ postData: { contents: JSON.stringify(data) } }));
  const B = (n, name) => ({ number: n, name });
  const starters = (ctx, bench) => post(ctx, { action: 'saveStarters', gameInfo, lineup: fin.activeLineup.map((x) => x.starter), pitchers: [fin.pitchers[0]], ...(bench ? { bench } : {}) });
  const rows = (ss) => ss.getSheetByName(SHEET).getDataRange().getValues();
  // 投手表合計列之後：[空白列, 表頭, 板凳…]
  const afterPitchers = (ss) => {
    const v = rows(ss);
    const h = v.findIndex((r) => r[0] === '順序');
    const t = v.findIndex((r, i) => i > h && r[3] === '成績合計');
    return v.slice(t + 1).map((r) => r.slice(0, 3));
  };

  test('上傳先發帶板凳：投手表合計列下面空一列，表頭「板凳（有到沒上場）｜背號｜球員姓名」，一人一列', () => {
    const { ss, ctx } = make();
    assert.strictEqual(starters(ctx, [B('21', '李浩偉'), B('55', '葉展昆')]).success, true);
    assert.deepStrictEqual(afterPitchers(ss), [['', '', ''], ['板凳（有到沒上場）', '背號', '球員姓名'], [1, '21', '李浩偉'], [2, '55', '葉展昆']]);
  });

  test('再上傳一次：板凳變少整份重寫，不留舊列；變多照樣寫得下', () => {
    const { ss, ctx } = make();
    starters(ctx, [B('21', '李浩偉'), B('55', '葉展昆'), B('36', '李尊堯')]);
    starters(ctx, [B('49', '蘇辰雄')]);
    assert.deepStrictEqual(afterPitchers(ss).slice(1), [['板凳（有到沒上場）', '背號', '球員姓名'], [1, '49', '蘇辰雄']]);
    starters(ctx, [B('21', '李浩偉'), B('55', '葉展昆')]);
    assert.deepStrictEqual(afterPitchers(ss).slice(2), [[1, '21', '李浩偉'], [2, '55', '葉展昆']]);
  });

  test('比賽完成改成最終版；投手從 1 位變 2 位、投手表變長，板凳表跟著往下移、不會被蓋掉', () => {
    const { ss, ctx } = make();
    starters(ctx, [B('21', '李浩偉'), B('55', '葉展昆')]);
    const r = post(ctx, { action: 'finishGame', gameInfo, requireSheet: true, ...fin, bench: [B('55', '葉展昆')] });
    assert.strictEqual(r.success, true, r.message);
    const v = rows(ss);
    const h = v.findIndex((x) => x[0] === '順序');
    assert.deepStrictEqual(v.slice(h + 1, h + 3).map((x) => x[3]), ['張容基', '蘇垣華']);
    assert.deepStrictEqual(afterPitchers(ss), [['', '', ''], ['板凳（有到沒上場）', '背號', '球員姓名'], [1, '55', '葉展昆']]);
  });

  test('舊版前端沒帶板凳 → 板凳表不動；板凳是空的 → 只有表頭', () => {
    const { ss, ctx } = make();
    starters(ctx, [B('21', '李浩偉')]);
    post(ctx, { action: 'finishGame', gameInfo, requireSheet: true, ...fin, bench: undefined });
    assert.deepStrictEqual(afterPitchers(ss).slice(2), [[1, '21', '李浩偉']]);
    starters(ctx, []);
    assert.deepStrictEqual(afterPitchers(ss).slice(1), [['板凳（有到沒上場）', '背號', '球員姓名']]);
  });

  test('回讀先發（getGameLineup）一起回傳板凳；舊比賽分頁沒有板凳表 → 空陣列', () => {
    const { ctx } = make();
    starters(ctx, [B('21', '李浩偉'), B('55', '葉展昆')]);
    assert.deepStrictEqual(post(ctx, { action: 'getGameLineup', gameInfo }).data.bench, [B('21', '李浩偉'), B('55', '葉展昆')]);
    const c2 = make();
    starters(c2.ctx);
    assert.deepStrictEqual(post(c2.ctx, { action: 'getGameLineup', gameInfo }).data.bench, []);
  });
}

console.log('\nCode.gs 投手表公式（IP 的 2.1＝2 又 1/3 局；ERA、K9、BB9、WHIP 與合計 IP）');
{
  const files = ['gas/Code.gs', 'gas/Auth.gs', 'gas/Pitchers.gs', 'gas/Backup.gs'];
  const GC = require('../game-core');
  const g = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', '2026-08-30_G4_雨人.events.json'), 'utf8'));
  const gameInfo = { date: '2026-08-30', gameNum: 'G4', opponent: '雨人' };
  const SHEET = '2026-08-30_G4_雨人';
  const fin = GC.sheetFinal(g.setup, g.events);
  const P = (number, name) => ({ number, name, pos: 'P', posLabel: 'P (1)' });
  const ST = (number, name, IP, R, H, BB, SO) => ({ number, name, IP, R, H, BB, SO, HR: 0, HBP: 0, WP: 0 });
  const make = () => { const ss = new MockSpreadsheet(); const c = createGasContext({ files, spreadsheet: ss }); return { ss, ...c }; };
  const post = (ctx, data) => out(ctx.doPost({ postData: { contents: JSON.stringify(data) } }));
  // 寫入：陣容調度先上傳先發，實況賽事紀錄比賽完成帶投手成績
  const write = (ctx, pitchers, pitching) => {
    post(ctx, { action: 'saveStarters', gameInfo, lineup: fin.activeLineup.map((x) => x.starter), pitchers: [fin.pitchers[0]] });
    return post(ctx, { action: 'finishGame', gameInfo, requireSheet: true, ...fin, pitchers, stats: { batting: fin.stats.batting, pitching } });
  };
  // 測試用：把試算表公式代入儲存格的值算出結果（只支援投手表用到的 IF、INT、MOD、ROUND、TEXT、SUM）
  const colNum = (letters) => letters.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
  function cellValue(sh, r, c, depth = 0) {
    const v = ((sh.rows[r - 1] || [])[c - 1]);
    if (typeof v === 'string' && v.startsWith('=')) return evalFormula(sh, v, depth + 1);
    if (v === '' || v === undefined || v === null) return 0;
    const n = Number(v);
    return Number.isNaN(n) ? v : n;
  }
  function evalFormula(sh, f, depth) {
    if (depth > 20) throw new Error('公式循環');
    const js = f.slice(1)
      .replace(/([A-Z]+)(\d+):([A-Z]+)(\d+)/g, (m, c1, r1, c2, r2) => `RANGE(${colNum(c1)},${r1},${colNum(c2)},${r2})`)
      .replace(/\b([A-Z]{1,2})(\d+)\b/g, (m, c, r) => `CELL(${colNum(c)},${r})`);
    const fns = {
      CELL: (c, r) => cellValue(sh, r, c, depth),
      RANGE: (c1, r1, c2, r2) => { const a = []; for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) a.push(cellValue(sh, r, c, depth)); return a; },
      IF: (cond, a, b) => (cond ? a : b), INT: Math.floor, MOD: (a, b) => a - b * Math.floor(a / b),
      ROUND: (x, n = 0) => Math.round(x * 10 ** n) / 10 ** n,
      TEXT: (x, fmt) => (fmt === '0.00' ? Number(x).toFixed(2) : fmt === '.000' ? Number(x).toFixed(3).replace(/^0/, '') : String(x)),
      SUM: (arr) => arr.reduce((a, x) => a + (typeof x === 'number' ? x : 0), 0),
    };
    return new Function(...Object.keys(fns), `return (${js});`)(...Object.values(fns));
  }
  const pitcherRows = (ss) => {
    const sh = ss.getSheetByName(SHEET);
    const h = sh.rows.findIndex((r) => r && r[0] === '順序') + 1;
    const out2 = {};
    for (let r = h + 1; r <= sh.rows.length; r++) {
      const row = sh.rows[r - 1] || [];
      const key = row[3] === '成績合計' ? '合計' : String(row[2]);
      if (!row[3]) break;
      out2[key] = { r, IP: cellValue(sh, r, 6), ER: cellValue(sh, r, 9), rates: [16, 17, 18, 19].map((c) => cellValue(sh, r, c)), cells: row };
      if (key === '合計') break;
    }
    return out2;
  };
  const setER = (ss, rows, num, er) => ss.getSheetByName(SHEET).getRange(rows[num].r, 9).setValue(er);

  const THREE = [P('1', '張容基'), P('55', '葉展昆'), P('56', '蘇垣華')];
  const THREE_ST = [ST('1', '張容基', '2.1', 1, 2, 1, 3), ST('55', '葉展昆', '0.2', 2, 1, 0, 1), ST('56', '蘇垣華', '2.0', 0, 1, 1, 2)];

  test('一位投手 IP 2.1（7/3 局）、ER 1、SO 3、BB 1、H 2：ERA 3.86、K9 11.57、BB9 3.86、WHIP 1.29', () => {
    const { ss, ctx } = make();
    assert.strictEqual(write(ctx, THREE, THREE_ST).success, true);
    setER(ss, pitcherRows(ss), '1', 1);
    assert.deepStrictEqual(pitcherRows(ss)['1'].rates, ['3.86', '11.57', '3.86', '1.29']);
  });

  test('合計 IP：2.1＋0.2＋2.0 → 5.0（15 個出局）；0.2＋0.2 → 1.1（4 個出局）', () => {
    const a = make();
    write(a.ctx, THREE, THREE_ST);
    assert.strictEqual(Number(pitcherRows(a.ss)['合計'].IP).toFixed(1), '5.0');
    const b = make();
    write(b.ctx, [P('1', '張容基'), P('56', '蘇垣華')], [ST('1', '張容基', '0.2', 0, 0, 0, 0), ST('56', '蘇垣華', '0.2', 0, 0, 0, 0)]);
    assert.strictEqual(Number(pitcherRows(b.ss)['合計'].IP).toFixed(1), '1.1');
  });

  test('合計 ERA：ER 合計 3、5 局 → 5.40；K9 合計 SO 6 → 10.80', () => {
    const { ss, ctx } = make();
    write(ctx, THREE, THREE_ST);
    const rows = pitcherRows(ss);
    setER(ss, rows, '1', 1); setER(ss, rows, '55', 2); setER(ss, rows, '56', 0);
    assert.deepStrictEqual(pitcherRows(ss)['合計'].rates.slice(0, 2), ['5.40', '10.80']);
  });

  test('IP 0（沒拿到出局數就被換下）：四項比率都是 0.00，不會除以零', () => {
    const { ss, ctx } = make();
    write(ctx, THREE, [THREE_ST[0], ST('55', '葉展昆', '0.0', 2, 2, 1, 0), THREE_ST[2]]);
    assert.deepStrictEqual(pitcherRows(ss)['55'].rates, ['0.00', '0.00', '0.00', '0.00']);
  });

  test('手填的 ER 在重寫投手表後保留，ERA 照樣引用 ER 欄重算', () => {
    const { ss, ctx } = make();
    write(ctx, THREE, THREE_ST);
    setER(ss, pitcherRows(ss), '56', 2);
    post(ctx, { action: 'finishGame', gameInfo, requireSheet: true, ...fin, pitchers: THREE, stats: { batting: fin.stats.batting, pitching: THREE_ST } });
    const r = pitcherRows(ss)['56'];
    assert.deepStrictEqual([r.ER, r.rates[0]], [2, '9.00']);
  });

  test('工具寫入的 ER 建議值：ERA 照樣引用 ER 欄（IP 2.1、ER 1 → 3.86）', () => {
    const { ss, ctx } = make();
    write(ctx, THREE, THREE_ST.map((p) => ({ ...p, ER: p.number === '1' ? 1 : 0, erFlags: [] })));
    const r = pitcherRows(ss)['1'];
    assert.deepStrictEqual([r.ER, r.rates[0]], [1, '3.86']);
  });

  test('合計列的 R、H、ER、BB、SO、HR、HBP、WP 照舊直接加總', () => {
    const { ss, ctx } = make();
    write(ctx, THREE, THREE_ST);
    const rows = pitcherRows(ss);
    setER(ss, rows, '1', 1); setER(ss, rows, '55', 2);
    const sh = ss.getSheetByName(SHEET);
    const t = pitcherRows(ss)['合計'].r;
    assert.deepStrictEqual([7, 8, 9, 10, 11, 12, 13, 14].map((c) => cellValue(sh, t, c)), [3, 4, 3, 2, 6, 0, 0, 0]);
  });
}

console.log(`\n共 ${passed} 項通過` + (process.exitCode ? '（有失敗）' : ''));
