const assert = require('assert');
const { createGasContext } = require('./gas_mock');

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

console.log(`\n共 ${passed} 項通過` + (process.exitCode ? '（有失敗）' : ''));
