// 舊網址轉址（根目錄 moved.js，V01.14.01）的測試
// GitHub Pages 的舊網址（a24627622-dev.github.io/LongAn_baseball_roster/…）→ Cloudflare Pages 新網址的同一頁
const assert = require('assert');
const { movedUrl, NEW_SITE } = require('../moved');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✅ ' + name); }
  catch (e) { console.log('  ❌ ' + name + '\n     ' + e.message); process.exitCode = 1; }
};
const OLD = 'https://a24627622-dev.github.io/LongAn_baseball_roster';

console.log('舊網址轉址 moved.js');

test('新網址是 https://longan-baseball.pages.dev', () => {
  assert.strictEqual(NEW_SITE, 'https://longan-baseball.pages.dev');
});

test('舊網址的首頁、子頁、球隊管理 → 新網址的同一頁', () => {
  assert.strictEqual(movedUrl(OLD + '/'), 'https://longan-baseball.pages.dev/');
  assert.strictEqual(movedUrl(OLD), 'https://longan-baseball.pages.dev/');
  assert.strictEqual(movedUrl(OLD + '/schedule.html'), 'https://longan-baseball.pages.dev/schedule.html');
  assert.strictEqual(movedUrl(OLD + '/tools/'), 'https://longan-baseball.pages.dev/tools/');
  assert.strictEqual(movedUrl(OLD + '/tools/lineup.html'), 'https://longan-baseball.pages.dev/tools/lineup.html');
});

test('網址參數和 # 都保留（賽事成績頁的中文比賽 ID、戰績頁的賽季、時程編輯器的日期）', () => {
  assert.strictEqual(movedUrl(OLD + '/game.html?id=2026-08-30_G4_%E9%9B%A8%E4%BA%BA'), 'https://longan-baseball.pages.dev/game.html?id=2026-08-30_G4_%E9%9B%A8%E4%BA%BA');
  assert.strictEqual(movedUrl(OLD + '/standings.html?s=2026%20%E5%A4%A7%E6%BC%A2%E8%81%AF%E7%9B%9F#x'), 'https://longan-baseball.pages.dev/standings.html?s=2026%20%E5%A4%A7%E6%BC%A2%E8%81%AF%E7%9B%9F#x');
});

test('新網址、本機開發、預覽網址、其他網站 → 不轉（回 null）', () => {
  ['https://longan-baseball.pages.dev/', 'https://abc123.longan-baseball.pages.dev/tools/', 'http://localhost:8080/index.html',
    'http://192.168.1.5:8080/', 'https://a24627622-dev.github.io/other-repo/', 'https://example.com/LongAn_baseball_roster/']
    .forEach((u) => assert.strictEqual(movedUrl(u), null, u));
});

test('壞掉的網址 → 不轉、不出錯', () => {
  [null, undefined, '', 'not a url'].forEach((u) => assert.strictEqual(movedUrl(u), null, String(u)));
});

console.log(`\n共 ${passed} 項通過`);
