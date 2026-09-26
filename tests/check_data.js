// 資料檔檢查：data/schedule.json、data/announcements.json
// 規則在根目錄的 data-check.js（對外頁面也用同一份）。
//
// 用法：
//   node tests/check_data.js                     檢查 repo 裡的兩個檔案
//   node tests/check_data.js --schedule 路徑     指定要檢查的檔案（測試用）
//   node tests/check_data.js --announcements 路徑
//
// 有「錯誤」就以 exit code 1 結束（GitHub 自動檢查會變紅、寄 email）；
// 只有「警告」不會失敗。
const fs = require('fs');
const path = require('path');
const { checkSchedule, checkAnnouncements } = require('../data-check');

const ROOT = path.resolve(__dirname, '..');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};

const FILES = [
  { label: 'data/schedule.json', file: arg('--schedule') || path.join(ROOT, 'data/schedule.json'), check: checkSchedule },
  { label: 'data/announcements.json', file: arg('--announcements') || path.join(ROOT, 'data/announcements.json'), check: checkAnnouncements },
];

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

for (const { label, file, check } of FILES) {
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
  if (r.fatal) {
    console.log(`  ❌ ${r.fatal}`);
    errorCount++;
    continue;
  }
  r.errors.forEach((e) => console.log(`  ❌ ${e.where}：${e.msg}`));
  r.warnings.forEach((w) => console.log(`  ⚠️  ${w.where}：${w.msg}`));
  errorCount += r.errors.length;
  warnCount += r.warnings.length;
  if (!r.errors.length && !r.warnings.length) console.log(`  ✅ ${r.valid.length} 筆，全部正確`);
  else if (!r.errors.length) console.log(`  ✅ ${r.valid.length} 筆，沒有錯誤（有警告，網站照常顯示）`);
}

console.log('');
if (errorCount) {
  console.log(`❌ ${errorCount} 個錯誤、${warnCount} 個警告。有錯誤的資料不會顯示在網站上，請修正。`);
  process.exitCode = 1;
} else {
  console.log(`✅ 沒有錯誤${warnCount ? `（${warnCount} 個警告）` : ''}`);
}
