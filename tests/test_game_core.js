// 實況賽事紀錄的計算核心（根目錄 game-core.js）的測試
// 規則來源：docs/賽事紀錄工具_規則漏洞清單.md（A～F）、docs/賽事紀錄工具_構想.md 第 11 節。
// 標準答案：期望值一律手算，或來自 2026-08-30 G4 對雨人的賽事戰報（和 test_record_engine.js 同一組數字）。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const GC = require('../game-core');
const { checkGame } = require('../data-check');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✅ ' + name); }
  catch (e) { console.log('  ❌ ' + name + '\n     ' + String(e.message).split('\n')[0]); process.exitCode = 1; }
};

// ---- 簡單陣容：龍安先攻，1～9 棒背號 11～19；板凳 21～25 ----
const POS9 = ['CF', 'SS', '2B', '1B', '3B', 'LF', 'RF', 'C', 'P'];
const SETUP = {
  id: '2026-10-25_G1_ZERO', date: '2026-10-25', gameNum: 'G1', opponent: 'ZERO', teamName: '龍安',
  usBatFirst: true, dh: false,
  lineup: POS9.map((pos, i) => ({ number: String(11 + i), name: `球員${11 + i}`, pos })),
  bench: [21, 22, 23, 24, 25].map((n) => ({ number: String(n), name: `板凳${n}` })),
};
// DH 制：第 4 棒是 DH，投手 #1 不在打序
const SETUP_DH = {
  ...SETUP, dh: true,
  lineup: ['CF', 'SS', '2B', 'DH', '3B', 'LF', 'RF', 'C', '1B'].map((pos, i) => ({ number: String(11 + i), name: `球員${11 + i}`, pos })),
  pitcher: { number: '1', name: '投手一' },
};
const OUT = -1;

const play = (evs, setup = SETUP) => GC.replay(setup, evs);
// 把狀態設成「幾出局、哪幾壘有人」：陣列是一、二、三壘上的跑者是進攻方第幾棒（打者是第 1 棒，跑者用 7～9 棒）
function at(state, outs, bases) {
  const s = JSON.parse(JSON.stringify(state));
  s.outs = outs;
  s.bases = [0, 1, 2].map((i) => bases[i] || null).map((slot) => {
    if (!slot) return null;
    if (s.offense === 'us') { const p = s.lineup[slot - 1]; return { side: 'us', slot, number: p.number, name: p.name }; }
    return { side: 'opp', slot, number: null, name: '' };
  });
  return s;
}
const fresh = (setup = SETUP) => GC.newGame(setup);
const usBatting = (st, num) => st.stats.batting[num];
const baseSlots = (st) => st.bases.map((r) => (r ? r.slot : null));
const errs = (st, ev) => GC.validate(st, ev).join(' / ');
// 打者的打席：預設去向＋例外（moves 的 key：0 = 打者，1～3 = 壘上跑者）
const PA = (st, result, pos, opts) => GC.buildPA(st, result, pos, opts);
// 進攻三人出局，換下半局（換投手守備前不用排守位：簡單陣容的守位本來就齊）
const threeOuts = [{ t: 'pa', result: 'K', pos: null, runners: [{ from: 0, to: OUT }] },
  { t: 'pa', result: 'K', pos: null, runners: [{ from: 0, to: OUT }] },
  { t: 'pa', result: 'K', pos: null, runners: [{ from: 0, to: OUT }] }];

console.log('A 死球／安全進壘');

test('A1 一、三壘有人觸身：一壘跑者上二壘，三壘跑者留在三壘、不得分', () => {
  const s = at(fresh(), 0, [7, null, 9]);
  const n = GC.apply(s, PA(s, 'HBP', null));
  assert.deepStrictEqual(baseSlots(n), [1, 7, 9]);
  assert.strictEqual(n.score.us, 0);
});

test('A1 滿壘觸身：擠回 1 分，打點 1', () => {
  const s = at(fresh(), 0, [7, 8, 9]);
  const n = GC.apply(s, PA(s, 'HBP', null));
  assert.strictEqual(n.score.us, 1);
  assert.strictEqual(usBatting(n, s.lineup[s.usNext].number).RBI, 1);
});

test('A1 觸身球的跑者鎖定：沒被擠的三壘跑者改成得分 → 不能送出', () => {
  const s = at(fresh(), 0, [7, null, 9]);
  assert.match(errs(s, PA(s, 'HBP', null, { moves: { 3: { to: 4, reason: '暴投' } } })), /觸身|死球/);
});

test('申告故意四壞和觸身一樣：二壘有人，跑者不能多跑', () => {
  const s = at(fresh(), 0, [null, 8, null]);
  assert.deepStrictEqual(baseSlots(GC.apply(s, PA(s, 'IBB', null))), [1, 8, null]);
  assert.match(errs(s, PA(s, 'IBB', null, { moves: { 2: { to: 3, reason: '暴投' } } })), /死球/);
});

test('A2 二壘有人四壞：二壘跑者預設不動（沒被擠）', () => {
  const s = at(fresh(), 0, [null, 8, null]);
  const d = GC.defaults(s, 'BB');
  assert.strictEqual(d.find((r) => r.from === 2).to, 2);
  assert.strictEqual(d.find((r) => r.from === 0).to, 1);
});

test('A2 一壘跑者多跑到三壘：沒選原因不能送出，選了原因可以', () => {
  const s = at(fresh(), 0, [7, null, null]);
  assert.match(errs(s, PA(s, 'BB', null, { moves: { 1: { to: 3 } } })), /原因/);
  assert.deepStrictEqual(GC.validate(s, PA(s, 'BB', null, { moves: { 1: { to: 3, reason: '盜壘' } } })), []);
});

test('A2 被擠的跑者不能選「留原壘」', () => {
  const s = at(fresh(), 0, [7, null, null]);
  assert.match(errs(s, PA(s, 'BB', null, { moves: { 1: { to: 1 } } })), /被擠/);
});

test('A3 捕手妨礙打擊：打者上一壘、不算打數，捕手記失誤', () => {
  const s = at(fresh(), 0, [null, null, null]);
  const n = GC.apply(s, PA(s, 'CI', null));
  const b = usBatting(n, '11');
  assert.deepStrictEqual([b.AB, b.H, baseSlots(n)[0]], [0, 0, 1]);
  // 對手半局：我方捕手（第 8 棒 #18）記一次失誤
  const d = play(threeOuts);
  const m = GC.apply(d, PA(d, 'CI', null));
  assert.strictEqual(usBatting(m, '18').E, 1);
});

console.log('\nB 犧牲打與打點');

test('B1 0 出局三壘有人中飛、跑者得分：犧飛，打數 0、打點 1', () => {
  const s = at(fresh(), 0, [null, null, 9]);
  const n = GC.apply(s, PA(s, 'FLY', 8, { moves: { 3: { to: 4 } } }));
  const b = usBatting(n, '11');
  assert.deepStrictEqual([b.AB, b.RBI, n.score.us, n.outs], [0, 1, 1, 1]);
  assert.strictEqual(n.halves[0].items.slice(-1)[0].kind, 'SF');
});

test('B1 2 出局三壘有人中飛：第三個出局，不得分，也不是犧飛', () => {
  const s = at(fresh(), 2, [null, null, 9]);
  const n = GC.apply(s, PA(s, 'FLY', 8));
  assert.strictEqual(n.score.us, 0);
  const it = n.halves[0].items.slice(-1)[0];
  assert.notStrictEqual(it.kind, 'SF');
  assert.strictEqual(usBatting(n, '11').AB, 1);
});

test('B1 二壘手接殺飛球、跑者得分：不自動判犧飛；記錄員勾選才算', () => {
  const s = at(fresh(), 1, [null, null, 9]);
  const auto = GC.apply(s, PA(s, 'FLY', 4, { moves: { 3: { to: 4 } } }));
  assert.notStrictEqual(auto.halves[0].items.slice(-1)[0].kind, 'SF');
  assert.strictEqual(usBatting(auto, '11').AB, 1);
  const manual = GC.apply(s, PA(s, 'FLY', 4, { moves: { 3: { to: 4 } }, sf: true }));
  assert.strictEqual(manual.halves[0].items.slice(-1)[0].kind, 'SF');
  assert.strictEqual(usBatting(manual, '11').AB, 0);
});

test('B2 未滿兩出局觸擊出局、跑者推進：犧觸，不算打數；記錄員可以取消', () => {
  const s = at(fresh(), 0, [7, null, null]);
  const n = GC.apply(s, PA(s, 'BUNT', 1, { moves: { 1: { to: 2 } } }));
  assert.strictEqual(n.halves[0].items.slice(-1)[0].kind, 'SAC');
  assert.strictEqual(usBatting(n, '11').AB, 0);
  const no = GC.apply(s, PA(s, 'BUNT', 1, { moves: { 1: { to: 2 } }, sac: false }));
  assert.strictEqual(usBatting(no, '11').AB, 1);
});

test('B3 雙殺打不記打點（0 出局一、三壘，滾地雙殺，三壘跑者回本壘）', () => {
  const s = at(fresh(), 0, [7, null, 9]);
  const n = GC.apply(s, PA(s, 'GROUND', 6, { moves: { 1: { to: OUT, reason: '封殺' }, 3: { to: 4 } } }));
  assert.strictEqual(n.outs, 2);
  assert.strictEqual(n.score.us, 1);
  assert.strictEqual(usBatting(n, '11').RBI, 0);
  assert.strictEqual(n.halves[0].items.slice(-1)[0].kind, 'DP');
});

test('B3 失誤造成的得分：打點預設 0，可以手動改', () => {
  const s = at(fresh(), 0, [null, null, 9]);
  const n = GC.apply(s, PA(s, 'E', 6, { moves: { 3: { to: 4 } } }));
  assert.strictEqual(usBatting(n, '11').RBI, 0);
  const m = GC.apply(s, PA(s, 'E', 6, { moves: { 3: { to: 4 } }, rbi: 1 }));
  assert.strictEqual(usBatting(m, '11').RBI, 1);
});

test('B3 安打帶回的分算打點，暴投、捕逸跑回來的不算', () => {
  const s = at(fresh(), 0, [null, 8, 9]);
  const n = GC.apply(s, PA(s, '1B', 8, { moves: { 2: { to: 4 }, 3: { to: 4 } } }));
  assert.strictEqual(usBatting(n, '11').RBI, 2);
  const m = GC.apply(s, PA(s, 'K', null, { moves: { 3: { to: 4, reason: '暴投' } } }));
  assert.strictEqual(usBatting(m, '11').RBI, 0);
  assert.strictEqual(m.score.us, 1);
});

console.log('\nC 跑者推進');

test('C1 一壘有人滾地出局：被擠的一壘跑者預設進一個壘；沒被擠的三壘跑者預設不動', () => {
  const s = at(fresh(), 0, [7, null, 9]);
  const d = GC.defaults(s, 'GROUND');
  assert.deepStrictEqual(d.map((r) => [r.from, r.to]), [[0, OUT], [1, 2], [3, 3]]);
});

test('C2 全壘打：所有跑者都得分，不能選留壘', () => {
  const s = at(fresh(), 0, [7, 8, null]);
  const n = GC.apply(s, PA(s, 'HR', 8));
  assert.deepStrictEqual([n.score.us, usBatting(n, '11').RBI, baseSlots(n).every((x) => x === null)], [3, 3, true]);
  assert.match(errs(s, PA(s, 'HR', 8, { moves: { 1: { to: 3 } } })), /全壘打/);
});

test('C3 後面的跑者不能超過前面的跑者（前面的沒出局時）', () => {
  const s = at(fresh(), 0, [7, 8, null]);
  assert.match(errs(s, PA(s, '1B', 8, { moves: { 1: { to: 4, reason: '趁傳球' }, 2: { to: 3 } } })), /超過/);
  // 前面的跑者出局就可以
  assert.deepStrictEqual(GC.validate(s, PA(s, '1B', 8, { moves: { 2: { to: OUT, reason: '觸殺' }, 1: { to: 3 } } })), []);
});

test('同一個壘包兩位跑者 → 不能送出', () => {
  const s = at(fresh(), 0, [7, null, null]);
  assert.match(errs(s, PA(s, '1B', 8, { moves: { 1: { to: 1 } } })), /同一個壘/);
});

test('跑者被判出局要選原因（封殺、觸殺、回壘不及）', () => {
  const s = at(fresh(), 0, [7, null, null]);
  assert.match(errs(s, PA(s, '1B', 8, { moves: { 1: { to: OUT } } })), /出局要選原因/);
  assert.deepStrictEqual(GC.validate(s, PA(s, '1B', 8, { moves: { 1: { to: OUT, reason: '觸殺' } } })), []);
});

test('C4 打者多跑一個壘要選原因；安打照樣成立', () => {
  const s = at(fresh(), 0, [null, null, null]);
  assert.match(errs(s, PA(s, '1B', 8, { moves: { 0: { to: 2 } } })), /原因/);
  const n = GC.apply(s, PA(s, '1B', 8, { moves: { 0: { to: 2, reason: '趁傳球' } } }));
  assert.deepStrictEqual([baseSlots(n)[1], usBatting(n, '11').H], [1, 1]);
});

test('C4 打者延伸推進被刺殺：安打仍然成立、記一個出局', () => {
  const s = at(fresh(), 0, [null, null, null]);
  const n = GC.apply(s, PA(s, '1B', 8, { moves: { 0: { to: OUT, reason: '觸殺' } } }));
  assert.deepStrictEqual([usBatting(n, '11').H, n.outs], [1, 1]);
});

console.log('\nD 出局數與得分');

test('D1 觸殺造成第三出局又有人得分：沒選先後就不能送出；選「先踩本壘」才算分', () => {
  const s = at(fresh(), 2, [7, null, 9]);
  const ev = (o) => PA(s, '1B', 8, { moves: { 3: { to: 4 }, 1: { to: OUT, reason: '觸殺' } }, ...o });
  assert.match(errs(s, ev()), /先踩|觸殺/);
  assert.strictEqual(GC.apply(s, ev({ runsBeforeTag: true })).score.us, 1);
  assert.strictEqual(GC.apply(s, ev({ runsBeforeTag: false })).score.us, 0);
});

test('D2 一球超過三個出局 → 不能送出', () => {
  const s = at(fresh(), 2, [7, null, null]);
  assert.match(errs(s, PA(s, 'GROUND', 6, { moves: { 1: { to: OUT, reason: '封殺' } } })), /三個出局|超過/);
});

test('【修正】一出局滿壘游擊雙殺（三出局）：二壘跑者上三壘、三壘跑者留壘也能送出，不得分（壘包會清空，不檢查同壘）', () => {
  const s = at(fresh(), 1, [7, 8, 9]);
  const ev = PA(s, 'GROUND', 6, { moves: { 1: { to: OUT, reason: '封殺' }, 2: { to: 3 }, 3: { to: 3 } } });
  assert.deepStrictEqual(GC.validate(s, ev), []);
  const n = GC.apply(s, ev);
  assert.deepStrictEqual([n.score.us, n.offense, n.outs], [0, 'opp', 0]);
});

test('【修正】得分因第三出局（封殺）不算時，打席資料記下被取消的分數，畫面才能提示', () => {
  const s = at(fresh(), 1, [7, 8, 9]);
  const n = GC.apply(s, PA(s, 'GROUND', 6, { moves: { 1: { to: OUT, reason: '封殺' } } })); // 預設三壘跑者「得分」
  const it = n.halves[0].items.slice(-1)[0];
  assert.deepStrictEqual([it.runs, it.voidedRuns], [0, 1]);
});

test('第三個出局是封殺時，這一球的得分不算', () => {
  const s = at(fresh(), 2, [7, null, 9]);
  const n = GC.apply(s, PA(s, '1B', 6, { moves: { 0: { to: 1 }, 1: { to: OUT, reason: '封殺' }, 3: { to: 4 } } }));
  assert.strictEqual(n.score.us, 0);
});

test('跑壘事件造成第三出局：打者下一局還是第一個打，這次不算打席', () => {
  let s = at(fresh(), 2, [7, null, null]);
  s.usNext = 4; // 第 5 棒打擊中
  s = GC.apply(s, { t: 'run', runners: [{ from: 1, to: OUT, reason: '盜壘失敗' }] });
  assert.strictEqual(s.offense, 'opp');
  assert.strictEqual(s.usNext, 4);
  assert.strictEqual(usBatting(s, '15'), undefined);
});

test('三出局後自動換到下半局，出局數、壘包清空', () => {
  const s = play([...threeOuts]);
  assert.deepStrictEqual([s.inning, s.top, s.offense, s.outs, baseSlots(s)], [1, false, 'opp', 0, [null, null, null]]);
  assert.strictEqual(s.halves[0].runs, 0);
});

console.log('\nE 賽中調度');

test('代打：換上的人接這一棒、下一個打，被換下的人不能再上場', () => {
  let s = fresh();
  s = GC.apply(s, { t: 'sub', kind: 'PH', in: { number: '21', name: '板凳21' } });
  assert.strictEqual(s.lineup[0].number, '21');
  assert.strictEqual(s.lineup[0].pos, null);
  assert.ok(s.removed.includes('11'));
  assert.match(errs(s, { t: 'sub', kind: 'DEF', slot: 2, in: { number: '11', name: '球員11' } }), /退場/);
});

test('代跑：壘上的名字和打序一起換，得分記在代跑者', () => {
  let s = at(fresh(), 0, [1, null, null]);
  s.usNext = 1;
  s = GC.apply(s, { t: 'sub', kind: 'PR', base: 1, in: { number: '22', name: '板凳22' } });
  assert.deepStrictEqual([s.bases[0].number, s.lineup[0].number], ['22', '22']);
  s = GC.apply(s, PA(s, 'HR', 8));
  assert.strictEqual(usBatting(s, '22').R, 1);
});

test('換投（一般賽制）：新投手接原投手的棒次與守位，投手成績分開記', () => {
  let s = play(threeOuts);
  s = GC.apply(s, PA(s, 'K', null));
  s = GC.apply(s, { t: 'sub', kind: 'P', in: { number: '23', name: '板凳23' } });
  assert.deepStrictEqual([s.lineup[8].number, s.lineup[8].pos], ['23', 'P']);
  s = GC.apply(s, PA(s, 'K', null));
  assert.deepStrictEqual([s.stats.pitching['19'].outs, s.stats.pitching['23'].outs], [1, 1]);
});

test('E1 板凳沒人時：右外野手和投手互換守位，可以完成，打序不變', () => {
  const s = play(threeOuts, { ...SETUP, bench: [] });
  const n = GC.apply(s, { t: 'pos', changes: [{ slot: 7, pos: 'P' }, { slot: 9, pos: 'RF' }] });
  assert.deepStrictEqual(GC.fieldingProblems(n), []);
  assert.deepStrictEqual(n.lineup.map((p) => p.number), SETUP.lineup.map((p) => p.number));
  assert.strictEqual(GC.currentPitcher(n).number, '17');
});

test('防守半局開始前九個守位要齊全、不重複，否則打席不能送出', () => {
  let s = GC.apply(fresh(), { t: 'sub', kind: 'PH', in: { number: '21', name: '板凳21' } });
  s = GC.replay(SETUP, [{ t: 'sub', kind: 'PH', in: { number: '21', name: '板凳21' } }, ...threeOuts]);
  assert.match(GC.fieldingProblems(s).join(' / '), /第 1 棒.*尚未排守位/);
  assert.match(errs(s, PA(s, 'K', null)), /守位/);
  const dup = GC.apply(s, { t: 'pos', changes: [{ slot: 1, pos: 'SS' }] });
  assert.match(GC.fieldingProblems(dup).join(' / '), /重複/);
  const ok = GC.apply(s, { t: 'pos', changes: [{ slot: 1, pos: 'CF' }] });
  assert.deepStrictEqual(GC.validate(ok, PA(ok, 'K', null)), []);
});

test('DH 被代打：新球員接任 DH，不取消 DH', () => {
  let s = at(fresh(SETUP_DH), 0, []);
  s.usNext = 3;
  s = GC.apply(s, { t: 'sub', kind: 'PH', in: { number: '21', name: '板凳21' } });
  assert.deepStrictEqual([s.lineup[3].pos, s.dh], ['DH', true]);
});

test('DH 制換投：只換投手，打序不動', () => {
  let s = GC.apply(fresh(SETUP_DH), { t: 'sub', kind: 'P', in: { number: '23', name: '板凳23' } });
  assert.deepStrictEqual([GC.currentPitcher(s).number, s.lineup.map((p) => p.number).join()], ['23', SETUP_DH.lineup.map((p) => p.number).join()]);
});

test('DH 有效時把打序裡的人排去投手 → 擋下，要先記 DH 取消', () => {
  const s = fresh(SETUP_DH);
  assert.match(errs(s, { t: 'pos', changes: [{ slot: 1, pos: 'P' }] }), /DH/);
});

test('手動 DH 取消（DH 進守備）：投手接被換下野手的棒次，DH 待排守位，打序不再有 DH', () => {
  let s = GC.apply(fresh(SETUP_DH), { t: 'dhOff', slot: 6 }); // 原左外野第 6 棒退場，投手接第 6 棒
  assert.deepStrictEqual([s.dh, s.lineup[5].number, s.lineup[5].pos, s.lineup[3].pos], [false, '1', 'P', null]);
  assert.ok(s.removed.includes('16'));
  s = GC.apply(s, { t: 'pos', changes: [{ slot: 4, pos: 'LF' }] });
  assert.deepStrictEqual(GC.fieldingProblems(s), []);
  assert.strictEqual(GC.currentPitcher(s).number, '1');
});

console.log('\nF 不死三振');

test('F 一壘沒人或兩出局：可以不死三振上壘；一壘有人且未滿兩出局：擋下', () => {
  const ok1 = at(fresh(), 0, [null, null, null]);
  const ok2 = at(fresh(), 2, [7, null, null]);
  const bad = at(fresh(), 1, [7, null, null]);
  assert.deepStrictEqual(GC.validate(ok1, PA(ok1, 'K_REACH', null)), []);
  assert.deepStrictEqual(GC.validate(ok2, PA(ok2, 'K_REACH', null)), []);
  assert.match(errs(bad, PA(bad, 'K_REACH', null)), /不死三振/);
  const n = GC.apply(ok1, PA(ok1, 'K_REACH', null));
  assert.deepStrictEqual([usBatting(n, '11').K, usBatting(n, '11').AB, n.outs, baseSlots(n)[0]], [1, 1, 0, 1]);
});

console.log('\nG 防守半局');

test('對手打者棒次 1～9 循環', () => {
  let s = play(threeOuts);
  const slots = [];
  for (let i = 0; i < 11; i++) {
    slots.push(s.oppNext + 1);
    s = GC.apply(s, PA(s, 'BB', null));
    if (s.bases.every(Boolean) && i < 10) s = at(s, s.outs, []);
  }
  assert.deepStrictEqual(slots, [1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2]);
});

test('投手成績：局數、被安打、失分、四壞、三振、觸身、全壘打', () => {
  let s = play(threeOuts);
  [['1B', 8], ['HR', 7], ['BB', null], ['HBP', null], ['K', null], ['FLY', 9], ['GROUND', 6]].forEach(([r, p]) => { s = GC.apply(s, PA(s, r, p)); });
  const p = s.stats.pitching['19'];
  assert.deepStrictEqual([p.outs, p.H, p.HR, p.R, p.BB, p.HBP, p.SO], [3, 2, 1, 2, 1, 1, 1]);
  assert.strictEqual(s.score.opp, 2);
});

test('對手失誤上壘：失誤記到當時守那個位置的我方野手（成績表 E 欄）', () => {
  let s = play(threeOuts);
  s = GC.apply(s, PA(s, 'E', 6));
  assert.strictEqual(usBatting(s, '12').E, 1); // 第 2 棒 #12 守游擊
  assert.match(s.halves[1].items.slice(-1)[0].desc, /游擊.*球員12.*失誤/);
});

console.log('\nH 復原與半局');

test('復原上一筆（含換人）：結果和沒記那一筆時完全一樣', () => {
  const evs = [{ t: 'pa', result: '1B', pos: 8, runners: [{ from: 0, to: 1 }] },
    { t: 'sub', kind: 'PR', base: 1, in: { number: '21', name: '板凳21' } }];
  assert.deepStrictEqual(GC.replay(SETUP, evs.slice(0, 1)), GC.replay(SETUP, evs.slice(0, 1)));
  const undone = GC.replay(SETUP, evs.slice(0, -1));
  assert.strictEqual(undone.lineup[0].number, '11');
  assert.ok(!undone.removed.includes('11'));
});

test('半局結束時的「本局得 X 分」', () => {
  const s = play([{ t: 'pa', result: 'HR', pos: 7, runners: [{ from: 0, to: 4 }] }, { t: 'pa', result: 'HR', pos: 8, runners: [{ from: 0, to: 4 }] }, ...threeOuts]);
  assert.strictEqual(s.halves[0].runs, 2);
});

test('比賽結束之後不能再記', () => {
  const s = play([{ t: 'end' }]);
  assert.strictEqual(s.ended, true);
  assert.match(errs(s, PA(s, 'K', null)), /結束/);
});

console.log('\nJ 驗收：2026-08-30 G4 對雨人（標準答案：賽事戰報）');

const FIX = path.join(__dirname, 'fixtures');
const g0830 = JSON.parse(fs.readFileSync(path.join(FIX, '2026-08-30_G4_雨人.events.json'), 'utf8'));
let s0830 = null;
let game0830 = null;
try { s0830 = GC.replay(g0830.setup, g0830.events); game0830 = GC.toGame(g0830.setup, g0830.events, { generatedAt: '2026-10-02T00:00:00Z' }); } catch (e) { /* 下面的測試會報錯 */ }

test('每位打者的 AB、R、H、RBI、BB、K 都和戰報一致', () => {
  const expected = [
    ['56', 3, 1, 1, 2, 0, 0], ['17', 0, 1, 0, 0, 2, 0], ['21', 1, 1, 0, 0, 0, 0],
    ['6', 3, 2, 1, 0, 0, 1], ['2', 0, 0, 0, 0, 1, 0], ['55', 1, 0, 0, 0, 0, 1],
    ['19', 1, 0, 0, 1, 1, 1], ['91', 2, 0, 0, 0, 0, 0], ['36', 1, 0, 0, 0, 0, 1],
    ['12', 3, 0, 0, 0, 0, 2], ['39', 2, 1, 0, 0, 1, 2], ['1', 0, 1, 0, 0, 1, 0],
    ['49', 1, 0, 0, 0, 0, 0],
  ];
  assert.deepStrictEqual(game0830.batting.map((b) => [b.number, b.AB, b.R, b.H, b.RBI, b.BB, b.K]), expected);
});

test('合計 AB 18、R 7、H 2、RBI 3、BB 6、K 8、HBP 1；二安、盜壘記在對的人', () => {
  const sum = (k) => game0830.batting.reduce((a, b) => a + b[k], 0);
  assert.deepStrictEqual([sum('AB'), sum('R'), sum('H'), sum('RBI'), sum('BB'), sum('K'), sum('HBP')], [18, 7, 2, 3, 6, 8, 1]);
  const row = (n) => game0830.batting.find((b) => b.number === n);
  assert.deepStrictEqual([row('56')['2B'], row('39').SB, row('17').SB, row('2').HBP], [1, 1, 1, 1]);
});

test('比分 7:6，各半局 龍安 2、5、0、0、0，雨人 0、0、6、0、0，雨人 8 安', () => {
  assert.deepStrictEqual(game0830.score, { us: 7, opp: 6 });
  assert.deepStrictEqual(game0830.halves.map((h) => h.runs), [2, 0, 5, 0, 0, 6, 0, 0, 0, 0]);
  const oppHits = game0830.halves.filter((h) => h.offense === 'opp')
    .flatMap((h) => h.items).filter((i) => i.type === 'pa' && ['1B', '2B', '3B', 'HR'].includes(i.kind)).length;
  assert.strictEqual(oppHits, 8);
});

test('投手成績：張容基 2.0 局 1 安 0 失 1 四壞 1 三振 1 觸身；蘇垣華 3.0 局 7 安 6 失 1 四壞 7 三振', () => {
  assert.deepStrictEqual(game0830.pitching.map((p) => [p.number, p.IP, p.H, p.R, p.BB, p.SO, p.HBP]),
    [['1', '2.0', 1, 0, 1, 1, 1], ['56', '3.0', 7, 6, 1, 7, 0]]);
  assert.strictEqual(game0830.pitchingStatus, 'complete');
});

test('我方失誤：三局下游擊 #19、五局下右外野 #36 各 1 次', () => {
  const e = game0830.batting.filter((b) => b.E).map((b) => [b.number, b.E]);
  assert.deepStrictEqual(e, [['19', 1], ['36', 1]]);
});

test('產出的賽事成績資料通過現有的資料檢查（公開頁畫得出來）', () => {
  const r = checkGame(game0830);
  assert.strictEqual(r.fatal, null);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(game0830.id, '2026-08-30_G4_雨人');
});

console.log('\n不變條件（8/30 整場每一筆都檢查）');

test('出局數 0～3、壘包不重複、比分＝各半局得分總和、重算兩次結果相同', () => {
  let st = GC.newGame(g0830.setup);
  g0830.events.forEach((ev, i) => {
    st = GC.apply(st, ev);
    assert.ok(st.outs >= 0 && st.outs <= 3, `第 ${i + 1} 筆出局數 ${st.outs}`);
    const on = st.bases.filter(Boolean).map((r) => `${r.side}${r.slot}`);
    assert.strictEqual(new Set(on).size, on.length, `第 ${i + 1} 筆壘包重複`);
    const us = st.halves.filter((h) => h.offense === 'us').reduce((a, h) => a + h.runs, 0);
    const opp = st.halves.filter((h) => h.offense === 'opp').reduce((a, h) => a + h.runs, 0);
    assert.deepStrictEqual(st.score, { us, opp }, `第 ${i + 1} 筆比分`);
  });
  assert.deepStrictEqual(GC.replay(g0830.setup, g0830.events), s0830);
});

console.log(`\n共 ${passed} 項通過`);
