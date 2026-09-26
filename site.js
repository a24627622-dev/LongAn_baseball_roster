/* 龍安棒球隊 對外官網共用工具（階段 C）
   三頁共用：日期計算、資料讀取、活動與公告的渲染。
   球隊慣例：活動固定在週日。有比賽就不練球，沒比賽就練球 08:00~12:00。 */

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function pad2(n) { return String(n).padStart(2, '0'); }

function toISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/* 瀏覽器當下的本地日期 YYYY-MM-DD */
function todayStr() { return toISO(new Date()); }

function parseISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/* '2026-10-25' -> '10/25（日）' */
function fmtDate(iso) {
  const d = parseISO(iso);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

/* '2026-10-25' -> '2026年10月25日（日）' */
function fmtDateLong(iso) {
  const d = parseISO(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
}

/* 距離今天幾天：0 = 今天、1 = 明天、負數 = 已過 */
function daysFromToday(iso) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((parseISO(iso) - today) / 86400000);
}

function countdownText(iso) {
  const n = daysFromToday(iso);
  if (n === 0) return '就是今天';
  if (n === 1) return '明天';
  if (n > 0) return `還有 ${n} 天`;
  return '';
}

/* 本週的最後一天（週日）。台灣習慣週一為週首、週日為週末。 */
function endOfThisWeek() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = today.getDay();                    // 0 = 週日
  const toSunday = dow === 0 ? 0 : 7 - dow;
  const sunday = new Date(today);
  sunday.setDate(today.getDate() + toSunday);
  return toISO(sunday);
}

/* 這個日期是否落在本週（今天 ~ 本週日） */
function isThisWeek(iso) {
  return iso >= todayStr() && iso <= endOfThisWeek();
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* body 的 \n 換行轉成段落 */
function bodyToParagraphs(body) {
  return String(body || '')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} 讀取失敗（HTTP ${res.status}）`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    // 格式壞掉跟網路問題分開標記：網路問題會自己好，格式壞掉不會
    const err = new Error(`${path} 不是合法的 JSON：${e.message}`);
    err.formatError = true;
    throw err;
  }
}

/* 讀資料檔並用 data-check.js 的規則檢查（頁面要先載入 data-check.js）。
   - 整個檔案不能用 → throw，頁面顯示「暫時讀不到」
   - 單筆壞掉 → 略過那一筆、回報 badCount，頁面加一行提示。
     絕不默默丟掉（2026-09-21 最近一筆活動就是這樣消失的）
   詳細原因一律寫在 Console（F12），對外畫面不放技術細節。 */
async function loadChecked(path, kind) {
  const data = await loadJSON(path);
  const r = kind === 'schedule' ? DataCheck.checkSchedule(data) : DataCheck.checkAnnouncements(data);
  if (r.fatal) {
    const err = new Error(`${path}：${r.fatal}`);
    err.formatError = true;
    throw err;
  }
  r.errors.forEach((e) => console.error(`${path} ${e.where}：${e.msg}`));
  r.warnings.forEach((w) => console.warn(`${path} ${w.where}：${w.msg}`));
  return { items: r.valid, badCount: r.badCount };
}

/* 編輯器（tools/）讀檔的結果說明：檔案壞掉時，從空白或殘缺的清單產生內容，
   貼回 GitHub 會把資料蓋掉，所以要用紅字擋在前面。
   回傳 { html, broken }；html 為空字串代表一切正常。 */
function editorLoadWarning(err, badCount, missingText) {
  const fix = '請先修好檔案，或請 Claude 修。';
  if (err && err.formatError) {
    return { broken: true, html: `<div class="load-warn">⛔ 目前線上的檔案格式壞了。從空白開始產生的內容，貼上後會覆蓋掉全部資料；${fix}</div>` };
  }
  if (err) return { broken: false, html: `<div class="hint">${missingText}</div>` };
  if (badCount > 0) {
    return { broken: true, html: `<div class="load-warn">⛔ 目前線上的檔案有 ${badCount} 筆格式壞了，這裡看不到它們。產生的內容貼上後，那 ${badCount} 筆會被刪掉；${fix}</div>` };
  }
  return { broken: false, html: '' };
}

/* 部分資料被略過時的提示（對外用語，不放技術細節） */
function partialNoteHTML(badCount) {
  return badCount > 0 ? '<div class="partial-note">部分資料暫時讀不到，請稍後再試。</div>' : '';
}

/* ---------- 活動 ---------- */

function isGame(item) { return item.type === 'game'; }

function activityName(item) {
  return isGame(item) ? `龍安 vs ${item.opponent || '未定'}` : '練球';
}

/* 地點：未填時給明確的提示，不要留白 */
function venueText(item) {
  return item.venue && item.venue.trim() !== '' ? item.venue : '地點未定，請留意公告';
}

function hasVenue(item) {
  return !!(item.venue && item.venue.trim() !== '');
}

/* 時間列：比賽有集合／開賽，練球只有開始／結束 */
function timeRows(item) {
  const rows = [];
  if (isGame(item)) {
    if (item.gatherTime) rows.push(['集合時間', item.gatherTime]);
    if (item.startTime) rows.push(['開賽時間', item.startTime]);
  } else {
    if (item.startTime && item.endTime) rows.push(['時間', `${item.startTime} ~ ${item.endTime}`]);
    else if (item.startTime) rows.push(['時間', item.startTime]);
  }
  rows.push(['地點', venueText(item)]);
  return rows;
}

function byDate(a, b) { return String(a.date).localeCompare(String(b.date)); }

/* 未取消、且日期尚未過的活動，依日期排序 */
function upcoming(schedule, type) {
  const today = todayStr();
  return schedule
    .filter((it) => !it.cancelled)
    .filter((it) => (type ? it.type === type : true))
    .filter((it) => it.date >= today)
    .sort(byDate);
}

function nextActivity(schedule) { return upcoming(schedule)[0] || null; }
function nextGame(schedule) { return upcoming(schedule, 'game')[0] || null; }

/* ---------- 公告 ---------- */

/* 置頂在前，其餘依日期新到舊 */
function sortAnnouncements(list) {
  return [...list].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    return String(b.date).localeCompare(String(a.date));
  });
}

function announcementHTML(item) {
  const tag = item.pinned ? '<span class="pin-tag">置頂</span>' : '';
  return `
    <article class="news-item${item.pinned ? ' pinned' : ''}">
      <div class="news-meta">${tag}<time datetime="${escapeHtml(item.date)}">${fmtDateLong(item.date)}</time></div>
      <h3>${escapeHtml(item.title)}</h3>
      ${bodyToParagraphs(item.body)}
    </article>`;
}
