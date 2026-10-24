// 從時程挑比賽（game-pick.js，V01.16.00）的測試
// 龍安調度與紀錄工具第一步：「📅 今天：11/15（日）vs RELOOC｜大漢聯盟」，點一下填好日期、對手，對手名稱和時程一致（賽後一鍵發布才對得到）。
// 期望值一律手寫。
const assert = require('assert');
const GamePick = require('../game-pick');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✅ ' + name); }
  catch (e) { console.log('  ❌ ' + name + '\n     ' + String(e.message).split('\n').slice(0, 4).join('\n     ')); process.exitCode = 1; }
};

const game = (date, opponent, o = {}) => ({ type: 'game', date, gatherTime: '09:00', startTime: '10:00', venue: '大漢B球場', opponent, score: null, resultUrl: null, cancelled: false, note: '', ...o });
const practice = (date, o = {}) => ({ type: 'practice', date, startTime: '08:00', endTime: '12:00', venue: '', cancelled: false, note: '', ...o });
const SCHEDULE = [
  game('2026-11-01', 'ZERO', { league: '大漢聯盟' }),
  practice('2026-11-08'),
  game('2026-11-15', 'RELOOC', { league: '大漢聯盟' }),
  game('2026-11-22', '雨人', { cancelled: true }),
  game('2026-11-29', '猛虎'),
];

console.log('game-pick.js 從時程挑比賽');

test('今天有比賽 → 挑今天那場，標「今天」', () => {
  assert.deepStrictEqual(GamePick.suggest(SCHEDULE, '2026-11-15'),
    { date: '2026-11-15', opponent: 'RELOOC', league: '大漢聯盟', isToday: true, label: '今天：11/15（日）vs RELOOC｜大漢聯盟' });
});

test('今天沒有比賽 → 最近的下一場，標「下一場」', () => {
  assert.deepStrictEqual(GamePick.suggest(SCHEDULE, '2026-11-09'),
    { date: '2026-11-15', opponent: 'RELOOC', league: '大漢聯盟', isToday: false, label: '下一場：11/15（日）vs RELOOC｜大漢聯盟' });
});

test('取消的比賽跳過、練球不算；時程沒排序也找得到最近的', () => {
  assert.strictEqual(GamePick.suggest(SCHEDULE, '2026-11-16').date, '2026-11-29');
  assert.strictEqual(GamePick.suggest(SCHEDULE, '2026-11-08').date, '2026-11-15');   // 今天只有練球
  assert.strictEqual(GamePick.suggest(SCHEDULE.slice().reverse(), '2026-11-02').date, '2026-11-15');
});

test('已經過的比賽不算；之後沒有比賽 → null', () => {
  assert.strictEqual(GamePick.suggest(SCHEDULE, '2026-11-30'), null);
  assert.strictEqual(GamePick.suggest([], '2026-11-30'), null);
});

test('時程壞掉（不是陣列、某筆不是物件、缺日期或對手）→ 略過壞的，不會出錯', () => {
  assert.strictEqual(GamePick.suggest(null, '2026-11-15'), null);
  assert.strictEqual(GamePick.suggest({ a: 1 }, '2026-11-15'), null);
  assert.strictEqual(GamePick.suggest([null, 5, game('2026-11-15', ''), game('', 'X'), game('2026-11-20', 'OK')], '2026-11-15').opponent, 'OK');
});

test('按鈕文字：沒填賽事 → 不顯示「｜賽事」；對手前後空白去掉', () => {
  assert.strictEqual(GamePick.suggest(SCHEDULE, '2026-11-23').label, '下一場：11/29（日）vs 猛虎');
  assert.strictEqual(GamePick.suggest([game('2026-12-05', ' 同樂 ')], '2026-12-05').label, '今天：12/5（六）vs 同樂');
  assert.strictEqual(GamePick.suggest([game('2026-12-05', ' 同樂 ')], '2026-12-05').opponent, '同樂');
});

console.log(`\n共 ${passed} 項通過` + (process.exitCode ? '（有失敗）' : ''));
