// 比賽文字紀錄轉換引擎（record-engine.js）的測試
// 標準答案：2026-08-30 G4 對雨人的賽事戰報（補正版紀錄見 docs/文字記錄簡碼字典.md 第 6 節）
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const E = require('../record-engine');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✅ ' + name); }
  catch (e) { console.log('  ❌ ' + name + '\n     ' + e.message.split('\n')[0]); process.exitCode = 1; }
};

const FIX = path.join(__dirname, 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const LINEUP_0830 = JSON.parse(read('2026-08-30_G4_雨人.lineup.json'));
const msgs = (r) => r.warnings.map((w) => w.msg).join(' / ');
const pas = (r) => r.halves.flatMap((h) => h.items.filter((i) => i.type === 'pa'));

// 簡單陣容：1～9 棒背號 11～19，投手 1 號
const SIMPLE = {
  slots: [11, 12, 13, 14, 15, 16, 17, 18, 19].map((n, i) => ({ starter: { number: String(n), name: `球員${n}`, pos: i === 8 ? 'C' : 'LF' }, subs: [] })),
  pitchers: [{ number: '1', name: '投手一' }],
};
const run = (text, opts = {}) => E.parse(text, { lineup: SIMPLE, ...opts });

console.log('2026-08-30 G4 對雨人（標準答案：賽事戰報）');

const r0830 = E.parse(read('2026-08-30_G4_雨人.txt'), { lineup: LINEUP_0830 });

test('每位打者的 AB、R、H、RBI、BB、K 都和戰報一致', () => {
  // [背號, AB, R, H, RBI, BB, K]，來自賽事戰報截圖
  const expected = [
    ['56', 3, 1, 1, 2, 0, 0], ['17', 0, 1, 0, 0, 2, 0], ['5', 1, 1, 0, 0, 0, 0],
    ['93', 3, 2, 1, 0, 0, 1], ['2', 0, 0, 0, 0, 1, 0], ['55', 1, 0, 0, 0, 0, 1],
    ['19', 1, 0, 0, 1, 1, 1], ['91', 2, 0, 0, 0, 0, 0], ['36', 1, 0, 0, 0, 0, 1],
    ['12', 3, 0, 0, 0, 0, 2], ['39', 2, 1, 0, 0, 1, 2], ['1', 0, 1, 0, 0, 1, 0],
    ['49', 1, 0, 0, 0, 0, 0],
  ];
  const got = r0830.batting.map((b) => [b.number, b.AB, b.R, b.H, b.RBI, b.BB, b.K]);
  assert.deepStrictEqual(got, expected);
});

test('合計：AB 18、R 7、H 2、RBI 3、BB 6、K 8（和戰報一致），觸身 1 獨立記', () => {
  const sum = (k) => r0830.batting.reduce((a, b) => a + b[k], 0);
  assert.deepStrictEqual([sum('AB'), sum('R'), sum('H'), sum('RBI'), sum('BB'), sum('K'), sum('HBP')], [18, 7, 2, 3, 6, 8, 1]);
  assert.strictEqual(r0830.batting.find((b) => b.number === '2').HBP, 1, '觸身球記在梁佑丞');
});

test('二壘安打、盜壘記在對的人身上', () => {
  assert.strictEqual(r0830.batting.find((b) => b.number === '56')['2B'], 1);
  assert.strictEqual(r0830.batting.find((b) => b.number === '39').SB, 1);
  assert.strictEqual(r0830.batting.find((b) => b.number === '17').SB, 1);
});

test('比分 7:0，每局得分 2、5、0、0、0', () => {
  assert.deepStrictEqual(r0830.score, { us: 7, opp: 0 });
  assert.deepStrictEqual(r0830.halves.map((h) => h.runs), [2, 5, 0, 0, 0]);
});

test('補正版沒有任何 ⚠️（除了「沒記對手半局」）', () => {
  assert.deepStrictEqual(r0830.warnings.map((w) => w.msg), ['紀錄裡沒有對手的半局，投手成績無法自動算，請人工填']);
  assert.strictEqual(r0830.pitchingStatus, 'unrecorded');
});

test('文字轉播用 CPBL 簡碼：三失、二失、犧飛、二滾、游飛、二安', () => {
  const list = pas(r0830).map((p) => `${p.number}:${p.display}`);
  assert.ok(list.includes('93:三失'), list.join(' '));
  assert.ok(list.includes('91:二失'));
  assert.ok(list.includes('19:犧飛'));
  assert.ok(list.includes('91:二滾'));
  assert.ok(list.includes('49:游飛'));
  assert.ok(list.includes('56:二安'));
});

test('顯示用的描述拿掉 [N分進帳] 和打點標記，原文另外保留', () => {
  const p = pas(r0830).find((x) => x.number === '91' && x.kind === 'E');
  assert.strictEqual(p.desc, 'E4 乘誤上壘');
  assert.match(p.raw, /\[2分進帳，龍安 2:0\]/);
});

test('得分者推算正確：一局上 E4 回來的是 #17、#93', () => {
  const p = pas(r0830).find((x) => x.number === '91' && x.kind === 'E');
  assert.deepStrictEqual(p.scorers.map((s) => s.number), ['17', '93']);
  assert.strictEqual(p.rbi, 0, '失誤造成的得分不算打點');
});

test('封殺推算：二局上 #91 那一球出局的是一壘跑者 #2，回本壘的是 #93', () => {
  const p = pas(r0830).find((x) => x.number === '91' && x.kind === 'GROUND');
  assert.deepStrictEqual(p.runnersOut.map((s) => s.number), ['2']);
  assert.deepStrictEqual(p.scorers.map((s) => s.number), ['93']);
});

test('代打、代跑、守備替補都插在對的位置，代跑接在打席後面', () => {
  const h2 = r0830.halves[1].items;
  const i93 = h2.findIndex((x) => x.type === 'pa' && x.number === '93');
  assert.strictEqual(h2[i93 + 1].kind, 'PR');
  assert.strictEqual(h2[i93 + 1].text, '更換代跑：蘇巽雄=>李浩偉');
  const h3 = r0830.halves[2].items;
  assert.ok(h3.some((x) => x.kind === 'PH' && x.text === '更換代打：張容基=>蘇辰雄'));
  assert.ok(r0830.halves[3].items.some((x) => x.kind === 'defense' && x.text.startsWith('更換守備：梁佑丞=>葉展昆')));
});

test('四局上「2棒」對到代跑上場的 #5 李浩偉', () => {
  const p = r0830.halves[3].items.find((x) => x.type === 'pa' && x.slot === 2);
  assert.strictEqual(p.number, '5');
});

test('字典文件第 6 節的範例和測試資料一字不差（文件改了，測試要跟著改）', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', '文字記錄簡碼字典.md'), 'utf8');
  const sec = doc.slice(doc.indexOf('## 6. 完整範例'));
  const block = /```\n([\s\S]*?)```/.exec(sec)[1];
  assert.strictEqual(block, read('2026-08-30_G4_雨人.txt'));
});

console.log('\n原始紀錄（未補正）要抓得出問題');

const orig = E.parse(read('2026-08-30_G4_雨人_原始.txt'), {
  lineup: LINEUP_0830,
  players: [{ number: '5', name: '李浩偉', nickname: 'Haowei' }],
});

test('抓到：#55 上場沒記換人', () => {
  assert.match(msgs(orig), /#55 不在目前的打序裡/);
});

test('抓到：五局上寫 #12，但應該輪到第 6 棒', () => {
  assert.match(msgs(orig), /應該輪到第 6 棒（黃宥挺），紀錄寫的是第 7 棒（陳佳瑋）/);
});

test('代跑寫暱稱「Haowei」也對得到 #5', () => {
  assert.ok(!/Haowei/.test(msgs(orig)), msgs(orig));
  assert.ok(orig.halves[1].items.some((x) => x.kind === 'PR' && x.text.endsWith('李浩偉')));
});

console.log('\n符號與顯示');

test('各種符號 → CPBL 顯示', () => {
  const cases = {
    '1B 安打': '一安', '2B': '二安', '3B': '三安', 'HR': '全打', 'BB': '四壞', 'IBB': '故意四壞', 'HBP': '死球',
    'K': '三振', 'ꓘ 見振': '三振', 'K+PB 不死三振': '三振', '4-3': '二滾', '6-3': '游滾', '1-3': '投滾', '3U': '一滾',
    'F9': '右飛', 'F7': '左飛', 'L6': '游飛', 'P6': '游飛', 'FF2': '界飛', '6-4-3 DP': '雙殺', 'E5': '三失', 'E9': '右失',
    'FC6': '野選', 'SF7': '犧飛', 'SAC': '犧觸', '一安': '一安', '右飛': '右飛', '游滾': '游滾', '雙殺': '雙殺', '死球': '死球',
  };
  Object.entries(cases).forEach(([code, want]) => {
    const r = E.findResult(code);
    assert.ok(r, `${code} 認不出來`);
    assert.strictEqual(E.displayOf(r.kind, r.pos), want, `${code} → ${E.displayOf(r.kind, r.pos)}，應為 ${want}`);
  });
});

test('狀態解析：出局數、壘包、滿壘', () => {
  assert.deepStrictEqual(E.parseState('2 Outs, 1B/3B'), { outs: 2, bases: [1, 3] });
  assert.deepStrictEqual(E.parseState('1 Out, 滿壘'), { outs: 1, bases: [1, 2, 3] });
  assert.deepStrictEqual(E.parseState('0 Out'), { outs: 0, bases: [] });
  assert.strictEqual(E.parseState('游擊平飛'), null);
});

console.log('\n打點與得分');

test('滿壘四壞擠回 1 分 → 打點 1；一般四壞 → 0', () => {
  const r = run('一局上｜龍安攻\n#11：BB ➔ 0 Out, 1B\n#12：BB ➔ 0 Out, 1B/2B\n#13：BB ➔ 0 Out, 滿壘\n#14：BB [1分進帳] ➔ 0 Out, 滿壘\n#15：K ➔ 1 Out, 滿壘\n#16：K ➔ 2 Outs, 滿壘\n#17：K ➔ 3 Outs');
  const b = Object.fromEntries(r.batting.map((x) => [x.number, x]));
  assert.strictEqual(b['14'].RBI, 1);
  assert.strictEqual(b['13'].RBI, 0);
  assert.strictEqual(b['11'].R, 1, '三壘跑者 #11 被擠回來');
});

test('雙殺不算打點；行尾「打點0」「打點2」可以強制指定', () => {
  const r = run('一局上｜龍安攻\n#11：1B ➔ 0 Out, 1B\n#12：1B ➔ 0 Out, 1B/2B\n#13：2B [1分進帳] 打點0 ➔ 0 Out, 2B/3B\n#14：6-4-3 DP [1分進帳] ➔ 2 Outs, 2B\n#15：E6 [1分進帳] 打點1 ➔ 2 Outs, 1B\n#16：K ➔ 3 Outs');
  const b = Object.fromEntries(r.batting.map((x) => [x.number, x]));
  assert.strictEqual(b['13'].RBI, 0, '打點0 強制');
  assert.strictEqual(b['14'].RBI, 0, '雙殺');
  assert.strictEqual(b['15'].RBI, 1, '打點1 強制');
});

test('全壘打：打者自己也得分，打點＝總得分', () => {
  const r = run('一局上｜龍安攻\n#11：BB ➔ 0 Out, 1B\n#12：HR [2分進帳] ➔ 0 Out\n#13：K ➔ 1 Out\n#14：K ➔ 2 Outs\n#15：K ➔ 3 Outs');
  const b = Object.fromEntries(r.batting.map((x) => [x.number, x]));
  assert.deepStrictEqual([b['12'].H, b['12'].HR, b['12'].RBI, b['12'].R, b['11'].R], [1, 1, 2, 1, 1]);
});

test('暴投、捕逸回來的分不算打點，但跑者照樣記得分', () => {
  const r = run('一局上｜龍安攻\n#11：3B ➔ 0 Out, 3B\n#12：WP 三壘跑者回本壘 [1分進帳] ➔ BB ➔ 0 Out, 1B\n#13：K ➔ 1 Out, 1B\n#14：K ➔ 2 Outs, 1B\n#15：K ➔ 3 Outs');
  const b = Object.fromEntries(r.batting.map((x) => [x.number, x]));
  assert.strictEqual(b['12'].RBI, 0);
  assert.strictEqual(b['11'].R, 1);
});

test('暴投回來的分接安打：打點只算安打那一段', () => {
  const r = run('一局上｜龍安攻\n#11：3B ➔ 0 Out, 3B\n#12：WP 三壘跑者回本壘 [1分進帳] ➔ 1B ➔ 0 Out, 1B\n#13：K ➔ 1 Out, 1B\n#14：K ➔ 2 Outs, 1B\n#15：K ➔ 3 Outs');
  const b = Object.fromEntries(r.batting.map((x) => [x.number, x]));
  assert.deepStrictEqual([b['12'].H, b['12'].RBI, b['11'].R], [1, 0, 1]);
});

test('沒有滿壘的四壞，就算有人回本壘也不算打點', () => {
  const r = run('一局上｜龍安攻\n#11：3B ➔ 0 Out, 3B\n#12：BB ➔ 0 Out, 1B/3B\n#13：BB 三壘跑者趁傳球回本壘 [1分進帳] ➔ 0 Out, 1B/2B\n#14：K ➔ 1 Out, 1B/2B\n#15：K ➔ 2 Outs, 1B/2B\n#16：K ➔ 3 Outs');
  const b = Object.fromEntries(r.batting.map((x) => [x.number, x]));
  assert.deepStrictEqual([b['13'].RBI, b['11'].R], [0, 1]);
});

test('明確寫「（#12、#11 回本壘）」時照寫的算', () => {
  const r = run('一局上｜龍安攻\n#11：1B ➔ 0 Out, 1B\n#12：1B ➔ 0 Out, 1B/2B\n#13：2B（#12、#11 回本壘）[2分進帳] ➔ 0 Out, 2B\n#14：K ➔ 1 Out, 2B\n#15：K ➔ 2 Outs, 2B\n#16：K ➔ 3 Outs');
  const p = pas(r).find((x) => x.number === '13');
  assert.deepStrictEqual(p.scorers.map((s) => s.number).sort(), ['11', '12']);
});

test('出局的不是最靠近打者的跑者時，照描述判斷（三壘跑者本壘觸殺）', () => {
  const r = run('一局上｜龍安攻\n#11：3B ➔ 0 Out, 3B\n#12：BB ➔ 0 Out, 1B/3B\n#13：5-2 滾地球，三壘跑者本壘觸殺，打者上一壘 ➔ 1 Out, 1B/2B\n#14：K ➔ 2 Outs, 1B/2B\n#15：K ➔ 3 Outs');
  const p = pas(r).find((x) => x.number === '13');
  assert.deepStrictEqual(p.runnersOut.map((s) => s.number), ['11']);
  assert.deepStrictEqual(p.bases.map((b) => b && b.number), ['13', '12', null]);
  assert.deepStrictEqual(r.warnings.filter((w) => w.where !== '投手成績'), []);
});

console.log('\n⚠️ 偵測');

test('標題的得分和逐行加總不一致', () => {
  const r = run('一局上｜龍安攻（得分：2）\n#11：HR [1分進帳] ➔ 0 Out\n#12：K ➔ 1 Out\n#13：K ➔ 2 Outs\n#14：K ➔ 3 Outs');
  assert.match(msgs(r), /標題寫得分 2，逐行加總是 1/);
});

test('紀錄寫的比分和推算不一致', () => {
  const r = run('一局上｜龍安攻\n#11：HR [1分進帳，龍安 2:0] ➔ 0 Out\n#12：K ➔ 1 Out\n#13：K ➔ 2 Outs\n#14：K ➔ 3 Outs');
  assert.match(msgs(r), /比分：推算是 龍安 1:0，紀錄寫 2:0/);
});

test('壘上人數和紀錄寫的狀態對不上（得分或出局漏記）', () => {
  const r = run('一局上｜龍安攻\n#11：1B ➔ 0 Out, 1B\n#12：2B ➔ 0 Out, 2B\n#13：K ➔ 1 Out, 2B\n#14：K ➔ 2 Outs, 2B\n#15：K ➔ 3 Outs');
  assert.match(msgs(r), /推算壘上應該有 2 人，紀錄寫 1 人/);
});

test('出局數和結果對不上', () => {
  const r = run('一局上｜龍安攻\n#11：K ➔ 2 Outs\n#12：K ➔ 3 Outs');
  assert.match(msgs(r), /依結果推算是 1 出局，紀錄寫 2 出局/);
});

test('看不懂的行、沒有結果符號的行都會列出來，不會默默略過', () => {
  const r = run('一局上｜龍安攻\n今天天氣很好\n#11：打得很好 ➔ 0 Out, 1B\n#12：K ➔ 1 Out\n#13：K ➔ 2 Outs\n#14：K ➔ 3 Outs');
  assert.match(msgs(r), /看不懂這一行/);
  assert.match(msgs(r), /找不到打席結果符號/);
});

test('半局沒打滿 3 出局（不是最後一個半局）', () => {
  const r = run('一局上｜龍安攻\n#11：K ➔ 1 Out\n\n一局下｜雨人攻\n1棒：K\n2棒：K\n3棒：K');
  assert.ok(r.warnings.some((w) => w.where === '一局上' && /只記到 1 個出局/.test(w.msg)));
});

test('打序跳號', () => {
  const r = run('一局上｜龍安攻\n#11：K ➔ 1 Out\n#13：K ➔ 2 Outs\n#14：K ➔ 3 Outs');
  assert.match(msgs(r), /應該輪到第 2 棒/);
});

test('陣容調度紀錄沒有的代打', () => {
  const r = run('一局上｜龍安攻\n#99（代打）：K ➔ 1 Out\n#12：K ➔ 2 Outs\n#13：K ➔ 3 Outs');
  assert.match(msgs(r), /第 1 棒沒有 #99/);
});

console.log('\n投手成績（對手半局）');

test('局數、被安打、四壞、觸身、三振、失分、暴投；換投後算到新投手', () => {
  const r = run([
    '一局下｜雨人攻',
    '1棒：1B', '2棒：BB', '3棒：HBP', '4棒：K', '5棒：2B [2分進帳]', '6棒：F8', '7棒：ꓘ',
    '二局下｜雨人攻',
    '更換投手 #56',
    '8棒：HR [1分進帳]', '9棒：K+WP 不死三振', '1棒：6-3', '2棒：4-3', '3棒：F9',
  ].join('\n'), { players: [{ number: '56', name: '蘇垣華' }] });
  const p1 = r.pitching.find((p) => p.number === '1');
  const p56 = r.pitching.find((p) => p.number === '56');
  assert.deepStrictEqual([p1.IP, p1.H, p1.BB, p1.HBP, p1.SO, p1.R], ['1.0', 2, 1, 1, 2, 2]);
  assert.deepStrictEqual([p56.IP, p56.H, p56.HR, p56.SO, p56.R, p56.WP], ['1.0', 1, 1, 1, 1, 1]);
  assert.strictEqual(r.pitchingStatus, 'complete');
  assert.ok(r.halves[1].items.some((x) => x.kind === 'pitcher' && x.text === '更換投手：蘇垣華'));
});

test('有一局寫「未記錄」→ 投手成績標為部分', () => {
  const r = run('一局下｜雨人攻\n1棒：K\n2棒：K\n3棒：K\n\n二局下｜雨人攻\n未記錄');
  assert.strictEqual(r.pitchingStatus, 'partial');
  assert.strictEqual(r.pitching.find((p) => p.number === '1').unrecordedHalves, 1);
  assert.ok(!r.warnings.some((w) => w.where === '二局下'), '未記錄的半局不用警告出局數');
});

console.log(`\n共 ${passed} 項通過`);
