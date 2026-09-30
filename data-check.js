/* 龍安棒球隊 資料檔檢查規則（data/schedule.json、data/announcements.json、data/players.json、data/games/*.json）
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
  const ANNOUNCEMENT_FIELDS = ['date', 'title', 'body', 'pinned', 'link'];
  /* 公告的 link 只能連到這幾個站內頁（不連外部、不連 tools/ 工具頁） */
  const ANNOUNCEMENT_PAGES = ['schedule.html', 'news.html', 'index.html'];
  const PLAYER_FIELDS = ['number', 'name', 'nickname', 'photo'];

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
  /* 公告的連結：合法時回傳 { href, kind: 'game'（賽事成績）| 'page'（其他站內頁）}，
     沒填或不合法回傳 null（頁面就不顯示按鈕）。比賽連結的規則和時程的 resultUrl 一樣 */
  function announcementLink(link) {
    if (typeof link !== 'string') return null;
    if (/^game\.html\?id=[^&#\s]+$/.test(link)) return { href: link, kind: 'game' };
    if (ANNOUNCEMENT_PAGES.includes(link)) return { href: link, kind: 'page' };
    return null;
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
      if ('resultUrl' in item && item.resultUrl !== null && !(typeof item.resultUrl === 'string' && /^game\.html\?id=[^&#\s]+$/.test(item.resultUrl))) {
        r.warnings.push({ where: w, msg: `resultUrl 應為 null 或 "game.html?id=比賽ID"，實際是 ${JSON.stringify(item.resultUrl)}（時程頁不會顯示連結）` });
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
      if ('link' in item && item.link !== null && !announcementLink(item.link)) {
        r.warnings.push({ where: w, msg: `link 應為 null、"game.html?id=比賽ID" 或 ${ANNOUNCEMENT_PAGES.join('、')}，實際是 ${JSON.stringify(item.link)}（公告不會顯示連結按鈕）` });
      }
    });
    return r;
  }

  /* 球員名單：文字紀錄用「背號」找人，所以背號必填而且不能重複 */
  function checkPlayers(data) {
    const r = newResult();
    if (!Array.isArray(data)) {
      r.fatal = `最外層應該是陣列 [ ]，實際是${describe(data)}`;
      return r;
    }
    const whereP = (i, item) => `第 ${i + 1} 位` + (isObject(item) && item.number !== undefined ? `（#${item.number}）` : '');
    data.forEach((item, i) => {
      const w = whereP(i, item);
      const errs = [];
      if (!isObject(item)) {
        errs.push(`應該是一位 { } 球員，實際是${describe(item)}`);
      } else {
        if (typeof item.number !== 'string' || !/^\d{1,3}$/.test(item.number)) errs.push(`number（背號）應為 1～3 位數字的文字，例如 "56"，實際是 ${JSON.stringify(item.number)}`);
        if (typeof item.name !== 'string' || item.name.trim() === '') errs.push('缺少 name（姓名）');
      }
      if (errs.length) {
        errs.forEach((msg) => r.errors.push({ where: w, msg }));
        r.badCount++;
        return;
      }
      r.valid.push(item);
      Object.keys(item).filter((k) => !PLAYER_FIELDS.includes(k)).forEach((k) => {
        r.warnings.push({ where: w, msg: `不認得的欄位「${k}」（可用的欄位：${PLAYER_FIELDS.join('、')}），是不是打錯字？` });
      });
      if ('nickname' in item && typeof item.nickname !== 'string') {
        r.warnings.push({ where: w, msg: `nickname（暱稱）應該是文字，實際是${describe(item.nickname)}` });
      }
      if ('photo' in item && item.photo !== null && !(typeof item.photo === 'string' && /^images\/players\/[\w-]+\.(jpg|jpeg|png|webp)$/.test(item.photo))) {
        r.warnings.push({ where: w, msg: `photo 應為 null 或 "images/players/背號.jpg"，實際是 ${JSON.stringify(item.photo)}` });
      }
    });
    const seen = {};
    r.valid.forEach((item) => {
      const i = data.indexOf(item);
      if (item.number in seen) {
        r.errors.push({ where: whereP(i, item), msg: `背號和第 ${seen[item.number] + 1} 位重複（文字紀錄用背號找人，不能重複）` });
      } else {
        seen[item.number] = i;
      }
    });
    return r;
  }

  /* 一場比賽的文字轉播資料（tools/record-converter.html 產生）。
     不是陣列而是一個物件；這裡只檢查「公開頁能不能畫得出來」，內容的正確性在轉換時已經用 ⚠️ 檢查過 */
  function checkGame(data) {
    const r = newResult();
    if (!isObject(data)) {
      r.fatal = `最外層應該是一個 { } 物件，實際是${describe(data)}`;
      return r;
    }
    const e = (msg) => r.errors.push({ where: '比賽資料', msg });
    if (typeof data.id !== 'string' || !/^\d{4}-\d{2}-\d{2}_G\d+_.+/.test(data.id)) e(`id 應為「日期_場次_對手」，例如 "2026-10-25_G1_ZERO"，實際是 ${JSON.stringify(data.id)}`);
    if (!isValidDate(data.date)) e(`date 格式錯誤：${JSON.stringify(data.date)}`);
    if (!isObject(data.score) || !Number.isInteger(data.score.us) || !Number.isInteger(data.score.opp)) e('score 應為 { "us": 數字, "opp": 數字 }');
    if (!Array.isArray(data.halves)) e('缺少 halves（各半局的文字轉播）');
    else data.halves.forEach((h, i) => {
      if (!isObject(h) || !Number.isInteger(h.inning) || !['us', 'opp'].includes(h.offense) || !Array.isArray(h.items)) {
        e(`第 ${i + 1} 個半局格式不對（需要 inning、offense、items）`);
      }
    });
    if (!Array.isArray(data.batting)) e('缺少 batting（打者成績）');
    if (!Array.isArray(data.pitching)) e('缺少 pitching（投手成績）');
    return r;
  }

  /* 比賽資料裡的我方球員（打者、壘上跑者、得分者、投手）要對得上 data/players.json。
     頭像是用背號找的：背號不在名單上會找不到照片，背號是別人的則會放錯人。
     名單是空的就不檢查。同一個「背號＋姓名」只回報一次。 */
  function checkGameRoster(game, players) {
    const r = newResult();
    if (!isObject(game) || !Array.isArray(players) || players.length === 0) return r;
    const byNum = {};
    players.forEach((p) => { if (isObject(p) && typeof p.number === 'string') byNum[p.number] = p; });
    const seen = new Set();
    const see = (person, where) => {
      if (!isObject(person) || person.number === null || person.number === undefined || person.number === '') return;
      const num = String(person.number);
      const name = String(person.name || '');
      const key = num + '|' + name;
      if (seen.has(key)) return;
      seen.add(key);
      const p = byNum[num];
      if (!p) r.errors.push({ where, msg: `#${num} ${name}：球員名單上沒有 #${num}，頭像會找不到（背號是不是打錯了？）` });
      else if (name && p.name !== name) r.errors.push({ where, msg: `#${num} ${name}：球員名單的 #${num} 是 ${p.name}，頭像會放成別人` });
    };
    (Array.isArray(game.batting) ? game.batting : []).forEach((b) => see(b, '打者成績'));
    (Array.isArray(game.pitching) ? game.pitching : []).forEach((p) => see(p, '投手成績'));
    (Array.isArray(game.halves) ? game.halves : []).forEach((h) => {
      if (!isObject(h) || h.offense !== 'us' || !Array.isArray(h.items)) return;
      const where = `${h.inning}局${h.top ? '上' : '下'}`;
      h.items.forEach((it) => {
        if (!isObject(it)) return;
        see(it, where);
        (Array.isArray(it.bases) ? it.bases : []).forEach((b) => see(b, where));
        (Array.isArray(it.scorers) ? it.scorers : []).forEach((s) => see(s, where));
      });
    });
    return r;
  }

  const api = { checkSchedule, checkAnnouncements, checkPlayers, checkGame, checkGameRoster, isValidDate, announcementLink };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DataCheck = api;
})(this);
