// lineup.html 調度邏輯測試
// 框架抽到 tests/harness.js，與 tests/test_scenarios.js 共用。
const assert = require('assert');
const {
  makeBackend, gameSheet, pitcherRows, batterNames,
  ROSTER, boot, byName, setStarters, sub, dhPitcherChange,
  pitcherNames, lastUpload, NINE, DH9, tick,
} = require('./harness');

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ============ 情境 A：一般 9 人 ============
test('A1 一般9人：先發上傳，投手表帶入先發投手', async () => {
  const { app, backend } = boot();
  setStarters(app, NINE);
  assert.deepStrictEqual([app.positionConflicts.value.length, app.missingPositions.value.length], [0, 0]);
  await app.uploadStartersToGAS(); await tick();
  assert.strictEqual(app.currentStep.value, 3);
  assert.strictEqual(lastUpload(backend).pitchers.map(p => p.name).join(), '陳一');
  assert.strictEqual(app.isDHCancelled.value, false);
});

test('A2 一般9人：代打 → 換投 → 守位調整，投手順序與守備檢查正確', async () => {
  const { app, backend } = boot();
  setStarters(app, NINE);
  await app.uploadStartersToGAS(); await tick();
  sub(app, 9, '謝替', 'PH');                // 9棒代打
  assert.ok(app.activeDefenseNotice.value.missing.join().includes('LF'));
  sub(app, 9, 'SAME', 'LF');                // 代打者留下守左外野
  sub(app, 6, '許投', 'P');                 // 6棒換投
  assert.strictEqual(app.activeDefenseNotice.value.isComplete, true);
  assert.strictEqual(pitcherNames(app), '陳一,許投');
  await app.uploadSubstitutionsToGAS(); await tick();
  assert.strictEqual(lastUpload(backend).pitchers.map(p => p.name).join(), '陳一,許投');
  assert.ok(app.currentLeagueReportText.value === '');
});

test('A3 一般9人：DH 守位選項不可用、不會誤判 DH 取消', async () => {
  const { app } = boot();
  setStarters(app, NINE);
  await app.uploadStartersToGAS(); await tick();
  assert.strictEqual(app.hasDHInLineup.value, false);
  sub(app, 1, '謝替', 'PH');
  assert.strictEqual(app.isDHCancelled.value, false);
  assert.strictEqual(app.subCandidates.value.some(c => c.isCurrentDHPitcher), false);
});

// ============ 情境 B：全場 DH ============
test('B1 全場DH：未指定先發投手時不能上傳', async () => {
  const { app, backend } = boot();
  setStarters(app, DH9);
  assert.strictEqual(app.missingPositions.value.length, 1); // 缺 P
  await app.uploadStartersToGAS();
  assert.strictEqual(backend.calls.length, 0);
});

test('B2 全場DH：先發投手不在打序，上傳 pitchers 正確', async () => {
  const { app, backend } = boot();
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  assert.strictEqual(app.missingPositions.value.length, 0);
  await app.uploadStartersToGAS(); await tick();
  assert.strictEqual(lastUpload(backend).pitchers.map(p => p.name).join(), '陳一');
  assert.strictEqual(app.activeDefenseNotice.value.isComplete, true);
  assert.ok(!app.benchPlayers.value.some(p => p['球員姓名'] === '陳一'));
});

test('B3 全場DH：兩次換投（DH制按鈕）→ 投手表 3 人，DH 維持', async () => {
  const { app, backend } = boot();
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  dhPitcherChange(app, '許投');
  await app.uploadSubstitutionsToGAS(); await tick();
  dhPitcherChange(app, '鄭投');
  await app.uploadSubstitutionsToGAS(); await tick();
  assert.strictEqual(pitcherNames(app), '陳一,許投,鄭投');
  assert.strictEqual(lastUpload(backend).pitchers.map(p => p.name).join(), '陳一,許投,鄭投');
  assert.strictEqual(app.isDHCancelled.value, false);
  assert.strictEqual(app.activeDefenseNotice.value.isComplete, true);
});

test('B4 【修正】DH 被代打後不算取消 DH，代打者可接著改任 DH', async () => {
  const { app } = boot();
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  const w1 = sub(app, 6, '謝替', 'PH');
  assert.strictEqual(w1, false);
  assert.strictEqual(app.isDHCancelled.value, false, '代打 DH 不應取消 DH');
  sub(app, 6, 'SAME', 'DH');
  assert.strictEqual(app.isDHCancelled.value, false);
  assert.strictEqual(app.activeDefenseNotice.value.isComplete, true);
});

test('B5 【修正】DH 制換投後重新整理，草稿能還原後援投手', async () => {
  const first = boot();
  setStarters(first.app, DH9);
  first.app.independentPitcherId.value = byName(first.app, '陳一');
  await first.app.uploadStartersToGAS(); await tick();
  dhPitcherChange(first.app, '許投');
  first.saveDraft();
  const second = boot({ draft: JSON.parse(first.storage.longan_lineup_draft) });
  assert.strictEqual(second.app.currentStep.value, 3);
  assert.strictEqual(pitcherNames(second.app), '陳一,許投');
  assert.strictEqual(second.app.currentBatchPending.value.length, 1);
  assert.ok(!second.app.benchPlayers.value.some(p => p['球員姓名'] === '許投'));
});

// ============ 情境 C：先發 DH，中途取消 ============
test('C1 【修正】目前投手可從更換視窗進入打序（取代 DH），系統提示並判定 DH 取消', async () => {
  const { app, backend } = boot();
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  const cand = app.subCandidates.value.find(c => c.isCurrentDHPitcher);
  assert.ok(cand && cand['球員姓名'] === '陳一', '候選名單應包含目前投手');
  const warned = sub(app, 6, '陳一', 'P');
  assert.strictEqual(warned, true, '應提示將取消 DH');
  assert.strictEqual(app.isDHCancelled.value, true);
  assert.strictEqual(pitcherNames(app), '陳一', '同一位投手不應重複');
  assert.strictEqual(app.activeDefenseNotice.value.isComplete, true);
  assert.strictEqual(app.subCandidates.value.some(c => c.isCurrentDHPitcher), false);
  await app.uploadSubstitutionsToGAS(); await tick();
  assert.strictEqual(lastUpload(backend).pitchers.map(p => p.name).join(), '陳一');
});

test('C2 DH 轉守備（DH 去守 1B、原 1B 下場由投手打）→ 取消 DH，守備完整', async () => {
  const { app } = boot();
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  const warned = sub(app, 6, 'SAME', '1B');   // 楊十 DH → 1B
  assert.strictEqual(warned, true);
  sub(app, 7, '陳一', 'P');                   // 原 1B 吳七 那棒改由投手陳一打
  assert.strictEqual(app.isDHCancelled.value, true);
  assert.strictEqual(app.activeDefenseNotice.value.isComplete, true);
  assert.strictEqual(pitcherNames(app), '陳一');
});

test('C3 取消 DH 後再換投：走一般換投（打序裡守 P），投手表正確', async () => {
  const { app, backend } = boot();
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  dhPitcherChange(app, '許投');               // 先用 DH 制換一次投
  await app.uploadSubstitutionsToGAS(); await tick();
  sub(app, 6, '許投', 'P');                   // 許投 進入打序 → 取消 DH
  assert.strictEqual(app.isDHCancelled.value, true);
  sub(app, 6, '鄭投', 'P');                   // 之後再換投
  assert.strictEqual(pitcherNames(app), '陳一,許投,鄭投');
  assert.strictEqual(app.activeDefenseNotice.value.isComplete, true);
  await app.uploadSubstitutionsToGAS(); await tick();
  assert.strictEqual(lastUpload(backend).pitchers.map(p => p.name).join(), '陳一,許投,鄭投');
});

// ============ 其他修正 ============
test('D1 【修正】解鎖只抽回最新一批，不會連前面批次一起解鎖', async () => {
  const { app } = boot();
  setStarters(app, NINE);
  await app.uploadStartersToGAS(); await tick();
  sub(app, 1, '謝替', 'PH');
  await app.uploadSubstitutionsToGAS(); await tick();
  sub(app, 2, '郭替', 'PR');
  await app.uploadSubstitutionsToGAS(); await tick();
  app.unlockLastBatch();
  assert.strictEqual(app.currentBatchPending.value.length, 1);
  assert.strictEqual(app.currentBatchPending.value[0].name, '郭替');
  assert.strictEqual(app.activeLineup.value[0].substitutes[0].isUploaded, true, '第一批仍鎖住');
  assert.strictEqual(app.activeLineup.value[1].substitutes[0].isUploaded, false);
  assert.strictEqual(app.uploadedBatches.value.length, 1);
});

test('D2 【修正】DH 制刪除尚未上傳的換投，只刪那一筆', async () => {
  const { app } = boot();
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  dhPitcherChange(app, '許投');
  const t = app.activePitchers.value[1].timestamp;
  await new Promise(r => setTimeout(r, 3));
  dhPitcherChange(app, '鄭投');
  app.removeIndependentPitcher(app.activePitchers.value[2].timestamp);
  assert.strictEqual(pitcherNames(app), '陳一,許投');
  assert.strictEqual(app.currentBatchPending.value.length, 1);
  assert.strictEqual(app.currentBatchPending.value[0].timestamp, t);
});

test('D3 【修正】後端回傳失敗時，畫面不會顯示成功、不會跳到步驟三', async () => {
  const { app, backend, alerts } = boot();
  backend.handle = () => ({ success: false, message: '試算表寫入錯誤' });
  setStarters(app, NINE);
  await app.uploadStartersToGAS(); await tick();
  assert.notStrictEqual(app.currentStep.value, 3);
  assert.ok(alerts.some(a => a.includes('試算表寫入錯誤')));
  assert.strictEqual(app.saving.value, false);
});

test('D4 雲端回讀（全場DH 含換投）：還原先發表、DH 狀態、投手名單', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = '猛虎';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  dhPitcherChange(app, '許投');
  sub(app, 1, '謝替', 'PH');
  await app.uploadSubstitutionsToGAS(); await tick();

  // 換一支手機：全新狀態，只有名單
  const other = boot();
  other.backend.handle = backend.handle;
  other.app.gameInfo.value = { ...app.gameInfo.value };
  other.app.players.value.forEach(p => { p.isAttended = false; });
  await other.app.loadFromGAS(); await tick();
  const o = other.app;
  assert.strictEqual(o.currentStep.value, 3);
  assert.strictEqual(o.hasDHInLineup.value, true);
  assert.strictEqual(pitcherNames(o), '陳一,許投');
  assert.strictEqual(o.activeLineup.value[0].substitutes[0].name, '謝替');
  assert.strictEqual(o.activeLineup.value[0].substitutes[0].isUploaded, true);
  assert.strictEqual(o.activeDefenseNotice.value.missing.join(), 'CF (8)');
  assert.ok(!o.benchPlayers.value.some(p => ['陳一', '許投', '謝替', '林二'].includes(p['球員姓名'])));
});

// ============ 隊務登入 ============
test('E1 測試模式（未強制）：不需登入即可上傳', async () => {
  const { app, backend } = boot({ props: { TEAM_PASSCODE: 'longan' } });
  setStarters(app, NINE);
  await app.uploadStartersToGAS(); await tick();
  assert.strictEqual(app.currentStep.value, 3);
  assert.strictEqual(backend.calls.length, 1);
});

test('E2 強制模式：跳出登入 → 輸入正確密碼 → 自動重送成功，token 保存', async () => {
  const { app, backend, storage } = boot({ props: { TEAM_PASSCODE: 'longan', AUTH_ENFORCED: 'true' }, loginPasscode: 'longan' });
  setStarters(app, NINE);
  await app.uploadStartersToGAS(); await tick(); await tick();
  assert.strictEqual(app.currentStep.value, 3);
  assert.strictEqual(backend.calls.length, 1);
  assert.ok(storage.longan_auth_token);
  assert.strictEqual(app.isLoggedIn.value, true);
  // 之後的上傳不再需要登入
  sub(app, 1, '謝替', 'PH');
  await app.uploadSubstitutionsToGAS(); await tick();
  assert.strictEqual(backend.calls.length, 2);
});

test('E3 強制模式：密碼錯誤後取消 → 不寫入、顯示未登入訊息', async () => {
  const { app, backend, alerts } = boot({ props: { TEAM_PASSCODE: 'longan', AUTH_ENFORCED: 'true' }, loginPasscode: 'wrong' });
  setStarters(app, NINE);
  await app.uploadStartersToGAS(); await tick(); await tick();
  assert.strictEqual(backend.calls.length, 0);
  assert.notStrictEqual(app.currentStep.value, 3);
  assert.ok(alerts.some(a => a.includes('尚未完成隊務登入')));
  assert.strictEqual(app.isLoggedIn.value, false);
});

test('E4 強制模式：回讀雲端紀錄也需要登入', async () => {
  const { app, backend } = boot({ props: { TEAM_PASSCODE: 'longan', AUTH_ENFORCED: 'true' }, loginPasscode: 'wrong' });
  app.gameInfo.value.opponent = '猛虎';
  await app.loadFromGAS(); await tick();
  assert.strictEqual(backend.calls.length, 0);
});

test('E5 token 過期時前端視為未登入；登出會清掉 token', async () => {
  const { app, storage } = boot({ props: { TEAM_PASSCODE: 'longan', AUTH_ENFORCED: 'true' }, loginPasscode: 'longan' });
  setStarters(app, NINE);
  await app.uploadStartersToGAS(); await tick(); await tick();
  assert.strictEqual(app.isLoggedIn.value, true);
  app.logout();
  assert.strictEqual(app.isLoggedIn.value, false);
  assert.ok(!storage.longan_auth_token);
  const expired = Buffer.from(JSON.stringify({ exp: Date.now() - 1000 })).toString('base64').replace(/=+$/, '') + '.sig';
  const again = boot({ token: expired });
  assert.strictEqual(again.app.isLoggedIn.value, false);
  const valid = Buffer.from(JSON.stringify({ exp: Date.now() + 60000 })).toString('base64').replace(/=+$/, '') + '.sig';
  assert.strictEqual(boot({ token: valid }).app.isLoggedIn.value, true);
});

// ============ 試算表端到端（實際跑 Code.gs）============
test('F1 一般9人：試算表投手表＝先發＋後援，打者表含替補列', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = '猛虎';
  setStarters(app, NINE);
  await app.uploadStartersToGAS(); await tick();
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一');
  sub(app, 6, '許投', 'P');
  await app.uploadSubstitutionsToGAS(); await tick();
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一,後援投手:許投');
  assert.ok(batterNames(backend).includes('6P↳ 許投'));
  assert.strictEqual(batterNames(backend).length, 10);
});

test('F2 【本次主修】全場DH：試算表投手表抓得到不在打序裡的投手（含兩次換投）', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = '猛虎';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一');
  dhPitcherChange(app, '許投');
  await app.uploadSubstitutionsToGAS(); await tick();
  dhPitcherChange(app, '鄭投');
  await app.uploadSubstitutionsToGAS(); await tick();
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一,後援投手:許投,後援投手:鄭投');
  assert.strictEqual(batterNames(backend).length, 9);
});

test('F3 【本次主修】先發DH中途取消：投手表不重複，打者表出現投手列', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = '猛虎';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  dhPitcherChange(app, '許投');
  await app.uploadSubstitutionsToGAS(); await tick();
  sub(app, 6, '許投', 'P');
  sub(app, 6, '鄭投', 'P');
  await app.uploadSubstitutionsToGAS(); await tick();
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一,後援投手:許投,後援投手:鄭投');
  assert.ok(batterNames(backend).includes('6P↳ 許投'));
  assert.ok(batterNames(backend).includes('6P↳ 鄭投'));
});

test('F4 手動填的投手成績，在之後換投重寫時保留', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = '猛虎';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  const sh = gameSheet(backend);
  const h = sh.rows.findIndex(r => r && r[0] === '順序');
  sh.set(h + 2, 6, 3); // 陳一 IP=3
  sh.set(h + 2, 11, 4); // SO=4
  dhPitcherChange(app, '許投');
  await app.uploadSubstitutionsToGAS(); await tick();
  const row = sh.rows[h + 1];
  assert.deepStrictEqual([row[3], row[5], row[10]], ['陳一', 3, 4]);
});

test('F5 回讀（另一支手機）：DH 比賽的先發投手、後援投手、DH 取消狀態都還原', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = '猛虎';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  dhPitcherChange(app, '許投');
  await app.uploadSubstitutionsToGAS(); await tick();
  sub(app, 1, '謝替', 'PH');
  await app.uploadSubstitutionsToGAS(); await tick();

  const other = boot();
  other.backend.handle = backend.handle;
  other.app.gameInfo.value = { ...app.gameInfo.value };
  other.app.players.value.forEach(p => { p.isAttended = false; });
  await other.app.loadFromGAS(); await tick();
  const o = other.app;
  assert.strictEqual(o.currentStep.value, 3);
  assert.strictEqual(o.hasDHInLineup.value, true);
  assert.strictEqual(o.isDHCancelled.value, false);
  assert.strictEqual(pitcherNames(o), '陳一,許投');
  assert.strictEqual(o.activeLineup.value[0].substitutes[0].name, '謝替');
  assert.ok(!o.benchPlayers.value.some(p => ['陳一', '許投', '謝替'].includes(p['球員姓名'])));
  // 回讀後繼續換投、上傳，試算表仍正確
  dhPitcherChange(o, '鄭投');
  await o.uploadSubstitutionsToGAS(); await tick();
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一,後援投手:許投,後援投手:鄭投');
});

test('F6 比賽完成：同步後蓋上結束時間、清除草稿；強制模式未登入時保留草稿', async () => {
  const ok = boot();
  ok.app.gameInfo.value.opponent = '猛虎';
  setStarters(ok.app, DH9);
  ok.app.independentPitcherId.value = byName(ok.app, '陳一');
  await ok.app.uploadStartersToGAS(); await tick();
  dhPitcherChange(ok.app, '許投');
  ok.saveDraft();
  ok.app.finishGame(); await tick();
  const sh = gameSheet(ok.backend);
  assert.strictEqual(sh.rows[2][2], '比賽結束時間');
  assert.strictEqual(pitcherRows(ok.backend), '先發投手:陳一,後援投手:許投');
  assert.ok(!ok.storage.longan_lineup_draft);

  const ng = boot({ props: { TEAM_PASSCODE: 'longan', AUTH_ENFORCED: 'true' }, loginPasscode: 'wrong' });
  setStarters(ng.app, NINE);
  ng.app.currentStep.value = 3;
  ng.saveDraft();
  ng.app.finishGame(); await tick(); await tick();
  assert.ok(ng.storage.longan_lineup_draft, '未登入時草稿要保留');
  assert.ok(ng.alerts.some(a => a.includes('結案失敗')));
});

test('F7 流水簿（調度紀錄）不會記下 token', async () => {
  const { app, backend } = boot({ props: { TEAM_PASSCODE: 'longan', AUTH_ENFORCED: 'true' }, loginPasscode: 'longan' });
  setStarters(app, NINE);
  await app.uploadStartersToGAS(); await tick(); await tick();
  const log = backend.ss.getSheetByName('調度紀錄');
  const text = JSON.stringify(log.rows);
  assert.ok(!text.includes('token'));
  assert.ok(!text.includes('longan"'));
  assert.ok(text.includes('saveStarters'));
});

test('F8 舊版前端（沒帶 pitchers）仍可從打序產生投手表', async () => {
  const { backend } = boot();
  const gi = { date: '2026-09-20', gameNum: 'G1', opponent: '舊版' };
  const slots = NINE.map(([pos, name], i) => ({ starter: { pos, posLabel: pos + ' (x)', number: String(i), name }, substitutes: [] }));
  slots[5].substitutes.push({ pos: 'P', posLabel: 'P (1)', number: '11', name: '許投', timestamp: 5 });
  slots[0].substitutes.push({ pos: 'PH', posLabel: 'PH (代打)', number: '13', name: '謝替', timestamp: 6 });
  backend.handle({ action: 'saveSubstitutions', gameInfo: gi, activeLineup: slots });
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一,後援投手:許投');
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('  ✅ ' + name); }
    catch (e) { console.log('  ❌ ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n     ')); process.exitCode = 1; }
  }
  console.log(`\nlineup.html 邏輯測試：${passed}/${tests.length} 通過`);
})();
