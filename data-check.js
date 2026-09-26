/* 龍安棒球隊 資料檔檢查規則（data/schedule.json、data/announcements.json）
   對外頁面（瀏覽器）與 tests/check_data.js（Node）共用這一份，規則只寫一次。

   分級：
   - fatal   ：整個檔案不能用（最外層不是陣列）
   - errors  ：會讓頁面壞掉或資料消失。單筆的錯誤會讓那一筆被略過（badCount）；
               「同一天兩筆」這種跨筆的錯誤不略過任何一筆，只回報
   - warnings：頁面照常，但可能是手誤（非週日、沒排序、欄位名打錯…）

   2026-09-21 的兩次事故：開頭多一個 [ → JSON 解析失敗；
   補逗號後舊陣列巢狀在裡面 → 那筆沒有 date，被頁面默默丟掉。後者就是 badCount 要抓的。 */
(function (root) {
  const SCHEDULE_TYPES = ['game', 'practice'];
  const SCHEDULE_FIELDS = {
    game: ['type', 'date', 'gatherTime', 'startTime', 'venue', 'opponent', 'score', 'resultUrl', 'cancelled', 'note'],
    practice: ['type', 'date', 'startTime', 'endTime', 'venue', 'cancelled', 'note'],
  };
  const ANNOUNCEMENT_FIELDS = ['date', 'title', 'body', 'pinned'];

  const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const describe = (x) => (Array.isArray(x) ? '陣列' : x === null ? 'null' : typeof x);

  /* YYYY-MM-DD，而且是真的存在的日期（擋掉 2026-02-30） */
  function isValidDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  function isSunday(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
  }
  const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

  function newResult() {
    return { fatal: null, errors: [], warnings: [], valid: [], badCount: 0 };
  }
  const where = (i, item) => `第 ${i + 1} 筆` + (isObject(item) && typeof item.date === 'string' ? `（${item.date}）` : '');

  function checkSchedule(data) {
    const r = newResult();
    if (!Array.isArray(data)) {
      r.fatal = `最外層應該是陣列 [ ]，實際是${describe(data)}`;
      return r;
    }

    data.forEach((item, i) => {
      const w = where(i, item);
      const errs = [];
      if (!isObject(item)) {
        errs.push(`應該是一筆 { } 物件，實際是${describe(item)}（常見原因：貼上時舊內容沒刪乾淨，整份陣列巢狀在裡面）`);
      } else {
        if (!('date' in item)) errs.push('缺少 date');
        else if (!isValidDate(item.date)) errs.push(`date 格式錯誤：${JSON.stringify(item.date)}（應為 YYYY-MM-DD）`);
        if (!('type' in item)) errs.push('缺少 type');
        else if (!SCHEDULE_TYPES.includes(item.type)) errs.push(`type 只能是 game 或 practice，實際是 ${JSON.stringify(item.type)}`);
      }
      if (errs.length) {
        errs.forEach((msg) => r.errors.push({ where: w, msg }));
        r.badCount++;
        return;
      }
      r.valid.push(item);

      // ---- 以下是警告 ----
      if (!isSunday(item.date)) r.warnings.push({ where: w, msg: '不是週日（補賽、友誼賽可以忽略）' });
      const allowed = SCHEDULE_FIELDS[item.type];
      Object.keys(item).filter((k) => !allowed.includes(k)).forEach((k) => {
        r.warnings.push({ where: w, msg: `不認得的欄位「${k}」（${item.type} 可用的欄位：${allowed.join('、')}），是不是打錯字？` });
      });
      ['gatherTime', 'startTime', 'endTime'].forEach((k) => {
        if (k in item && item[k] !== '' && !isTime(item[k])) {
          r.warnings.push({ where: w, msg: `${k} 時間格式怪怪的：${JSON.stringify(item[k])}（應為 HH:MM，例如 08:00）` });
        }
      });
      if ('score' in item && item.score !== null) {
        const s = item.score;
        const ok = isObject(s) && Number.isInteger(s.longan) && Number.isInteger(s.opponent) && s.longan >= 0 && s.opponent >= 0;
        if (!ok) r.warnings.push({ where: w, msg: `score 格式不對：${JSON.stringify(s)}（應為 null 或 { "longan": 7, "opponent": 3 }）` });
      }
      if ('cancelled' in item && typeof item.cancelled !== 'boolean') {
        r.warnings.push({ where: w, msg: `cancelled 應該是 true 或 false，實際是 ${JSON.stringify(item.cancelled)}` });
      }
    });

    // ---- 跨筆檢查（只看格式正確的那些）----
    const seen = {};
    r.valid.forEach((item) => {
      const i = data.indexOf(item);
      if (item.date in seen) {
        r.errors.push({ where: where(i, item), msg: `和第 ${seen[item.date] + 1} 筆同一天（改期請把原本那筆標 cancelled，新日期另外一筆）` });
      } else {
        seen[item.date] = i;
      }
    });
    for (let k = 1; k < r.valid.length; k++) {
      if (r.valid[k].date < r.valid[k - 1].date) {
        const i = data.indexOf(r.valid[k]);
        r.warnings.push({ where: where(i, r.valid[k]), msg: `沒有依日期排序（排在 ${r.valid[k - 1].date} 後面）。網站會自己排好，不影響顯示` });
      }
    }
    return r;
  }

  function checkAnnouncements(data) {
    const r = newResult();
    if (!Array.isArray(data)) {
      r.fatal = `最外層應該是陣列 [ ]，實際是${describe(data)}`;
      return r;
    }
    data.forEach((item, i) => {
      const w = where(i, item);
      const errs = [];
      if (!isObject(item)) {
        errs.push(`應該是一則 { } 物件，實際是${describe(item)}（常見原因：貼上時舊內容沒刪乾淨，整份陣列巢狀在裡面）`);
      } else {
        if (!('date' in item)) errs.push('缺少 date');
        else if (!isValidDate(item.date)) errs.push(`date 格式錯誤：${JSON.stringify(item.date)}（應為 YYYY-MM-DD）`);
        if (typeof item.title !== 'string' || item.title.trim() === '') errs.push('缺少 title（標題）');
      }
      if (errs.length) {
        errs.forEach((msg) => r.errors.push({ where: w, msg }));
        r.badCount++;
        return;
      }
      r.valid.push(item);

      Object.keys(item).filter((k) => !ANNOUNCEMENT_FIELDS.includes(k)).forEach((k) => {
        r.warnings.push({ where: w, msg: `不認得的欄位「${k}」（可用的欄位：${ANNOUNCEMENT_FIELDS.join('、')}），是不是打錯字？` });
      });
      if ('body' in item && typeof item.body !== 'string') {
        r.warnings.push({ where: w, msg: `body 應該是文字，實際是${describe(item.body)}` });
      }
      if ('pinned' in item && typeof item.pinned !== 'boolean') {
        r.warnings.push({ where: w, msg: `pinned 應該是 true 或 false，實際是 ${JSON.stringify(item.pinned)}` });
      }
    });
    return r;
  }

  const api = { checkSchedule, checkAnnouncements, isValidDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DataCheck = api;
})(this);
