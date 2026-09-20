// 三大調度情境的系統性測試（各 5 個變體，共 15 案）
//   情境 A：一般九人調度，投手需要打擊
//   情境 B：DH 制，整場都是 DH
//   情境 C：先發 DH，中途取消
//
// 每個案例都跑完整鏈路：前端狀態 → payload → 真實 doPost → 模擬試算表，
// 並針對投手表、打者表、成績合計列位置、DH 狀態四個面向斷言。
//
// 用法：
//   node tests/test_scenarios.js            跑一輪
//   node tests/test_scenarios.js --repeat 5 跑五輪並檢查每輪結果是否一致
const assert = require('assert');
const {
  gameSheet, pitcherRows, batterNames,
  boot, byName, setStarters, sub, dhPitcherChange,
  NINE, DH9, tick,
} = require('./harness');

// ---------- 額外的試算表讀取輔助 ----------

// 「成績合計」列的列號（D 欄），打者表一個、投手表一個
const totalsRowNumbers = (backend) =>
  gameSheet(backend).rows
    .map((r, i) => (r && r[3] === '成績合計' ? i + 1 : 0))
    .filter(Boolean);

// 打者資料列的列號範圍
function batterRowRange(backend) {
  const sh = gameSheet(backend);
  const h = sh.rows.findIndex(r => r && r[0] === '打順');
  let last = h;
  for (let i = h + 1; i < sh.rows.length; i++) {
    const r = sh.rows[i] || [];
    if (r[4] !== '先發' && r[4] !== '替補') break;
    last = i;
  }
  return { header: h + 1, first: h + 2, last: last + 1 };
}

// 打者「成績合計」是否緊接在最後一筆打者資料列下方
function battersTotalsAdjacent(backend) {
  const { last } = batterRowRange(backend);
  return totalsRowNumbers(backend).includes(last + 1);
}

// 投手表資料列數
const pitcherCount = (backend) =>
  pitcherRows(backend) === '' ? 0 : pitcherRows(backend).split(',').length;

// 在試算表上手動填入某位打者的 AB / H（模擬記錄員事後補成績）
function fillBatterStat(backend, name, ab, h) {
  const sh = gameSheet(backend);
  const { first, last } = batterRowRange(backend);
  for (let r = first; r <= last; r++) {
    if (String(sh.rows[r - 1][3] || '').replace('↳ ', '') === name) {
      sh.set(r, 6, ab);  // F 欄 AB
      sh.set(r, 8, h);   // H 欄 H
      return true;
    }
  }
  return false;
}
function readBatterStat(backend, name) {
  const sh = gameSheet(backend);
  const { first, last } = batterRowRange(backend);
  for (let r = first; r <= last; r++) {
    if (String(sh.rows[r - 1][3] || '').replace('↳ ', '') === name) {
      return [sh.rows[r - 1][5], sh.rows[r - 1][7]];
    }
  }
  return null;
}

// ---------- 測試註冊 ----------
const cases = [];
const scenario = (group, name, fn) => cases.push({ group, name, fn });

// 每個案例共同的基本健全性檢查
function invariants(backend, label) {
  assert.strictEqual(totalsRowNumbers(backend).length, 2,
    `${label}：應該剛好有 2 列「成績合計」（打者表 1、投手表 1），實際 ${totalsRowNumbers(backend).length}`);
  assert.ok(battersTotalsAdjacent(backend),
    `${label}：打者表的「成績合計」沒有緊接在最後一筆打者資料列下方`);
  const names = batterNames(backend);
  assert.strictEqual(new Set(names).size, names.length,
    `${label}：打者表出現重複列 → ${names.join(' / ')}`);
  const p = pitcherRows(backend);
  if (p) {
    const players = p.split(',').map(x => x.split(':')[1]);
    assert.strictEqual(new Set(players).size, players.length,
      `${label}：投手表出現同一位投手重複列 → ${p}`);
    assert.strictEqual(p.split(',').filter(x => x.startsWith('先發投手')).length, 1,
      `${label}：先發投手應該剛好 1 位 → ${p}`);
  }
}

// ==================================================================
// 情境 A：一般九人調度，投手需要打擊
// ==================================================================
const A = '情境A 一般九人（投手打擊）';

scenario(A, 'A1 先發上傳：投手在打序第6棒，投手表只有先發投手', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'A1';
  setStarters(app, NINE);
  await app.uploadStartersToGAS(); await tick();

  assert.strictEqual(app.hasDHInLineup.value, false, 'A1：不應判定為 DH 制');
  assert.strictEqual(app.isDHCancelled.value, false, 'A1：沒用 DH 就不該是「已取消」');
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一');
  assert.strictEqual(batterNames(backend).length, 9);
  assert.ok(batterNames(backend).includes('6P陳一'), 'A1：投手應該出現在打序第6棒');
  invariants(backend, 'A1');
});

scenario(A, 'A2 單次換投：新投手接第6棒，投手表長出後援投手', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'A2';
  setStarters(app, NINE);
  await app.uploadStartersToGAS(); await tick();
  sub(app, 6, '許投', 'P');
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.strictEqual(pitcherRows(backend), '先發投手:陳一,後援投手:許投');
  assert.strictEqual(batterNames(backend).length, 10);
  assert.ok(batterNames(backend).includes('6P↳ 許投'));
  invariants(backend, 'A2');
});

scenario(A, 'A3 代打後改守備：野手調度不影響投手表', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'A3';
  setStarters(app, NINE);
  await app.uploadStartersToGAS(); await tick();
  sub(app, 1, '謝替', 'PH');          // 第1棒代打
  sub(app, 1, 'SAME', 'CF');          // 代打者留下來守中外野
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.strictEqual(pitcherRows(backend), '先發投手:陳一', 'A3：野手調度不該動到投手表');
  assert.strictEqual(batterNames(backend).length, 11);
  invariants(backend, 'A3');
});

scenario(A, 'A4 連續兩次換投：三位投手依序排列且不重複', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'A4';
  setStarters(app, NINE);
  await app.uploadStartersToGAS(); await tick();
  sub(app, 6, '許投', 'P');
  await app.uploadSubstitutionsToGAS(); await tick();
  sub(app, 6, '鄭投', 'P');
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.strictEqual(pitcherRows(backend), '先發投手:陳一,後援投手:許投,後援投手:鄭投');
  assert.strictEqual(batterNames(backend).length, 11);
  invariants(backend, 'A4');
});

scenario(A, 'A5 手動填的打擊成績，在之後調度重寫時保留', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'A5';
  setStarters(app, NINE);
  await app.uploadStartersToGAS(); await tick();

  assert.ok(fillBatterStat(backend, '林二', 3, 2), 'A5：找不到林二的資料列');
  assert.ok(fillBatterStat(backend, '陳一', 2, 0), 'A5：找不到陳一的資料列');

  sub(app, 9, '郭替', 'PH');          // 另一棒換人，造成列數變動
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.deepStrictEqual(readBatterStat(backend, '林二'), [3, 2], 'A5：林二的 AB/H 被清掉了');
  assert.deepStrictEqual(readBatterStat(backend, '陳一'), [2, 0], 'A5：陳一的 AB/H 被清掉了');
  invariants(backend, 'A5');
});

// ==================================================================
// 情境 B：DH 制，整場都是 DH
// ==================================================================
const B = '情境B 全場DH';

scenario(B, 'B1 先發上傳：投手不在打序，但投手表抓得到', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'B1';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();

  assert.strictEqual(app.hasDHInLineup.value, true);
  assert.strictEqual(app.isDHCancelled.value, false);
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一');
  assert.strictEqual(batterNames(backend).length, 9);
  assert.ok(!batterNames(backend).some(n => n.includes('陳一')), 'B1：投手不該出現在打者表');
  invariants(backend, 'B1');
});

scenario(B, 'B2 獨立換投：打者表不受影響，DH 仍然有效', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'B2';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  dhPitcherChange(app, '許投');
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.strictEqual(pitcherRows(backend), '先發投手:陳一,後援投手:許投');
  assert.strictEqual(batterNames(backend).length, 9, 'B2：獨立換投不該改變打者表列數');
  assert.strictEqual(app.isDHCancelled.value, false, 'B2：獨立換投不該取消 DH');
  invariants(backend, 'B2');
});

scenario(B, 'B3 三次換投（含野手上來投）：四位投手不重複', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'B3';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  for (const n of ['許投', '鄭投', '謝替']) {
    dhPitcherChange(app, n);
    await app.uploadSubstitutionsToGAS(); await tick();
  }

  assert.strictEqual(pitcherRows(backend),
    '先發投手:陳一,後援投手:許投,後援投手:鄭投,後援投手:謝替');
  assert.strictEqual(batterNames(backend).length, 9);
  assert.strictEqual(app.isDHCancelled.value, false);
  invariants(backend, 'B3');
});

scenario(B, 'B4 DH 被代打：依規則不算取消 DH', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'B4';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();

  const willCancel = sub(app, 6, '謝替', 'PH');   // 第6棒是 DH 楊十
  assert.strictEqual(willCancel, false, 'B4：DH 被代打不該被判定為取消 DH');
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.strictEqual(app.isDHCancelled.value, false, 'B4：DH 被代打後仍應維持 DH 制');
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一', 'B4：代打不該動到投手表');
  assert.strictEqual(batterNames(backend).length, 10);
  invariants(backend, 'B4');
});

scenario(B, 'B5 DH 被代跑後由代跑者接任 DH：仍不算取消', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'B5';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();

  assert.strictEqual(sub(app, 6, '郭替', 'PR'), false, 'B5：DH 被代跑不該算取消');
  assert.strictEqual(sub(app, 6, 'SAME', 'DH'), false, 'B5：代跑者接任 DH 不該算取消');
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.strictEqual(app.isDHCancelled.value, false);
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一');
  assert.strictEqual(batterNames(backend).length, 11);
  invariants(backend, 'B5');
});

// ==================================================================
// 情境 C：先發 DH，中途取消
// ==================================================================
const C = '情境C 先發DH中途取消';

scenario(C, 'C1 原本的 DH 去守備 → 取消 DH', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'C1';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();

  assert.strictEqual(sub(app, 6, 'SAME', 'RF'), true, 'C1：DH 去守備應判定為取消 DH');
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.strictEqual(app.isDHCancelled.value, true);
  invariants(backend, 'C1');
});

scenario(C, 'C2 其他棒次出現 P → 取消 DH，投手進入打者表', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'C2';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();

  assert.strictEqual(sub(app, 3, '許投', 'P'), true, 'C2：任一棒出現 P 應判定為取消 DH');
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.strictEqual(app.isDHCancelled.value, true);
  assert.ok(batterNames(backend).includes('3P↳ 許投'), 'C2：新投手應出現在打者表第3棒');
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一,後援投手:許投');
  invariants(backend, 'C2');
});

scenario(C, 'C3 現任投手進入打序 → 取消 DH，投手表不重複', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'C3';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();

  assert.strictEqual(sub(app, 6, '陳一', 'P'), true, 'C3：投手進入打序應判定為取消 DH');
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.strictEqual(app.isDHCancelled.value, true);
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一',
    'C3：同一位投手既是先發又進打序，投手表只該有一列');
  assert.ok(batterNames(backend).includes('6P↳ 陳一'));
  invariants(backend, 'C3');
});

scenario(C, 'C4 取消 DH 後再換投：走一般換投路徑', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'C4';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  sub(app, 6, '陳一', 'P');                     // 取消 DH
  await app.uploadSubstitutionsToGAS(); await tick();
  sub(app, 6, '許投', 'P');                     // 取消後換投
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.strictEqual(app.isDHCancelled.value, true);
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一,後援投手:許投');
  invariants(backend, 'C4');
});

scenario(C, 'C5 取消前換過投、取消後再換投：投手表完整且不重複', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'C5';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  dhPitcherChange(app, '許投');                 // DH 制下換投
  await app.uploadSubstitutionsToGAS(); await tick();
  sub(app, 6, '許投', 'P');                     // 現任投手進打序 → 取消 DH
  await app.uploadSubstitutionsToGAS(); await tick();
  sub(app, 6, '鄭投', 'P');                     // 取消後再換投
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.strictEqual(app.isDHCancelled.value, true);
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一,後援投手:許投,後援投手:鄭投');
  assert.ok(batterNames(backend).includes('6P↳ 許投'));
  assert.ok(batterNames(backend).includes('6P↳ 鄭投'));
  invariants(backend, 'C5');
});

// ---------- 執行器 ----------
const repeatArg = process.argv.indexOf('--repeat');
const ROUNDS = repeatArg > -1 ? parseInt(process.argv[repeatArg + 1], 10) || 1 : 1;

(async () => {
  const rounds = [];
  for (let round = 1; round <= ROUNDS; round++) {
    if (ROUNDS > 1) console.log(`\n══════ 第 ${round} 輪 ══════`);
    const result = {};
    let group = null;
    for (const c of cases) {
      if (c.group !== group) { group = c.group; console.log(`\n${group}`); }
      try {
        await c.fn();
        result[c.name] = 'PASS';
        console.log('  ✅ ' + c.name);
      } catch (e) {
        result[c.name] = 'FAIL: ' + e.message.split('\n')[0];
        console.log('  ❌ ' + c.name + '\n     ' + e.message.split('\n')[0]);
        process.exitCode = 1;
      }
    }
    rounds.push(result);
    const pass = Object.values(result).filter(v => v === 'PASS').length;
    console.log(`\n第 ${round} 輪：${pass}/${cases.length} 通過`);
  }

  if (ROUNDS > 1) {
    const base = JSON.stringify(rounds[0]);
    const allSame = rounds.every(r => JSON.stringify(r) === base);
    console.log('\n══════ 跨輪一致性 ══════');
    console.log(allSame
      ? `✅ ${ROUNDS} 輪結果完全一致（無狀態殘留、無隨機性）`
      : '❌ 各輪結果不一致 —— 代表測試之間有狀態殘留或不確定性');
    if (!allSame) {
      process.exitCode = 1;
      for (const c of cases) {
        const vals = [...new Set(rounds.map(r => r[c.name]))];
        if (vals.length > 1) console.log(`   ${c.name} → ${vals.join(' | ')}`);
      }
    }
  }
})();
