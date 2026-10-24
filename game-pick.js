/* 龍安棒球隊 從時程挑比賽（V01.16.00）
   龍安調度與紀錄工具（tools/lineup.html）第一步的「📅 今天：11/15（日）vs RELOOC｜大漢聯盟」按鈕，
   點一下填好日期、對手，對手名稱和時程一致（賽後一鍵發布靠「同一天、同對手」找時程那場）。
   測試：tests/test_game_pick.js
   - suggest(schedule, today)：今天的比賽；沒有就最近的下一場（跳過取消的、練球不算）；都沒有回 null */
(function (root) {
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function md(date) {
    const d = new Date(date + 'T00:00:00Z');
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEKDAYS[d.getUTCDay()]}）`;
  }

  function suggest(schedule, today) {
    if (!Array.isArray(schedule)) return null;
    const games = schedule.filter((x) => x && typeof x === 'object' && x.type === 'game' && !x.cancelled
      && typeof x.date === 'string' && DATE_RE.test(x.date) && x.date >= today && String(x.opponent || '').trim())
      .sort((a, b) => a.date.localeCompare(b.date));
    const g = games[0];
    if (!g) return null;
    const opponent = String(g.opponent).trim();
    const league = typeof g.league === 'string' ? g.league.trim() : '';
    const isToday = g.date === today;
    return {
      date: g.date, opponent, league, isToday,
      label: `${isToday ? '今天' : '下一場'}：${md(g.date)}vs ${opponent}${league ? '｜' + league : ''}`,
    };
  }

  const api = { suggest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GamePick = api;
})(this);
