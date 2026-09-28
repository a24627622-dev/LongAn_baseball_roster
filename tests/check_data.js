// 資料檔檢查：data/schedule.json、data/announcements.json、data/players.json、data/games/*.json
// 規則在根目錄的 data-check.js（對外頁面也用同一份）。
//
// 用法：
//   node tests/check_data.js                     檢查 repo 裡的資料檔（含每一場比賽）
//   node tests/check_data.js --schedule 路徑     指定要檢查的檔案（測試用）
//   node tests/check_data.js --announcements 路徑
//   node tests/check_data.js --players 路徑
//
// 有「錯誤」就以 exit code 1 結束（GitHub 自動檢查會變紅、寄 email）；
// 只有「警告」不會失敗。
const fs = require('fs');
const path = require('path');
const { checkSchedule, checkAnnouncements, checkPlayers, checkGame } = require('../data-check');

const ROOT = path.resolve(__dirname, '..');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};

const FILES = [
  { label: 'data/schedule.json', file: arg('--schedule') || path.join(ROOT, 'data/schedule.json'), check: checkSchedule },
  { label: 'data/announcements.json', file: arg('--announcements') || path.join(ROOT, 'data/announcements.json'), check: checkAnnouncements },
  { label: 'data/players.json', file: arg('--players') || path.join(ROOT, 'data/players.json'), check: checkPlayers },
];
// 每一場比賽的文字轉播資料；檔名（去掉 .json）必須等於裡面的 id，公開頁靠檔名找檔案
const GAMES_DIR = arg('--games') || path.join(ROOT, 'data/games');
if (fs.existsSync(GAMES_DIR)) {
  fs.readdirSync(GAMES_DIR).filter((f) => f.endsWith('.json')).sort().forEach((f) => {
    FILES.push({ label: `data/games/${f}`, file: path.join(GAMES_DIR, f), check: checkGame, expectId: f.slice(0, -5) });
  });
}

// JSON.parse 的錯誤只給字元位置，換算成第幾行，方便在 GitHub 編輯框找
function parseWithLine(text) {
  try {
    return { data: JSON.parse(text) };
  } catch (e) {
    const m = /position (\d+)/.exec(e.message);
    let loc = '';
    if (m) {
      const pos = Number(m[1]);
      const line = text.slice(0, pos).split('\n').length;
      loc = `（大約在第 ${line} 行）`;
    }
    return { error: `不是合法的 JSON${loc}：${e.message}。常見原因：少逗號、多逗號、括號沒成對、開頭多一個 [` };
  }
}

let errorCount = 0;
let warnCount = 0;

for (const { label, file, check, expectId } of FILES) {
  console.log(`\n▶ ${label}`);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.log(`  ❌ 讀不到檔案：${e.message}`);
    errorCount++;
    continue;
  }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const parsed = parseWithLine(text);
  if (parsed.error) {
    console.log(`  ❌ ${parsed.error}`);
    errorCount++;
    continue;
  }

  const r = check(parsed.data);
  if (expectId && !r.fatal && parsed.data.id !== expectId) {
    r.errors.push({ where: '檔名', msg: `檔名是 ${expectId}.json，但裡面的 id 是 ${JSON.stringify(parsed.data.id)}（公開頁用檔名找檔案，兩者要一樣）` });
  }
  if (r.fatal) {
    console.log(`  ❌ ${r.fatal}`);
    errorCount++;
    continue;
  }
  r.errors.forEach((e) => console.log(`  ❌ ${e.where}：${e.msg}`));
  r.warnings.forEach((w) => console.log(`  ⚠️  ${w.where}：${w.msg}`));
  errorCount += r.errors.length;
  warnCount += r.warnings.length;
  const count = expectId ? '格式' : `${r.valid.length} 筆，`;
  if (!r.errors.length && !r.warnings.length) console.log(`  ✅ ${count}全部正確`);
  else if (!r.errors.length) console.log(`  ✅ ${count}沒有錯誤（有警告，網站照常顯示）`);
}

console.log('');
if (errorCount) {
  console.log(`❌ ${errorCount} 個錯誤、${warnCount} 個警告。有錯誤的資料不會顯示在網站上，請修正。`);
  process.exitCode = 1;
} else {
  console.log(`✅ 沒有錯誤${warnCount ? `（${warnCount} 個警告）` : ''}`);
}
