/* 龍安棒球隊 一鍵發布的計算核心（V01.15.00）
   賽事成績發布（tools/record-converter.html）、GAS（貼成 PublishCore.gs，GitHub.gs 呼叫）與 Node 測試（tests/test_publish.js）共用這一份。
   只做計算，不連網：
   - applyPublish(schedule, game, opts)：時程裡「同一天、同對手、沒取消」的那一場填比分、成績連結、賽事
   - draftAnnouncement／addAnnouncement／hasAnnouncement：戰報公告草稿，同一場不重複發
   - applyUnpublish(schedule, announcements, gameId)：撤回，時程那場的比分、連結清空（賽事保留），刪連到這場的公告
   - buildPublish／buildUnpublish：要寫進 GitHub 的檔案（content: null ＝ 刪除）與修改說明 */
(function (root) {
  const LINK_PREFIX = 'game.html?id=';
  const linkOf = (id) => LINK_PREFIX + encodeURIComponent(id);
  const toJson = (x) => JSON.stringify(x, null, 2) + '\n';
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const gamePath = (id) => `data/games/${id}.json`;

  /* 比賽 ID「日期_場次_對手」：對手不能有路徑或試算表分頁名稱不能用的字元，也不能有「..」 */
  function validId(id) {
    if (typeof id !== 'string') return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})_G\d+_(.+)$/.exec(id);
    if (!m) return false;
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const opp = m[4];
    return !!opp.trim() && !/[\/\\?*\[\]:#%]/.test(opp) && opp.indexOf('..') === -1;
  }

  function applyPublish(schedule, game, opts) {
    opts = opts || {};
    if (!Array.isArray(schedule)) return { ok: false, error: '時程檔（schedule.json）格式不對，請先修好再發布' };
    if (!game || !validId(game.id)) return { ok: false, error: `比賽 ID 不合格式：${JSON.stringify(game && game.id)}` };
    const link = linkOf(game.id);
    const opp = String(game.opponent || '').trim();
    const hits = [];
    schedule.forEach((x, i) => {
      if (x && x.type === 'game' && !x.cancelled && x.date === game.date && String(x.opponent || '').trim() === opp) hits.push(i);
    });
    if (!hits.length) return { ok: false, error: `時程裡沒有這場（${game.date} vs ${opp}），請先用時程編輯器新增這場比賽` };
    if (hits.length > 1) return { ok: false, error: `時程裡 ${game.date} vs ${opp} 有 ${hits.length} 場，請先在時程編輯器確認（改對手名稱或刪掉多的那筆）` };
    const index = hits[0];
    const item = schedule[index];
    if (item.resultUrl && item.resultUrl !== link) {
      const other = String(item.resultUrl).indexOf(LINK_PREFIX) === 0 ? decodeURIComponent(item.resultUrl.slice(LINK_PREFIX.length)) : item.resultUrl;
      return { ok: false, error: `時程這場已經連到別場（${other}），請先在時程編輯器確認` };
    }
    const next = Object.assign({}, item, { score: { longan: game.score.us, opponent: game.score.opp }, resultUrl: link });
    if (opts.league !== undefined && opts.league !== null) {
      const league = String(opts.league).trim();
      if (league) next.league = league; else delete next.league;
    }
    const out = schedule.map((x, i) => (i === index ? next : JSON.parse(JSON.stringify(x))));
    return { ok: true, schedule: out, index, mode: item.resultUrl === link ? 'update' : 'new', changed: !same(item, next) };
  }

  function mdText(date) {
    const p = String(date).split('-');
    return `${Number(p[1])}/${Number(p[2])}`;
  }
  function resultText(us, opp) {
    return us > opp ? '龍安勝' : us < opp ? '龍安敗' : '雙方和局';
  }
  function draftAnnouncement(game, today) {
    return {
      date: today,
      title: `${mdText(game.date)} 龍安 vs ${game.opponent} 賽事戰報`,
      body: `最終比數 ${game.score.us}:${game.score.opp} ${resultText(game.score.us, game.score.opp)}\n賽事成績紀錄與戰報更新囉~`,
      pinned: false,
      link: linkOf(game.id),
    };
  }
  function hasAnnouncement(list, id) {
    const link = linkOf(id);
    return (Array.isArray(list) ? list : []).some((a) => a && a.link === link);
  }
  function addAnnouncement(list, ann) {
    const copy = (Array.isArray(list) ? list : []).map((a) => JSON.parse(JSON.stringify(a)));
    if (copy.some((a) => a && a.link === ann.link)) return { announcements: copy, added: false };
    copy.push(ann);
    return { announcements: copy, added: true };
  }

  function applyUnpublish(schedule, announcements, gameId) {
    const link = linkOf(gameId);
    let scheduleChanged = false;
    const sched = schedule.map((x) => {
      if (!x || x.resultUrl !== link) return JSON.parse(JSON.stringify(x));
      scheduleChanged = true;
      return Object.assign({}, x, { score: null, resultUrl: null });
    });
    const ann = announcements.filter((a) => !(a && a.link === link)).map((a) => JSON.parse(JSON.stringify(a)));
    return { schedule: sched, announcements: ann, scheduleChanged, removedAnnouncements: announcements.length - ann.length };
  }

  /* opts：{ game, schedule, announcements, league（undefined＝沿用時程的）, announcement（{title, body} 或 null）, today } */
  function buildPublish(opts) {
    const game = opts.game;
    const r = applyPublish(opts.schedule, game, { league: opts.league });
    if (!r.ok) return r;
    if (opts.announcement && !Array.isArray(opts.announcements)) return { ok: false, error: '公告檔（announcements.json）格式不對，請先修好再發布' };
    const files = [{ path: gamePath(game.id), content: toJson(game) }];
    if (r.changed) files.push({ path: 'data/schedule.json', content: toJson(r.schedule) });
    let announced = false;
    if (opts.announcement) {
      const draft = draftAnnouncement(game, opts.today);
      const a = addAnnouncement(opts.announcements, Object.assign(draft, { title: opts.announcement.title, body: opts.announcement.body }));
      if (a.added) { files.push({ path: 'data/announcements.json', content: toJson(a.announcements) }); announced = true; }
    }
    const verb = r.mode === 'new' ? '發布' : '更新';
    return {
      ok: true, mode: r.mode, files, announced, schedule: r.schedule,
      message: `${verb}賽事成績：${game.date} vs ${game.opponent} ${game.score.us}:${game.score.opp}`,
    };
  }

  /* opts：{ gameId, gameExists（GitHub 上有沒有成績檔）, schedule, announcements } */
  function buildUnpublish(opts) {
    if (!validId(opts.gameId)) return { ok: false, error: `比賽 ID 不合格式：${JSON.stringify(opts.gameId)}` };
    if (!Array.isArray(opts.schedule) || !Array.isArray(opts.announcements)) return { ok: false, error: '時程或公告檔格式不對，請先修好再撤回' };
    const r = applyUnpublish(opts.schedule, opts.announcements, opts.gameId);
    const files = [];
    if (opts.gameExists) files.push({ path: gamePath(opts.gameId), content: null });
    if (r.scheduleChanged) files.push({ path: 'data/schedule.json', content: toJson(r.schedule) });
    if (r.removedAnnouncements) files.push({ path: 'data/announcements.json', content: toJson(r.announcements) });
    return { ok: true, files, message: `撤回賽事成績：${opts.gameId}`, removedAnnouncements: r.removedAnnouncements, scheduleChanged: r.scheduleChanged };
  }

  /* 問不到 GitHub 時，讀官網判斷發布過了沒（V01.15.01）：內容要真的是這場的成績資料。
     Cloudflare 沒有 404.html 時會把首頁當成功回傳；也可能讀到別場或壞掉的檔 */
  function isGameFile(text, id) {
    if (typeof text !== 'string' || !text) return false;
    try {
      const g = JSON.parse(text);
      return !!g && typeof g === 'object' && g.id === id;
    } catch (e) {
      return false;
    }
  }

  function leagues(schedule) {
    const out = [];
    (Array.isArray(schedule) ? schedule : []).forEach((x) => {
      const l = x && typeof x.league === 'string' ? x.league.trim() : '';
      if (l && out.indexOf(l) === -1) out.push(l);
    });
    return out;
  }

  const api = { validId, linkOf, gamePath, isGameFile, applyPublish, draftAnnouncement, hasAnnouncement, addAnnouncement, applyUnpublish, buildPublish, buildUnpublish, leagues };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PublishCore = api;
})(this);
