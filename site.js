/* 龍安棒球隊 對外官網共用工具（階段 C）
   三頁共用：日期格式、資料讀取、公告渲染。 */

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/* 瀏覽器當下的本地日期，格式 YYYY-MM-DD */
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* '2026-10-25' -> '10/25（日）' */
function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const w = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}（${w}）`;
}

/* '2026-10-25' -> '2026年10月25日（日）' */
function fmtDateLong(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const w = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日（${w}）`;
}

/* 距離今天幾天：0 = 今天、1 = 明天、負數 = 已過 */
function daysFromToday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

function countdownText(iso) {
  const n = daysFromToday(iso);
  if (n === 0) return '就是今天';
  if (n === 1) return '明天';
  if (n > 0) return `還有 ${n} 天`;
  return '';
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

/* 公告排序：pinned 在前，其餘依日期新到舊 */
function sortAnnouncements(list) {
  return [...list].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    return String(b.date).localeCompare(String(a.date));
  });
}

function announcementHTML(item) {
  const pinned = item.pinned ? ' pinned' : '';
  const tag = item.pinned ? '<span class="pin-tag">置頂</span>' : '';
  return `
    <article class="news-item${pinned}">
      <div class="news-meta">${tag}<time datetime="${escapeHtml(item.date)}">${fmtDateLong(item.date)}</time></div>
      <h3>${escapeHtml(item.title)}</h3>
      ${bodyToParagraphs(item.body)}
    </article>`;
}

/* 從 schedule.json 挑出「下一場」：第一個日期 >= 今天的項目 */
function pickNext(schedule, type) {
  const today = todayStr();
  return schedule
    .filter((it) => (type ? it.type === type : true))
    .filter((it) => it.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}
