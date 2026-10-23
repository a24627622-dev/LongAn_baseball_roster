// 戰績頁的整季加總（根目錄 season-stats.js，V01.13.02）的測試
// 期望值一律手算（見每個測試旁的算式）。
const assert = require('assert');
const SS = require('../season-stats');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✅ ' + name); }
  catch (e) { console.log('  ❌ ' + name + '\n     ' + String(e.message).split('\n')[0]); process.exitCode = 1; }
};

// ---- 時程（只列戰績會用到的欄位）----
const g = (date, opponent, extra = {}) => ({ type: 'game', date, opponent, score: null, resultUrl: `game.html?id=${encodeURIComponent(`${date}_G1_${opponent}`)}`, cancelled: false, note: '', league: '大漢聯盟', ...extra });
const SCHEDULE = [
  g('2026-08-30', '雨人', { league: undefined }),               // 舊比賽沒標賽事 → 不算
  g('2026-11-15', 'RELOOC'),
  { type: 'practice', date: '2026-11-22', startTime: '08:00', endTime: '12:00', venue: '', cancelled: false, note: '' },
  g('2026-11-29', '雨人'),
  g('2026-12-06', 'ZERO', { resultUrl: null }),                 // 還沒發布 → 不算
  g('2026-12-13', '猛虎', { cancelled: true }),                 // 取消 → 不算
  g('2026-12-20', '友隊', { league: '友誼賽' }),
  g('2027-03-07', 'ZERO'),
];
const bat = (number, name, o = {}) => ({ number, name, AB: 0, R: 0, H: 0, '2B': 0, '3B': 0, HR: 0, RBI: 0, BB: 0, HBP: 0, K: 0, SB: 0, E: 0, appeared: true, ...o });
const pit = (number, name, IP, o = {}) => ({ number, name, IP, H: 0, R: 0, ER: 0, BB: 0, HBP: 0, SO: 0, HR: 0, ...o });
const GAME_A = { id: '2026-11-15_G1_RELOOC', date: '2026-11-15', opponent: 'RELOOC', score: { us: 14, opp: 3 },
  batting: [bat('11', '蘇宥銘', { AB: 3, R: 2, H: 2, '2B': 1, RBI: 1, BB: 1, SB: 1 }), bat('5', '陳奕瑋', { AB: 4, R: 1, H: 1, HR: 1, RBI: 2, HBP: 1, K: 1, E: 1 })],
  pitching: [pit('18', '江佑霖', '2.1', { H: 4, R: 3, ER: 2, BB: 1, HBP: 1, SO: 1 }), pit('14', '張容齊', '0.2', { H: 1, BB: 1, SO: 1 })] };
const GAME_B = { id: '2026-11-29_G1_雨人', date: '2026-11-29', opponent: '雨人', score: { us: 3, opp: 6 },
  batting: [bat('11', '蘇宥銘新', { AB: 4, H: 1, '3B': 1, K: 2 }), bat('23', '陳威舜', { AB: 1, BB: 1 })],
  pitching: [pit('18', '江佑霖', '3.0', { H: 5, R: 6, ER: null, BB: 2, SO: 2, HR: 1 })] };
const GAME_F = { id: '2026-12-20_G1_友隊', date: '2026-12-20', opponent: '友隊', score: { us: 5, opp: 5 }, batting: [], pitching: [] };

console.log('戰績頁：分組（season-stats.js groups）');

test('依「年份＋賽事」分組：新的年份在前，同一年裡最近有比賽的賽事在前；沒標賽事、沒連到賽事成績、取消、練球都不算', () => {
  const gs = SS.groups(SCHEDULE);
  assert.deepStrictEqual(gs.map((x) => [x.label, x.entries.map((e) => e.date)]), [
    ['2027 大漢聯盟', ['2027-03-07']],
    ['2026 友誼賽', ['2026-12-20']],
    ['2026 大漢聯盟', ['2026-11-29', '2026-11-15']],
  ]);
  assert.deepStrictEqual(gs[2].entries[1], { date: '2026-11-15', opponent: 'RELOOC', id: '2026-11-15_G1_RELOOC', href: 'game.html?id=2026-11-15_G1_RELOOC' });
});

test('賽事名稱前後空白、中文比賽 ID 的連結都讀得懂；時程不是陣列 → 空的', () => {
  const gs = SS.groups([g('2026-11-15', '雨人', { league: ' 大漢聯盟 ' })]);
  assert.deepStrictEqual([gs[0].label, gs[0].entries[0].id], ['2026 大漢聯盟', '2026-11-15_G1_雨人']);
  assert.deepStrictEqual(SS.groups(null), []);
});

console.log('\n戰績頁：整季加總（season-stats.js summarize）');
const groupOf = (label) => SS.groups(SCHEDULE).find((x) => x.label === label);
const entries = groupOf('2026 大漢聯盟').entries;
const sum = SS.summarize(entries, { [GAME_A.id]: GAME_A, [GAME_B.id]: GAME_B });

test('本季戰績：2 場 1 勝 1 敗 0 和；每場比賽列表（新的在前）', () => {
  assert.deepStrictEqual(sum.record, { played: 2, win: 1, loss: 1, tie: 0 });
  assert.deepStrictEqual(sum.games.map((x) => [x.date, x.opponent, x.us, x.opp, x.result]), [['2026-11-29', '雨人', 3, 6, 'L'], ['2026-11-15', 'RELOOC', 14, 3, 'W']]);
  const t = SS.summarize(groupOf('2026 友誼賽').entries, { [GAME_F.id]: GAME_F });
  assert.deepStrictEqual(t.record, { played: 1, win: 0, loss: 0, tie: 1 });
});

test('打擊：跨場相加；同背號換名字用最新一場的；依背號數字排序（5 在 11 前面）', () => {
  const row = (r) => [r.number, r.name, r.AB, r.R, r.H, r['2B'], r['3B'], r.HR, r.RBI, r.BB, r.HBP, r.K, r.SB, r.E];
  assert.deepStrictEqual(sum.batting.map(row), [
    ['5', '陳奕瑋', 4, 1, 1, 0, 0, 1, 2, 0, 1, 1, 0, 1],
    ['11', '蘇宥銘新', 7, 2, 3, 1, 1, 0, 1, 1, 0, 2, 1, 0],
    ['23', '陳威舜', 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
  ]);
});

test('打擊率／上壘率／長打率（手算）：#5 .250／.400／1.000；#11 .429／.500／.857；#23 .000／.500／.000', () => {
  // #5：1/4；(1+0+1)/(4+0+1)=2/5；壘打 4（全壘打）/4
  // #11：3/7=.4286；(3+1+0)/(7+1+0)=4/8；壘打 1+2+3=6 /7=.857
  // #23：0/1；(0+1)/(1+1)=1/2；0/1
  assert.deepStrictEqual(sum.batting.map((r) => [r.AVG, r.OBP, r.SLG]), [['.250', '.400', '1.000'], ['.429', '.500', '.857'], ['.000', '.500', '.000']]);
});

test('打擊合計列＝每位加總：AB 12、H 4…；.333／.467／.833', () => {
  const t = sum.battingTotal;
  assert.deepStrictEqual([t.AB, t.R, t.H, t['2B'], t['3B'], t.HR, t.RBI, t.BB, t.HBP, t.K, t.SB, t.E], [12, 3, 4, 1, 1, 1, 3, 2, 1, 3, 1, 1]);
  // 4/12；(4+2+1)/(12+2+1)=7/15=.4667；壘打 1+2+3+4=10 /12=.833
  assert.deepStrictEqual([t.AVG, t.OBP, t.SLG], ['.333', '.467', '.833']);
});

test('打數 0：比率顯示「-」（只有保送、觸身）', () => {
  const s = SS.summarize([entries[1]], { [GAME_A.id]: { ...GAME_A, batting: [bat('9', '只保送', { BB: 1 })] } });
  assert.deepStrictEqual([s.batting[0].AVG, s.batting[0].OBP, s.batting[0].SLG], ['-', '1.000', '-']);
});

test('投手：IP 用出局數相加（2.1＋3.0＝5.1，不是 5.1 的小數相加）；ER 有一場沒填 → 「-」並標記', () => {
  const row = (r) => [r.number, r.name, r.IP, r.H, r.R, r.ER, r.BB, r.HBP, r.SO, r.HR];
  assert.deepStrictEqual(sum.pitching.map(row), [['14', '張容齊', '0.2', 1, 0, 0, 1, 0, 1, 0], ['18', '江佑霖', '5.1', 9, 9, '-', 3, 1, 3, 1]]);
  assert.strictEqual(sum.erIncomplete, true);
  const t = sum.pitchingTotal;
  assert.deepStrictEqual([t.IP, t.H, t.R, t.ER, t.BB, t.HBP, t.SO, t.HR], ['6.0', 10, 9, '-', 4, 1, 4, 1]);
});

test('投手 ER 都有填 → 正常相加，不標記；0.2＋0.2＝1.1', () => {
  const s = SS.summarize([entries[1]], { [GAME_A.id]: { ...GAME_A, pitching: [pit('14', '張容齊', '0.2', { ER: 1 }), pit('15', '王', '0.2', { ER: 0 })] } });
  assert.strictEqual(s.erIncomplete, false);
  assert.deepStrictEqual([s.pitchingTotal.IP, s.pitchingTotal.ER], ['1.1', 1]);
});

test('讀不到某一場的檔案 → 其他場照算，列出是哪一場', () => {
  const s = SS.summarize(entries, { [GAME_A.id]: GAME_A });
  assert.deepStrictEqual(s.record, { played: 1, win: 1, loss: 0, tie: 0 });
  assert.deepStrictEqual(s.missing, ['2026-11-29_G1_雨人']);
});

console.log(`\n共 ${passed} 項通過`);
