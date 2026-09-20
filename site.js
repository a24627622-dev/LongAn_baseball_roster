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
  return res.json();
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
