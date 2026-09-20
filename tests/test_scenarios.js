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

// 讀出打者表每一列的細節（含成績欄與率值欄），供「守位變更列填 -」的斷言使用
function batterRowsDetailed(backend) {
  const sh = gameSheet(backend);
  const h = sh.rows.findIndex(r => r && r[0] === '打順');
  const out = [];
  for (let i = h + 1; i < sh.rows.length; i++) {
    const r = sh.rows[i] || [];
    if (r[4] !== '先發' && r[4] !== '替補') break;
    out.push({
      order: String(r[0]),
      pos: String(r[1] || '').split(' ')[0],
      name: String(r[3] || '').replace('↳ ', ''),
      role: r[4],
      ab: r[5],
      avg: r[15],
      isDash: r[5] === '-' && r[15] === '-',
    });
  }
  return out;
}

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
function invariants(app, backend, label) {
  // 守位重複在比賽的任何瞬間都不可能成立 —— 任何案例都不得產生。
  // 「尚缺守位」不檢查：代打／代跑之後守備還沒輪到，那是合法的中間狀態。
  const notice = app.activeDefenseNotice.value;
  assert.strictEqual(notice.conflicts.length, 0,
    `${label}：出現重複守位 ${notice.conflicts.join('、')} —— 這在規則上不可能成立`);

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
  invariants(app, backend, 'A1');
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
  invariants(app, backend, 'A2');
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
  invariants(app, backend, 'A3');
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
  invariants(app, backend, 'A4');
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
  invariants(app, backend, 'A5');
});

scenario(A, 'A6 代打者留下來守備：他的成績不會被自己的守位變更列蓋掉', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'A6';
  setStarters(app, NINE);
  await app.uploadStartersToGAS(); await tick();

  // 謝替代打第1棒的林二，之後留下來守 CF
  sub(app, 1, '謝替', 'PH');
  sub(app, 1, 'SAME', 'CF');
  await app.uploadSubstitutionsToGAS(); await tick();

  // 兩列都是「1｜↳ 謝替｜替補」，只有守位不同：
  //   第一列 PH 是他真正的打擊紀錄，第二列 CF 是守位變更，應為「-」
  const rows = batterRowsDetailed(backend);
  const ph = rows.find(r => r.order === '1' && r.name === '謝替' && r.pos === 'PH');
  const cf = rows.find(r => r.order === '1' && r.name === '謝替' && r.pos === 'CF');
  assert.ok(ph && cf, 'A6：應該有 PH 與 CF 兩列');
  assert.strictEqual(ph.isDash, false, 'A6：代打列應保留成績欄位');
  assert.strictEqual(cf.isDash, true, 'A6：守位變更列應填「-」');

  // 記錄員把成績填在代打列
  assert.ok(fillBatterStat(backend, '謝替', 1, 1), 'A6：找不到謝替的成績列');

  // 另一棒再換人，觸發整段重寫
  sub(app, 9, '郭替', 'PH');
  await app.uploadSubstitutionsToGAS(); await tick();

  // 若 savedStats 的 key 不帶「第幾次出現」，兩列會共用同一個 key，
  // 後面那列的「-」會覆蓋前面那列的真實成績。
  assert.deepStrictEqual(readBatterStat(backend, '謝替'), [1, 1],
    'A6：重寫後代打者的成績被自己的守位變更列蓋掉了');
  invariants(app, backend, 'A6');
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
  invariants(app, backend, 'B1');
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
  invariants(app, backend, 'B2');
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
  invariants(app, backend, 'B3');
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
  invariants(app, backend, 'B4');
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
  invariants(app, backend, 'B5');
});

// ==================================================================
// 情境 C：先發 DH，中途取消
// 依 MLB Rule 5.11(a) 設計。關鍵條款：
//   (5)  DH 上場守備時棒次不變，但投手必須接替「被換下的守備球員」的棒次
//   (7)  DH 的棒次是鎖住的
//   (8)  投手從投手丘轉任其他守位 → DH 終止
//   (9)  代打者之後上場投球 → DH 終止
//   (12) DH 上場守備 → DH 終止
// 每一案的終點都必須是「九個守位齊全、沒有重複」的合法打線。
// ==================================================================
const C = '情境C 先發DH中途取消';

scenario(C, 'C1 DH 去守備＋投手接替被換下者的棒次 → 打線合法 [Rule 5.11(a)(5)(12)]', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'C1';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();

  // 楊十（DH，第6棒）去守 RF，接替王六（第5棒 RF）
  assert.strictEqual(sub(app, 6, 'SAME', 'RF'), true, 'C1：DH 去守備應警告取消 DH');
  // Rule 5.11(a)(5)：投手必須接替「被換下的守備球員」王六 的第5棒
  sub(app, 5, '陳一', 'P');
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.strictEqual(app.isDHCancelled.value, true);
  assert.strictEqual(app.activeDefenseNotice.value.isComplete, true,
    'C1：完成 Rule 5.11(a)(5) 的兩步之後，九個守位應該齊全');
  // Rule 5.11(a)(7)：DH 的棒次鎖住 —— 楊十仍然打第6棒
  const onField = app.activeLineup.value.map(s =>
    (s.substitutes && s.substitutes.length ? s.substitutes[s.substitutes.length - 1] : s.starter));
  assert.strictEqual(onField[5].name, '楊十', 'C1：DH 的棒次不得改變');
  assert.strictEqual(onField[5].pos, 'RF');
  assert.strictEqual(onField[4].name, '陳一', 'C1：投手應接替第5棒（被換下的王六）');
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一');
  invariants(app, backend, 'C1');
});

scenario(C, 'C2 投手轉守其他守位 → 取消 DH，新投手接替另一棒 [Rule 5.11(a)(8)]', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'C2';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();

  // 投手陳一轉守 LF，接替蔡九的第9棒 → 依 (8) 終止 DH
  assert.strictEqual(sub(app, 9, '陳一', 'LF'), true, 'C2：投手轉守其他位置應警告取消 DH');
  // 新投手許投接替楊十（原 DH）的第6棒
  sub(app, 6, '許投', 'P');
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.strictEqual(app.isDHCancelled.value, true);
  assert.strictEqual(app.activeDefenseNotice.value.isComplete, true, 'C2：九個守位應該齊全');
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一,後援投手:許投');
  invariants(app, backend, 'C2');
});

scenario(C, 'C3 現任投手進入打序 → 取消 DH，投手表不重複', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'C3';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();

  assert.strictEqual(sub(app, 6, '陳一', 'P'), true, 'C3：投手進入打序應警告取消 DH');
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.strictEqual(app.isDHCancelled.value, true);
  assert.strictEqual(app.activeDefenseNotice.value.isComplete, true);
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一',
    'C3：同一位投手既是先發又進打序，投手表只該有一列');
  assert.ok(batterNames(backend).includes('6P↳ 陳一'));
  invariants(app, backend, 'C3');
});

scenario(C, 'C4 取消 DH 後再換投：走一般換投路徑', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'C4';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  sub(app, 6, '陳一', 'P');
  await app.uploadSubstitutionsToGAS(); await tick();
  assert.strictEqual(sub(app, 6, '許投', 'P'), false, 'C4：DH 已取消，不該再警告一次');
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.strictEqual(app.isDHCancelled.value, true);
  assert.strictEqual(app.activeDefenseNotice.value.isComplete, true);
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一,後援投手:許投');
  invariants(app, backend, 'C4');
});

scenario(C, 'C5 取消前換過投、取消後再換投：投手表完整且不重複', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'C5';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  dhPitcherChange(app, '許投');
  await app.uploadSubstitutionsToGAS(); await tick();
  sub(app, 6, '許投', 'P');
  await app.uploadSubstitutionsToGAS(); await tick();
  sub(app, 6, '鄭投', 'P');
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.strictEqual(app.isDHCancelled.value, true);
  assert.strictEqual(app.activeDefenseNotice.value.isComplete, true);
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一,後援投手:許投,後援投手:鄭投');
  assert.ok(batterNames(backend).includes('6P↳ 許投'));
  assert.ok(batterNames(backend).includes('6P↳ 鄭投'));
  invariants(app, backend, 'C5');
});

scenario(C, 'C6 代打者之後上場投球 → 取消 DH [Rule 5.11(a)(9)]', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'C6';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();

  // 謝替代打黃三（第2棒）—— 單純代打不該取消 DH
  assert.strictEqual(sub(app, 2, '謝替', 'PH'), false, 'C6：單純代打不該取消 DH');
  assert.strictEqual(app.isDHCancelled.value, false);
  // 該代打者接著上場投球 → 依 (9) 終止 DH
  assert.strictEqual(sub(app, 2, 'SAME', 'P'), true, 'C6：代打者上場投球應取消 DH');
  // 補完守備：楊十（原 DH）去守空出來的 3B
  sub(app, 6, 'SAME', '3B');
  await app.uploadSubstitutionsToGAS(); await tick();

  assert.strictEqual(app.isDHCancelled.value, true);
  assert.strictEqual(app.activeDefenseNotice.value.isComplete, true, 'C6：九個守位應該齊全');
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一,後援投手:謝替');
  invariants(app, backend, 'C6');
});

scenario(C, 'C7 多重換人：DH轉守RF＋原RF下場＋3B轉投手＋板凳接替空出的棒次 [Rule 5.11(a)(5) 多重換人]', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'C7';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();

  // ① DH 楊十（第6棒）去守 RF
  assert.strictEqual(sub(app, 6, 'SAME', 'RF'), true, 'C7①：DH 去守備應警告取消 DH');
  assert.ok(app.activeDefenseNotice.value.conflicts.length > 0,
    'C7①：此刻王六與楊十同時掛 RF，應偵測到重複守位');

  // ③ 3B 黃三（第2棒）改投球
  sub(app, 2, 'SAME', 'P');

  // ②④ 板凳謝替接替王六空出的第5棒，守 3B（原 RF 王六同時離場）
  sub(app, 5, '謝替', '3B');
  await app.uploadSubstitutionsToGAS(); await tick();

  // --- 打序與守備 ---
  const onField = app.activeLineup.value.map(s =>
    (s.substitutes && s.substitutes.length ? s.substitutes[s.substitutes.length - 1] : s.starter));
  assert.deepStrictEqual(
    onField.map((c, i) => `${i + 1}${c.pos}${c.name}`),
    ['1CF林二', '2P黃三', '3SS張四', '4C李五', '53B謝替', '6RF楊十', '71B吳七', '82B劉八', '9LF蔡九'],
    'C7：最終打序與守位不符預期'
  );
  assert.strictEqual(app.isDHCancelled.value, true);
  assert.strictEqual(app.activeDefenseNotice.value.isComplete, true, 'C7：九個守位應該齊全');

  // Rule 5.11(a)(7)：DH 的棒次鎖住
  assert.strictEqual(onField[5].name, '楊十', 'C7：DH 的棒次不得改變');
  // 換守位的球員棒次不變
  assert.strictEqual(onField[1].name, '黃三', 'C7：純換守位不該改變棒次');
  // 原投手陳一從未進入打序，且已離場
  assert.ok(!onField.some(c => c.name === '陳一'), 'C7：原投手不該出現在打序');
  assert.ok(!app.benchPlayers.value.some(p => p['球員姓名'] === '陳一'),
    'C7：被換下的投手不得回到板凳（不可重返比賽）');

  // --- 投手表 ---
  assert.strictEqual(pitcherRows(backend), '先發投手:陳一,後援投手:黃三');

  // --- 打者表：純守位變更列填「-」，真正的換人列維持公式 ---
  const rows = batterRowsDetailed(backend);
  const find = (order, name, pos) => rows.find(r => r.order === order && r.name === name && r.pos === pos);

  assert.strictEqual(find('2', '黃三', '3B').isDash, false, 'C7：黃三的第一列應保留成績欄位');
  assert.strictEqual(find('2', '黃三', 'P').isDash, true, 'C7：黃三的守位變更列應填「-」');
  assert.strictEqual(find('6', '楊十', 'DH').isDash, false, 'C7：楊十的第一列應保留成績欄位');
  assert.strictEqual(find('6', '楊十', 'RF').isDash, true, 'C7：楊十的守位變更列應填「-」');
  assert.strictEqual(find('5', '謝替', '3B').isDash, false,
    'C7：謝替是真的換人（不同球員），不該被當成守位變更');

  // --- 手動成績在後續重寫時保留，且不會被「-」列蓋掉 ---
  assert.ok(fillBatterStat(backend, '黃三', 3, 2), 'C7：找不到黃三的成績列');
  assert.ok(fillBatterStat(backend, '楊十', 4, 1), 'C7：找不到楊十的成績列');
  sub(app, 9, '郭替', 'PH');
  await app.uploadSubstitutionsToGAS(); await tick();
  assert.deepStrictEqual(readBatterStat(backend, '黃三'), [3, 2],
    'C7：重寫後黃三的成績被守位變更列的「-」蓋掉了');
  assert.deepStrictEqual(readBatterStat(backend, '楊十'), [4, 1],
    'C7：重寫後楊十的成績被守位變更列的「-」蓋掉了');

  invariants(app, backend, 'C7');
});

// ==================================================================
// 規則守門：確認工具會擋住規則上不可能的狀態
// ==================================================================
const G = '規則守門';

scenario(G, 'G1 守位重複時，調度上傳被擋下', async () => {
  const { app, backend } = boot();
  app.gameInfo.value.opponent = 'G1';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();
  const rowsBefore = gameSheet(backend).rows.length;

  // 只讓 DH 去守 RF，不補投手 → 兩個 RF（王六、楊十）
  sub(app, 6, 'SAME', 'RF');
  assert.ok(app.activeDefenseNotice.value.conflicts.length > 0,
    'G1：應該偵測到重複守位');

  await app.uploadSubstitutionsToGAS(); await tick();
  assert.strictEqual(gameSheet(backend).rows.length, rowsBefore,
    'G1：守位重複時不該寫入任何東西到試算表');
});

scenario(G, 'G2 已退場的球員不會出現在候選名單 [Rule 5.11(a)(4) 同理]', async () => {
  const { app } = boot();
  app.gameInfo.value.opponent = 'G2';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();

  app.openSubModal(2);
  assert.ok(app.subCandidates.value.some(c => c['球員姓名'] === '陳一'),
    'G2：換投前，現任投手陳一應該選得到');
  app.subModal.value.open = false;

  dhPitcherChange(app, '許投');            // 陳一退場
  await app.uploadSubstitutionsToGAS(); await tick();

  app.openSubModal(2);
  assert.ok(!app.subCandidates.value.some(c => c['球員姓名'] === '陳一'),
    'G2：退場的陳一不得重新出現在候選名單');
  assert.ok(app.subCandidates.value.some(c => c['球員姓名'] === '許投'),
    'G2：現任投手許投應該選得到');
  app.subModal.value.open = false;
});

scenario(G, 'G3 DH 因去守備而取消後，投手仍然選得到（回歸測試）', async () => {
  const { app } = boot();
  app.gameInfo.value.opponent = 'G3';
  setStarters(app, DH9);
  app.independentPitcherId.value = byName(app, '陳一');
  await app.uploadStartersToGAS(); await tick();

  sub(app, 6, 'SAME', 'RF');               // DH 去守備 → isDHCancelled 變 true
  assert.strictEqual(app.isDHCancelled.value, true);

  app.openSubModal(5);
  assert.ok(app.subCandidates.value.some(c => c['球員姓名'] === '陳一'),
    'G3：DH 取消後，Rule 5.11(a)(5) 仍要求投手能接替被換下者的棒次，' +
    '所以他必須留在候選名單裡（舊版以 !isDHCancelled 為條件，這一步會做不到）');
  app.subModal.value.open = false;
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
