// 一鍵發布的計算核心（publish-core.js，V01.15.00）的測試
// 發布：時程那一場填比分、成績連結、賽事；公告草稿；撤回：還原時程、刪公告。
// 期望值一律手寫。
const assert = require('assert');
const P = require('../publish-core');
const DataCheck = require('../data-check');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✅ ' + name); }
  catch (e) { console.log('  ❌ ' + name + '\n     ' + String(e.message).split('\n').slice(0, 4).join('\n     ')); process.exitCode = 1; }
};

const game = (date, opponent, o = {}) => ({ type: 'game', date, gatherTime: '09:00', startTime: '10:00', venue: '大漢B球場', opponent, score: null, resultUrl: null, cancelled: false, note: '', ...o });
const practice = (date) => ({ type: 'practice', date, startTime: '08:00', endTime: '12:00', venue: '', cancelled: false, note: '' });
const SCHEDULE = [
  practice('2026-11-08'),
  game('2026-11-15', 'RELOOC', { league: '大漢聯盟' }),
  game('2026-12-06', '猛虎', { resultUrl: 'game.html?id=2026-12-06_G2_%E7%8C%9B%E8%99%8E' }),
];
// 資料檢查不允許同一天兩筆，但 GitHub 上的檔案可能被人手改成這樣：只在這兩項測試用
const SAME_DAY = [
  game('2026-11-22', 'ZERO', { cancelled: true, note: '因雨取消' }),
  game('2026-11-22', 'ZERO', { startTime: '13:00' }),
  game('2026-11-29', '雨人', { startTime: '08:00' }),
  game('2026-11-29', '雨人', { startTime: '13:00' }),
];
const ANN = [
  { date: '2026-09-23', title: '龍安官方網站啟用', body: '', pinned: true },
  { date: '2026-11-02', title: '11/15 首戰集合時間', body: '9:00 集合', pinned: false },
];
const G = (o = {}) => ({ id: '2026-11-15_G1_RELOOC', date: '2026-11-15', gameNum: 'G1', opponent: 'RELOOC', teamName: '龍安', score: { us: 8, opp: 2 }, halves: [], batting: [], pitching: [], ...o });
const clone = (x) => JSON.parse(JSON.stringify(x));
const noErrors = (sched, ann) => {
  const s = DataCheck.checkSchedule(sched);
  assert.ok(!s.fatal && !s.errors.length, '時程有錯：' + JSON.stringify(s.fatal || s.errors));
  if (ann) {
    const a = DataCheck.checkAnnouncements(ann);
    assert.ok(!a.fatal && !a.errors.length, '公告有錯：' + JSON.stringify(a.fatal || a.errors));
  }
};

console.log('publish-core.js 發布：時程');

test('時程剛好對到一場：填比分、成績連結，賽事沿用原本的；其他筆不動、順序不變、不改原本的陣列', () => {
  const before = clone(SCHEDULE);
  const r = P.applyPublish(SCHEDULE, G(), {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.index, 1);
  assert.strictEqual(r.mode, 'new');
  assert.deepStrictEqual(r.schedule[1], game('2026-11-15', 'RELOOC', { league: '大漢聯盟', score: { longan: 8, opponent: 2 }, resultUrl: 'game.html?id=2026-11-15_G1_RELOOC' }));
  assert.deepStrictEqual(r.schedule.filter((_, i) => i !== 1), before.filter((_, i) => i !== 1));
  assert.deepStrictEqual(SCHEDULE, before);
  noErrors(r.schedule);
});

test('指定賽事：填進 league；選「友誼賽」（空字串）：拿掉 league 欄位', () => {
  assert.strictEqual(P.applyPublish(SCHEDULE, G(), { league: '台北市長盃' }).schedule[1].league, '台北市長盃');
  const r = P.applyPublish(SCHEDULE, G(), { league: '' });
  assert.ok(!('league' in r.schedule[1]));
  noErrors(r.schedule);
});

test('時程裡沒有這場 → 拒絕', () => {
  const r = P.applyPublish(SCHEDULE, G({ id: '2026-11-15_G1_XYZ', opponent: 'XYZ' }), {});
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /時程裡沒有這場/);
});

test('同一天、同對手有兩場 → 拒絕', () => {
  const r = P.applyPublish(SAME_DAY, G({ id: '2026-11-29_G1_雨人', date: '2026-11-29', opponent: '雨人' }), {});
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /2 場/);
});

test('已取消的那筆不算：11/22 ZERO 對到沒取消的那一筆', () => {
  const r = P.applyPublish(SAME_DAY, G({ id: '2026-11-22_G1_ZERO', date: '2026-11-22', opponent: 'ZERO', score: { us: 3, opp: 5 } }), {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.index, 1);
  assert.deepStrictEqual(r.schedule[0], SAME_DAY[0]);
});

test('時程那場已經連到別場 → 拒絕，不覆蓋', () => {
  const r = P.applyPublish(SCHEDULE, G({ id: '2026-12-06_G1_猛虎', date: '2026-12-06', opponent: '猛虎' }), {});
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /連到別場/);
  assert.match(r.error, /2026-12-06_G2_猛虎/);
});

test('同一場再發布（更新）：mode 是 update，比分換成新的，連結不變；結果和直接發布一樣', () => {
  const first = P.applyPublish(SCHEDULE, G(), {});
  const again = P.applyPublish(first.schedule, G({ score: { us: 9, opp: 2 } }), {});
  assert.strictEqual(again.mode, 'update');
  assert.deepStrictEqual(again.schedule[1].score, { longan: 9, opponent: 2 });
  assert.strictEqual(again.schedule[1].resultUrl, 'game.html?id=2026-11-15_G1_RELOOC');
  assert.deepStrictEqual(again.schedule, P.applyPublish(SCHEDULE, G({ score: { us: 9, opp: 2 } }), {}).schedule);
});

test('比賽 ID 不合格式 → 拒絕（避免寫到別的路徑）', () => {
  ['../x', '2026-11-15_G1_a/b', '2026-11-15_G1_..', '2026-13-01_G1_X', '2026-11-15_G1_', 'abc', '', null].forEach((id) => {
    assert.strictEqual(P.validId(id), false, String(id));
  });
  ['2026-11-15_G1_RELOOC', '2026-08-30_G4_雨人', '2026-11-15_G2_台北 A隊'].forEach((id) => assert.strictEqual(P.validId(id), true, id));
  const r = P.applyPublish(SCHEDULE, G({ id: '2026-11-15_G1_../../x' }), {});
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /比賽 ID/);
});

console.log('\npublish-core.js 公告');

test('公告草稿：勝、敗、和三種寫法；日期寫成「11/15」；連結有正確編碼；公告日期是發布當天', () => {
  assert.deepStrictEqual(P.draftAnnouncement(G(), '2026-11-15'), {
    date: '2026-11-15', title: '11/15 龍安 vs RELOOC 賽事戰報',
    body: '最終比數 8:2 龍安勝\n賽事成績紀錄與戰報更新囉~', pinned: false, link: 'game.html?id=2026-11-15_G1_RELOOC',
  });
  assert.strictEqual(P.draftAnnouncement(G({ score: { us: 3, opp: 5 } }), '2026-11-16').body, '最終比數 3:5 龍安敗\n賽事成績紀錄與戰報更新囉~');
  assert.strictEqual(P.draftAnnouncement(G({ score: { us: 4, opp: 4 } }), '2026-11-16').body, '最終比數 4:4 雙方和局\n賽事成績紀錄與戰報更新囉~');
  const rain = P.draftAnnouncement(G({ id: '2026-08-30_G4_雨人', date: '2026-08-30', opponent: '雨人', score: { us: 7, opp: 6 } }), '2026-09-01');
  assert.strictEqual(rain.title, '8/30 龍安 vs 雨人 賽事戰報');
  assert.strictEqual(rain.link, 'game.html?id=2026-08-30_G4_%E9%9B%A8%E4%BA%BA');
});

test('新增公告：放在最後面；已經有連到這場的公告 → 不重複新增', () => {
  const ann = P.draftAnnouncement(G(), '2026-11-15');
  const a = P.addAnnouncement(ANN, ann);
  assert.strictEqual(a.added, true);
  assert.deepStrictEqual(a.announcements, [...ANN, ann]);
  assert.strictEqual(P.hasAnnouncement(a.announcements, '2026-11-15_G1_RELOOC'), true);
  assert.strictEqual(P.hasAnnouncement(ANN, '2026-11-15_G1_RELOOC'), false);
  const b = P.addAnnouncement(a.announcements, { ...ann, title: '另一則' });
  assert.strictEqual(b.added, false);
  assert.deepStrictEqual(b.announcements, a.announcements);
  noErrors(SCHEDULE, a.announcements);
});

console.log('\npublish-core.js 撤回');

test('撤回：時程那場的比分、成績連結清空，賽事保留；只刪連到這場的公告，其他公告不動', () => {
  const sched = P.applyPublish(SCHEDULE, G(), {}).schedule;
  const ann = P.addAnnouncement(ANN, P.draftAnnouncement(G(), '2026-11-15')).announcements;
  const r = P.applyUnpublish(sched, ann, '2026-11-15_G1_RELOOC');
  assert.deepStrictEqual(r.schedule, SCHEDULE);
  assert.strictEqual(r.scheduleChanged, true);
  assert.deepStrictEqual(r.announcements, ANN);
  assert.strictEqual(r.removedAnnouncements, 1);
  noErrors(r.schedule, r.announcements);
});

test('撤回時程裡找不到的比賽：時程、公告都不動，不出錯', () => {
  const r = P.applyUnpublish(SCHEDULE, ANN, '2026-10-23_G1_測試中');
  assert.deepStrictEqual([r.schedule, r.announcements, r.scheduleChanged, r.removedAnnouncements], [SCHEDULE, ANN, false, 0]);
});

console.log('\npublish-core.js 要寫進 GitHub 的檔案');

test('發布＋公告：三個檔案（成績檔、時程、公告），內容是兩格縮排、最後換行；修改說明「發布賽事成績：日期 vs 對手 比分」', () => {
  const g = G();
  const r = P.buildPublish({ game: g, schedule: SCHEDULE, announcements: ANN, league: undefined, announcement: { title: '標題', body: '內文' }, today: '2026-11-15' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.files.map((f) => f.path), ['data/games/2026-11-15_G1_RELOOC.json', 'data/schedule.json', 'data/announcements.json']);
  assert.strictEqual(r.files[0].content, JSON.stringify(g, null, 2) + '\n');
  const sched = JSON.parse(r.files[1].content);
  assert.deepStrictEqual(sched[1].score, { longan: 8, opponent: 2 });
  assert.ok(r.files[1].content.endsWith('}\n]\n'));
  const ann = JSON.parse(r.files[2].content);
  assert.deepStrictEqual(ann[2], { date: '2026-11-15', title: '標題', body: '內文', pinned: false, link: 'game.html?id=2026-11-15_G1_RELOOC' });
  assert.strictEqual(r.message, '發布賽事成績：2026-11-15 vs RELOOC 8:2');
  noErrors(sched, ann);
});

test('不發公告 → 只有成績檔和時程；同一場再發布、比分沒變 → 不寫時程檔，修改說明「更新賽事成績」', () => {
  const r = P.buildPublish({ game: G(), schedule: SCHEDULE, announcements: ANN, announcement: null, today: '2026-11-15' });
  assert.deepStrictEqual(r.files.map((f) => f.path), ['data/games/2026-11-15_G1_RELOOC.json', 'data/schedule.json']);
  const again = P.buildPublish({ game: G(), schedule: JSON.parse(r.files[1].content), announcements: ANN, announcement: { title: 't', body: 'b' }, today: '2026-11-16' });
  assert.strictEqual(again.ok, true);
  assert.strictEqual(again.mode, 'update');
  assert.deepStrictEqual(again.files.map((f) => f.path), ['data/games/2026-11-15_G1_RELOOC.json', 'data/announcements.json']);
  assert.strictEqual(again.message, '更新賽事成績：2026-11-15 vs RELOOC 8:2');
});

test('撤回的檔案：成績檔刪除（content null）＋時程、公告；什麼都沒有可撤 → 沒有檔案', () => {
  const sched = P.applyPublish(SCHEDULE, G(), {}).schedule;
  const ann = P.addAnnouncement(ANN, P.draftAnnouncement(G(), '2026-11-15')).announcements;
  const r = P.buildUnpublish({ gameId: '2026-11-15_G1_RELOOC', gameExists: true, schedule: sched, announcements: ann });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.files.map((f) => [f.path, f.content === null]), [['data/games/2026-11-15_G1_RELOOC.json', true], ['data/schedule.json', false], ['data/announcements.json', false]]);
  assert.deepStrictEqual(JSON.parse(r.files[1].content), SCHEDULE);
  assert.strictEqual(r.message, '撤回賽事成績：2026-11-15_G1_RELOOC');
  const none = P.buildUnpublish({ gameId: '2026-11-15_G1_RELOOC', gameExists: false, schedule: SCHEDULE, announcements: ANN });
  assert.deepStrictEqual([none.ok, none.files.length], [true, 0]);
  assert.strictEqual(P.buildUnpublish({ gameId: '../x', gameExists: true, schedule: SCHEDULE, announcements: ANN }).ok, false);
});

test('時程、公告不是陣列（GitHub 上的檔案壞了）→ 拒絕', () => {
  assert.strictEqual(P.buildPublish({ game: G(), schedule: { a: 1 }, announcements: ANN, today: '2026-11-15' }).ok, false);
  assert.strictEqual(P.buildPublish({ game: G(), schedule: SCHEDULE, announcements: null, announcement: { title: 't', body: 'b' }, today: '2026-11-15' }).ok, false);
  assert.strictEqual(P.buildUnpublish({ gameId: '2026-11-15_G1_RELOOC', gameExists: true, schedule: 'x', announcements: ANN }).ok, false);
});

test('賽事選項：時程裡出現過的賽事，不重複、照第一次出現的順序', () => {
  const s = [...SCHEDULE, game('2026-12-13', 'A', { league: '台北市長盃' }), game('2026-12-20', 'B', { league: '大漢聯盟' }), practice('2026-12-27')];
  assert.deepStrictEqual(P.leagues(s), ['大漢聯盟', '台北市長盃']);
});

console.log(`\n共 ${passed} 項通過` + (process.exitCode ? '（有失敗）' : ''));
