// 資料檔檢查（data-check.js、tests/check_data.js）的測試
// 重點：2026-09-21 的兩種壞法都要抓得到，而且正確的資料不能誤報。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { checkSchedule, checkAnnouncements, checkPlayers, checkGame, checkGameRoster, announcementLink, publishStatus, applySheetER } = require('../data-check');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✅ ' + name); }
  catch (e) { console.log('  ❌ ' + name + '\n     ' + e.message); process.exitCode = 1; }
};

const practice = (date, extra = {}) => ({ type: 'practice', date, startTime: '08:00', endTime: '12:00', venue: '', cancelled: false, note: '', ...extra });
const game = (date, extra = {}) => ({ type: 'game', date, gatherTime: '09:00', startTime: '10:00', venue: '大漢B球場', opponent: 'ZERO', score: null, resultUrl: null, cancelled: false, note: '', ...extra });
const ann = (date, extra = {}) => ({ date, title: '標題', body: '內文', pinned: false, ...extra });
const msgs = (list) => list.map((x) => x.msg).join(' / ');

// 用 CLI 跑一次，回傳 { code, out }
const CLI = path.join(__dirname, 'check_data.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'longan-check-'));
function runCli(scheduleText, announcementsText) {
  const s = path.join(tmp, 'schedule.json');
  const a = path.join(tmp, 'announcements.json');
  fs.writeFileSync(s, scheduleText);
  fs.writeFileSync(a, announcementsText);
  try {
    const out = execFileSync('node', [CLI, '--schedule', s, '--announcements', a], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: e.stdout };
  }
}
const GOOD_S = JSON.stringify([practice('2026-09-27'), game('2026-10-25')], null, 2);
const GOOD_A = JSON.stringify([ann('2026-09-23')], null, 2);

console.log('時程 checkSchedule');

test('正確的資料：沒有錯誤也沒有警告', () => {
  const r = checkSchedule([practice('2026-09-27'), practice('2026-10-04'), game('2026-10-25', { score: { longan: 7, opponent: 3 } })]);
  assert.strictEqual(r.fatal, null);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(r.valid.length, 3);
});

test('9/21 第二次事故：舊陣列巢狀在裡面 → 那一筆算錯誤、被略過，其他照常', () => {
  const r = checkSchedule([practice('2026-09-27'), [practice('2026-10-04'), practice('2026-10-11')]]);
  assert.strictEqual(r.badCount, 1);
  assert.strictEqual(r.valid.length, 1);
  assert.match(msgs(r.errors), /實際是陣列/);
});

test('最外層不是陣列 → fatal', () => {
  assert.match(checkSchedule({ type: 'practice' }).fatal, /最外層應該是陣列/);
  assert.match(checkSchedule(null).fatal, /最外層應該是陣列/);
});

test('缺 date、缺 type、type 打錯、日期格式錯、不存在的日期 → 錯誤', () => {
  const r = checkSchedule([
    { type: 'practice' },
    { date: '2026-09-27' },
    practice('2026-10-04', { type: 'Game' }),
    practice('2026/10/11'),
    practice('2026-02-30'),
    null,
  ]);
  assert.strictEqual(r.badCount, 6);
  assert.strictEqual(r.valid.length, 0);
  const m = msgs(r.errors);
  assert.match(m, /缺少 date/);
  assert.match(m, /缺少 type/);
  assert.match(m, /type 只能是 game 或 practice/);
  assert.match(m, /2026\/10\/11/);
  assert.match(m, /2026-02-30/);
});

test('同一天兩筆 → 錯誤，但兩筆都保留（不知道哪筆才對，不亂丟）', () => {
  const r = checkSchedule([practice('2026-10-25'), game('2026-10-25')]);
  assert.strictEqual(r.errors.length, 1);
  assert.match(msgs(r.errors), /同一天/);
  assert.strictEqual(r.badCount, 0);
  assert.strictEqual(r.valid.length, 2);
});

test('非週日、沒排序、欄位打錯、時間怪、比分錯、cancelled 型別錯 → 只是警告', () => {
  const r = checkSchedule([
    practice('2026-10-04'),
    practice('2026-09-27', { venu: '大武崙' }),
    game('2026-10-24', { startTime: '10點', score: { longan: '7' }, cancelled: 'false' }),
  ]);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.valid.length, 3);
  const m = msgs(r.warnings);
  assert.match(m, /不是週日/);
  assert.match(m, /沒有依日期排序/);
  assert.match(m, /不認得的欄位「venu」/);
  assert.match(m, /startTime 時間格式/);
  assert.match(m, /score 格式不對/);
  assert.match(m, /cancelled 應該是 true 或 false/);
});

test('練球不該有 opponent 欄位（type 改錯的常見跡象）→ 警告', () => {
  const r = checkSchedule([practice('2026-09-27', { opponent: 'ZERO' })]);
  assert.match(msgs(r.warnings), /不認得的欄位「opponent」/);
});

console.log('\n公告 checkAnnouncements');

test('正確的公告：沒有錯誤也沒有警告', () => {
  const r = checkAnnouncements([ann('2026-09-23', { pinned: true }), ann('2026-09-20')]);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.warnings, []);
});

test('缺 date、缺 title、空白 title、巢狀陣列 → 錯誤並略過', () => {
  const r = checkAnnouncements([{ title: 'x' }, { date: '2026-09-23' }, ann('2026-09-23', { title: '  ' }), [ann('2026-09-20')], ann('2026-09-21')]);
  assert.strictEqual(r.badCount, 4);
  assert.strictEqual(r.valid.length, 1);
});

test('欄位打錯、pinned 型別錯 → 只是警告', () => {
  const r = checkAnnouncements([ann('2026-09-23', { tittle: 'x', pinned: 'true' })]);
  assert.deepStrictEqual(r.errors, []);
  assert.match(msgs(r.warnings), /不認得的欄位「tittle」/);
  assert.match(msgs(r.warnings), /pinned 應該是 true 或 false/);
});

console.log('\n公告連結 link（2026-09-29：公告要能連到賽事成績）');

test('連到比賽 game.html?id=… → 合法，種類是「比賽」', () => {
  assert.deepStrictEqual(announcementLink('game.html?id=2026-08-30_G4_雨人'), { href: 'game.html?id=2026-08-30_G4_雨人', kind: 'game' });
  assert.deepStrictEqual(announcementLink('game.html?id=2026-08-30_G4_%E9%9B%A8%E4%BA%BA'), { href: 'game.html?id=2026-08-30_G4_%E9%9B%A8%E4%BA%BA', kind: 'game' });
  assert.deepStrictEqual(checkAnnouncements([ann('2026-09-29', { link: 'game.html?id=2026-08-30_G4_雨人' })]).warnings, []);
});

test('連到站內其他頁（schedule／news／index）→ 合法，種類是「其他頁」', () => {
  ['schedule.html', 'news.html', 'index.html'].forEach((href) => {
    assert.deepStrictEqual(announcementLink(href), { href, kind: 'page' });
    assert.deepStrictEqual(checkAnnouncements([ann('2026-09-29', { link: href })]).warnings, []);
  });
});

test('沒有 link、link 是 null → 沒有警告，也沒有按鈕', () => {
  assert.strictEqual(announcementLink(undefined), null);
  assert.strictEqual(announcementLink(null), null);
  assert.deepStrictEqual(checkAnnouncements([ann('2026-09-29'), ann('2026-09-28', { link: null })]).warnings, []);
});

test('外部網址 → 警告，不顯示按鈕', () => {
  ['https://example.com', 'http://example.com/game.html?id=x', '//example.com', 'javascript:alert(1)'].forEach((bad) => {
    assert.strictEqual(announcementLink(bad), null, bad);
    assert.match(msgs(checkAnnouncements([ann('2026-09-29', { link: bad })]).warnings), /link 應為/, bad);
  });
});

test('比賽 ID 空白、多帶參數或 # → 警告', () => {
  ['game.html?id=', 'game.html?id=a&x=1', 'game.html?id=a#top', 'game.html', 'game.html?id=a b'].forEach((bad) => {
    assert.strictEqual(announcementLink(bad), null, bad);
    assert.match(msgs(checkAnnouncements([ann('2026-09-29', { link: bad })]).warnings), /link 應為/, bad);
  });
});

test('link 不是文字 → 警告', () => {
  [123, true, {}, ['schedule.html']].forEach((bad) => {
    assert.strictEqual(announcementLink(bad), null);
    assert.match(msgs(checkAnnouncements([ann('2026-09-29', { link: bad })]).warnings), /link 應為/);
  });
});

test('不在清單上的站內頁（工具頁、不存在的頁）→ 警告，公告不能連進工具頁', () => {
  ['tools/lineup.html', 'tools/', '../index.html', 'about.html', 'data/schedule.json', 'SCHEDULE.HTML'].forEach((bad) => {
    assert.strictEqual(announcementLink(bad), null, bad);
    assert.match(msgs(checkAnnouncements([ann('2026-09-29', { link: bad })]).warnings), /link 應為/, bad);
  });
});

test('前後多了空白 → 警告，不自動修正（和 resultUrl 一致）', () => {
  [' schedule.html', 'schedule.html ', ' game.html?id=2026-08-30_G4_雨人'].forEach((bad) => {
    assert.strictEqual(announcementLink(bad), null, JSON.stringify(bad));
    assert.match(msgs(checkAnnouncements([ann('2026-09-29', { link: bad })]).warnings), /link 應為/);
  });
});

test('link 錯誤只算警告：那則公告仍在有效公告裡，不會被丟掉', () => {
  const r = checkAnnouncements([ann('2026-09-29', { link: 'https://example.com' }), ann('2026-09-28')]);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.badCount, 0);
  assert.strictEqual(r.valid.length, 2);
});

test('repo 裡的公告：8/30 戰報那則連到 8/30 的文字轉播，而且整份公告沒有警告', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'announcements.json'), 'utf8'));
  const r = checkAnnouncements(data);
  assert.deepStrictEqual(r.warnings, []);
  const report = data.find((x) => /8\/30/.test(x.title));
  assert.ok(report, '找不到 8/30 戰報公告');
  // 產生器是從時程複製連結，所以要和時程 8/30 那場的 resultUrl 一模一樣
  const sched = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'schedule.json'), 'utf8'));
  const g830 = sched.find((x) => x.date === '2026-08-30' && x.type === 'game');
  assert.deepStrictEqual(announcementLink(report.link), { href: g830.resultUrl, kind: 'game' });
});

console.log('\n球員名單 checkPlayers');

const player = (number, extra = {}) => ({ number, name: '蘇垣華', nickname: '小天', photo: null, ...extra });

test('正確的名單：沒有錯誤也沒有警告（有照片、沒照片都可以）', () => {
  const r = checkPlayers([player('56'), player('1', { name: '張容基', photo: 'images/players/1.jpg' })]);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(r.valid.length, 2);
});

test('背號重複 → 錯誤（文字紀錄用背號找人）', () => {
  const r = checkPlayers([player('18'), player('18', { name: '李浩偉' })]);
  assert.match(msgs(r.errors), /背號和第 1 位重複/);
});

test('背號不是文字數字、缺姓名 → 錯誤並略過', () => {
  const r = checkPlayers([player(56), player('5A'), { number: '7' }, player('9')]);
  assert.strictEqual(r.badCount, 3);
  assert.strictEqual(r.valid.length, 1);
});

test('照片路徑怪、欄位打錯 → 只是警告', () => {
  const r = checkPlayers([player('56', { photo: 'photos/56.jpg', nick: 'x' })]);
  assert.deepStrictEqual(r.errors, []);
  assert.match(msgs(r.warnings), /photo 應為 null/);
  assert.match(msgs(r.warnings), /不認得的欄位「nick」/);
});

console.log('\n比賽文字轉播 checkGame');

const goodGame = () => ({ id: '2026-08-30_G4_雨人', date: '2026-08-30', score: { us: 7, opp: 0 }, halves: [{ inning: 1, top: true, offense: 'us', runs: 2, items: [] }], batting: [], pitching: [] });

test('正確的比賽資料：沒有錯誤', () => {
  const r = checkGame(goodGame());
  assert.strictEqual(r.fatal, null);
  assert.deepStrictEqual(r.errors, []);
});

test('不是物件 → fatal；缺 halves／batting、id 格式錯、半局格式錯 → 錯誤', () => {
  assert.match(checkGame([]).fatal, /最外層應該是一個/);
  const g = goodGame();
  g.id = '雨人';
  delete g.batting;
  g.halves.push({ inning: '二', offense: 'us', items: [] });
  const m = msgs(checkGame(g).errors);
  assert.match(m, /id 應為「日期_場次_對手」/);
  assert.match(m, /缺少 batting/);
  assert.match(m, /第 2 個半局格式不對/);
});

test('時程的 resultUrl 不是 game.html?id= 格式 → 警告', () => {
  assert.deepStrictEqual(checkSchedule([game('2026-10-25', { resultUrl: 'game.html?id=2026-10-25_G1_ZERO' })]).warnings, []);
  assert.match(msgs(checkSchedule([game('2026-10-25', { resultUrl: 'https://example.com' })]).warnings), /resultUrl 應為 null/);
});

console.log('\n指令 tests/check_data.js');

test('正確的檔案 → exit 0', () => {
  const r = runCli(GOOD_S, GOOD_A);
  assert.strictEqual(r.code, 0, r.out);
});

test('9/21 第一次事故：開頭多一個 [ → exit 1，並指出大約第幾行', () => {
  const r = runCli('[\n' + GOOD_S, GOOD_A);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /不是合法的 JSON/);
  assert.match(r.out, /第 \d+ 行/);
});

test('9/21 第二次事故：合法 JSON 但舊陣列巢狀在裡面 → exit 1', () => {
  const nested = JSON.stringify([practice('2026-09-27'), [practice('2026-10-04')]], null, 2);
  const r = runCli(nested, GOOD_A);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /實際是陣列/);
});

test('只有警告（例如非週日）→ exit 0，但會列出警告', () => {
  const r = runCli(JSON.stringify([practice('2026-10-03')]), GOOD_A);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /不是週日/);
});

test('公告檔壞掉也會讓整體失敗', () => {
  const r = runCli(GOOD_S, '[{"date":"2026-09-23",}]');
  assert.strictEqual(r.code, 1);
});

test('比賽檔的檔名和裡面的 id 不一樣 → exit 1', () => {
  const dir = path.join(tmp, 'games');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-08-30_G1_雨人.json'), JSON.stringify(goodGame()));
  const s = path.join(tmp, 'schedule.json');
  const a = path.join(tmp, 'announcements.json');
  fs.writeFileSync(s, GOOD_S);
  fs.writeFileSync(a, GOOD_A);
  let out = '';
  let code = 0;
  try { out = execFileSync('node', [CLI, '--schedule', s, '--announcements', a, '--games', dir], { encoding: 'utf8' }); }
  catch (e) { code = e.status; out = e.stdout; }
  assert.strictEqual(code, 1);
  assert.match(out, /檔名是 2026-08-30_G1_雨人\.json，但裡面的 id 是/);
});

// ── 比賽資料的我方球員要對得上球員名單（2026-10-01：8/30 的 #93、#5 是誤植，照片以背號對人） ──
console.log('\n比賽資料 × 球員名單');
const ROSTER = [
  { number: '6', name: '黃宥憬', nickname: 'GD', photo: null },
  { number: '21', name: '李浩偉', nickname: '', photo: null },
  { number: '5', name: '陳奕瑋', nickname: '坦克', photo: null },
];
const rosterGame = (people) => ({
  id: '2026-08-30_G4_雨人', date: '2026-08-30', score: { us: 1, opp: 0 },
  halves: [
    { inning: 1, top: true, offense: 'us', items: [{ type: 'pa', slot: 3, ...people[0], bases: [null, people[1] || null, null], scorers: [] }] },
    { inning: 1, top: false, offense: 'opp', items: [{ type: 'pa', slot: 1, number: null, name: '', bases: null, scorers: [] }] },
  ],
  batting: people.map((p, i) => ({ slot: i + 1, ...p })),
  pitching: [],
});

test('我方球員背號、姓名都和名單一致 → 沒有錯誤', () => {
  const r = checkGameRoster(rosterGame([{ number: '6', name: '黃宥憬' }, { number: '21', name: '李浩偉' }]), ROSTER);
  assert.deepStrictEqual(r.errors, []);
});

test('背號不在名單上（#93）→ 錯誤，指出背號與姓名', () => {
  const r = checkGameRoster(rosterGame([{ number: '93', name: '黃宥憬' }]), ROSTER);
  assert.ok(r.errors.length > 0);
  assert.match(msgs(r.errors), /#93 黃宥憬/);
  assert.match(msgs(r.errors), /名單上沒有/);
});

test('背號在名單上但是別人（#5 李浩偉，名單 #5 是陳奕瑋）→ 錯誤，頭像會放錯人', () => {
  const r = checkGameRoster(rosterGame([{ number: '6', name: '黃宥憬' }, { number: '5', name: '李浩偉' }]), ROSTER);
  assert.match(msgs(r.errors), /#5 李浩偉/);
  assert.match(msgs(r.errors), /陳奕瑋/);
});

test('同一個錯只回報一次（出現在多個打席、壘包也只算一筆）', () => {
  const g = rosterGame([{ number: '93', name: '黃宥憬' }]);
  g.halves[0].items.push({ type: 'pa', slot: 3, number: '93', name: '黃宥憬', bases: null, scorers: [{ number: '93', name: '黃宥憬' }] });
  const r = checkGameRoster(g, ROSTER);
  assert.strictEqual(r.errors.length, 1, msgs(r.errors));
});

test('對手半局的打者不檢查（沒有背號）', () => {
  const r = checkGameRoster(rosterGame([{ number: '6', name: '黃宥憬' }]), ROSTER);
  assert.deepStrictEqual(r.errors, []);
});

test('投手成績的背號也檢查', () => {
  const g = rosterGame([{ number: '6', name: '黃宥憬' }]);
  g.pitching = [{ number: '93', name: '黃宥憬', outs: 3 }];
  assert.match(msgs(checkGameRoster(g, ROSTER).errors), /#93/);
});

test('名單是空的 → 不檢查（還沒建名單時不擋）', () => {
  const r = checkGameRoster(rosterGame([{ number: '93', name: '黃宥憬' }]), []);
  assert.deepStrictEqual(r.errors, []);
});

test('repo 的名單檔已建立（和試算表「球員名單」一樣 31 人）', () => {
  const players = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/players.json'), 'utf8'));
  assert.strictEqual(players.length, 31);
  const gd = players.find((p) => p.name === '黃宥憬');
  const hw = players.find((p) => p.name === '李浩偉');
  assert.strictEqual(gd && gd.number, '6');
  assert.strictEqual(hw && hw.number, '21');
});

test('repo 的 8/30 比賽資料：我方球員都對得上名單（#93→#6、#5→#21 已修正）', () => {
  const players = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/players.json'), 'utf8'));
  const g = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/games/2026-08-30_G4_雨人.json'), 'utf8'));
  const r = checkGameRoster(g, players);
  assert.deepStrictEqual(r.errors, [], msgs(r.errors));
});

test('CLI：比賽資料對不上名單 → exit 1', () => {
  const dir = path.join(tmp, 'games-roster');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-08-30_G4_雨人.json'), JSON.stringify(rosterGame([{ number: '93', name: '黃宥憬' }])));
  const s = path.join(tmp, 'schedule.json');
  const a = path.join(tmp, 'announcements.json');
  const p = path.join(tmp, 'players.json');
  fs.writeFileSync(s, GOOD_S);
  fs.writeFileSync(a, GOOD_A);
  fs.writeFileSync(p, JSON.stringify(ROSTER));
  let out = '';
  let code = 0;
  try { out = execFileSync('node', [CLI, '--schedule', s, '--announcements', a, '--players', p, '--games', dir], { encoding: 'utf8' }); }
  catch (e) { code = e.status; out = e.stdout; }
  assert.strictEqual(code, 1, out);
  assert.match(out, /#93 黃宥憬/);
});

console.log('\n投手 ER（自責分，V01.13.00：官網投手表加 ER 欄，ER 以試算表為準）');
{
  const pit = (extra = {}) => ({ number: '56', name: '蘇垣華', IP: '3.0', H: 7, R: 6, BB: 1, HBP: 0, SO: 7, HR: 0, ...extra });
  const withPit = (...ps) => ({ ...goodGame(), pitching: ps });

  test('ER 沒填 → 通過（舊比賽）；0 到 R 之間的整數 → 通過', () => {
    [pit(), pit({ ER: 0 }), pit({ ER: 6 }), pit({ ER: null })].forEach((p) => assert.deepStrictEqual(checkGame(withPit(p)).errors, [], JSON.stringify(p)));
  });

  test('ER 大於 R、負數、小數、文字 → 錯誤，指出是哪位投手', () => {
    [pit({ ER: 7 }), pit({ ER: -1 }), pit({ ER: 1.5 }), pit({ ER: '2' })].forEach((p) => {
      assert.match(msgs(checkGame(withPit(p)).errors), /#56 蘇垣華.*ER/, JSON.stringify(p));
    });
  });

  test('applySheetER：照背號套上試算表的 ER；沒填的提醒、黃色的提醒「待確認」；不改原本的物件', () => {
    const game = withPit({ ...pit(), number: '1', name: '張容基', R: 0 }, pit());
    const r = applySheetER(game, [{ number: '1', name: '張容基', ER: null, pending: false }, { number: '56', name: '蘇垣華', ER: 0, pending: true }]);
    assert.deepStrictEqual(r.game.pitching.map((p) => [p.number, p.ER]), [['1', null], ['56', 0]]);
    assert.ok(!('ER' in game.pitching[0]));
    assert.match(r.warnings.join(' / '), /#1 張容基.*還沒填 ER/);
    assert.match(r.warnings.join(' / '), /#56 蘇垣華.*待確認/);
  });

  test('applySheetER：試算表找不到這位投手、或讀不到試算表（null）→ ER 留空並提醒', () => {
    const r = applySheetER(withPit(pit()), []);
    assert.deepStrictEqual(r.game.pitching.map((p) => p.ER), [null]);
    assert.match(r.warnings.join(' / '), /#56 蘇垣華.*還沒填 ER/);
    const r2 = applySheetER(withPit(pit()), null);
    assert.match(r2.warnings.join(' / '), /讀不到試算表的 ER/);
  });
}

console.log('\n賽事成績發布 publishStatus（時程裡找這場、連結和比分對不對）');
{
  // 賽事成績（GameCore.toGame 產出）只用到 id、date、opponent、score
  const pub = (extra = {}) => ({ id: '2026-10-25_G1_ZERO', date: '2026-10-25', gameNum: 'G1', opponent: 'ZERO', score: { us: 7, opp: 3 }, ...extra });
  const URL = 'game.html?id=2026-10-25_G1_ZERO';

  test('時程有同一天、同對手的比賽，還沒連結、還沒填比分 → 找到 1 場，要填的連結和比分', () => {
    const r = publishStatus([practice('2026-10-18'), game('2026-10-25')], pub());
    assert.strictEqual(r.matches.length, 1);
    assert.strictEqual(r.matches[0].index, 1);
    assert.strictEqual(r.matches[0].link, 'none');
    assert.strictEqual(r.matches[0].score, 'none');
    assert.strictEqual(r.resultUrl, URL);
    assert.deepStrictEqual(r.score, { longan: 7, opponent: 3 });
    assert.deepStrictEqual(r.warnings, []);
  });

  test('resultUrl 已經是這一場 → 已連結；比分一樣 → 正確', () => {
    const r = publishStatus([game('2026-10-25', { resultUrl: URL, score: { longan: 7, opponent: 3 } })], pub());
    assert.strictEqual(r.matches[0].link, 'this');
    assert.strictEqual(r.matches[0].score, 'ok');
  });

  test('resultUrl 連到別場 → 提醒，並說出連到哪一場', () => {
    const r = publishStatus([game('2026-10-25', { resultUrl: 'game.html?id=2026-10-25_G2_ZERO' })], pub());
    assert.strictEqual(r.matches[0].link, 'other');
    assert.strictEqual(r.matches[0].linkedId, '2026-10-25_G2_ZERO');
    assert.match(r.warnings.join(' / '), /連到別場.*2026-10-25_G2_ZERO/);
  });

  test('比分不一致 → 列出時程和工具兩邊的數字', () => {
    const r = publishStatus([game('2026-10-25', { score: { longan: 6, opponent: 3 } })], pub());
    assert.strictEqual(r.matches[0].score, 'diff');
    assert.deepStrictEqual(r.matches[0].scheduleScore, { longan: 6, opponent: 3 });
    assert.match(r.warnings.join(' / '), /比分.*6.*3.*7.*3/);
  });

  test('時程找不到這場（測試比賽）→ 0 場，提醒不要發布到正式官網', () => {
    const r = publishStatus([game('2026-10-25', { opponent: '雨人' }), game('2026-10-26')], pub());
    assert.deepStrictEqual(r.matches, []);
    assert.match(r.warnings.join(' / '), /時程裡沒有這場.*測試比賽請不要發布/);
  });

  test('同一天同對手兩場（雙重賽）→ 兩場都列出，提醒依場次確認', () => {
    const r = publishStatus([game('2026-10-25', { startTime: '08:00' }), game('2026-10-25', { startTime: '13:00' })], pub());
    assert.deepStrictEqual(r.matches.map((m) => m.index), [0, 1]);
    assert.match(r.warnings.join(' / '), /2 場.*場次/);
  });

  test('已取消的比賽、同一天的練球不算', () => {
    const r = publishStatus([game('2026-10-25', { cancelled: true }), practice('2026-10-25'), game('2026-10-25')], pub());
    assert.deepStrictEqual(r.matches.map((m) => m.index), [2]);
  });

  test('對手名稱前後有空白照樣比對得到（時程、賽事成績兩邊都可能有）', () => {
    assert.strictEqual(publishStatus([game('2026-10-25', { opponent: ' ZERO ' })], pub()).matches.length, 1);
    assert.strictEqual(publishStatus([game('2026-10-25')], pub({ opponent: 'ZERO ' })).matches.length, 1);
  });

  test('比賽 ID 有中文：連結文字和時程編輯器寫進去的一樣（encodeURIComponent）', () => {
    const r = publishStatus([game('2026-08-30', { opponent: '雨人' })], pub({ id: '2026-08-30_G4_雨人', date: '2026-08-30', opponent: '雨人' }));
    assert.strictEqual(r.resultUrl, 'game.html?id=2026-08-30_G4_%E9%9B%A8%E4%BA%BA');
    // repo 裡 8/30 這場的時程連結就是這個字串（人工確認過可以點開）
    const sched = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'schedule.json'), 'utf8'));
    const real = sched.filter((x) => x.date === '2026-08-30' && x.type === 'game')[0];
    assert.strictEqual(real.resultUrl, r.resultUrl);
  });

  test('異常輸入：時程不是陣列、賽事成績缺資料 → 不丟錯，回 0 場', () => {
    assert.deepStrictEqual(publishStatus(null, pub()).matches, []);
    assert.deepStrictEqual(publishStatus([game('2026-10-25'), null, 5], pub()).matches.map((m) => m.index), [0]);
    assert.deepStrictEqual(publishStatus([game('2026-10-25')], null).matches, []);
  });
}

test('repo 裡現在的資料檔都通過', () => {
  const out = execFileSync('node', [CLI], { encoding: 'utf8' });
  assert.match(out, /沒有錯誤/);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n共 ${passed} 項通過`);
