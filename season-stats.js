/* 龍安棒球隊 戰績頁的整季加總（V01.13.02）
   戰績頁（standings.html）與 Node 測試（tests/test_season_stats.js）共用這一份。
   - groups(schedule)：時程裡「有標賽事（league）、有連到賽事成績、沒取消」的比賽，依「年份＋賽事」分組，新的在前
   - summarize(entries, gamesById)：把那幾場的 data/games/<比賽ID>.json 加總成戰績、打擊、投手成績
   欄位和單場賽事成績頁相同；打擊多算打擊率、上壘率、長打率（上壘率＝(H+BB+HBP)/(AB+BB+HBP)，資料裡沒有高飛犧牲打） */
(function (root) {
  const BAT_KEYS = ['AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'BB', 'HBP', 'K', 'SB', 'E'];
  const PIT_KEYS = ['H', 'R', 'BB', 'HBP', 'SO', 'HR'];
  const RESULT_RE = /^game\.html\?id=([^&#\s]+)$/;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const byNumber = (a, b) => (Number(a.number) - Number(b.number)) || String(a.number).localeCompare(String(b.number));

  function groups(schedule) {
    const map = {};
    (Array.isArray(schedule) ? schedule : []).forEach((x) => {
      if (!x || x.type !== 'game' || x.cancelled || typeof x.league !== 'string' || !x.league.trim()) return;
      const m = typeof x.resultUrl === 'string' && RESULT_RE.exec(x.resultUrl);
      if (!m || typeof x.date !== 'string') return;
      const year = x.date.slice(0, 4);
      const league = x.league.trim();
      const key = `${year} ${league}`;
      if (!map[key]) map[key] = { key, label: key, year, league, entries: [] };
      map[key].entries.push({ date: x.date, opponent: x.opponent || '', id: decodeURIComponent(m[1]), href: x.resultUrl });
    });
    const out = Object.values(map);
    out.forEach((gp) => gp.entries.sort((a, b) => b.date.localeCompare(a.date)));
    // 新的年份在前；同一年裡，最近有比賽的賽事在前
    return out.sort((a, b) => b.year.localeCompare(a.year) || b.entries[0].date.localeCompare(a.entries[0].date));
  }

  const rate = (n, d) => {
    if (!d) return '-';
    const v = (Math.round((n / d) * 1000) / 1000).toFixed(3);
    return v.startsWith('0') ? v.slice(1) : v;
  };
  function withRates(r) {
    const singles = r.H - r['2B'] - r['3B'] - r.HR;
    const tb = singles + 2 * r['2B'] + 3 * r['3B'] + 4 * r.HR;
    return { ...r, AVG: rate(r.H, r.AB), OBP: rate(r.H + r.BB + r.HBP, r.AB + r.BB + r.HBP), SLG: rate(tb, r.AB) };
  }
  const ipOuts = (ip) => {
    const m = /^(\d+)(?:\.([0-2]))?$/.exec(String(ip == null ? '' : ip));
    return m ? Number(m[1]) * 3 + Number(m[2] || 0) : 0;
  };
  const ipText = (outs) => `${Math.floor(outs / 3)}.${outs % 3}`;

  function summarize(entries, gamesById) {
    const record = { played: 0, win: 0, loss: 0, tie: 0 };
    const games = [];
    const missing = [];
    const bat = {};
    const pit = {};
    let erIncomplete = false;
    // 由舊到新加總，名字用最新一場的
    (entries || []).slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => {
      const g = gamesById && gamesById[e.id];
      if (!g || !g.score) { missing.push(e.id); return; }
      const us = num(g.score.us);
      const opp = num(g.score.opp);
      const result = us > opp ? 'W' : us < opp ? 'L' : 'T';
      record.played += 1;
      record[result === 'W' ? 'win' : result === 'L' ? 'loss' : 'tie'] += 1;
      games.push({ date: e.date, opponent: e.opponent || g.opponent || '', id: e.id, href: e.href, us, opp, result });
      (g.batting || []).forEach((b) => {
        const k = String(b.number);
        const r = bat[k] || (bat[k] = { number: k, name: '' });
        r.name = b.name || r.name;
        BAT_KEYS.forEach((key) => { r[key] = (r[key] || 0) + num(b[key]); });
      });
      (g.pitching || []).forEach((p) => {
        const k = String(p.number);
        const r = pit[k] || (pit[k] = { number: k, name: '', outs: 0, ER: 0, erMissing: false });
        r.name = p.name || r.name;
        r.outs += ipOuts(p.IP);
        PIT_KEYS.forEach((key) => { r[key] = (r[key] || 0) + num(p[key]); });
        if (Number.isInteger(p.ER)) r.ER += p.ER; else { r.erMissing = true; erIncomplete = true; }
      });
    });
    games.reverse();
    const batting = Object.values(bat).sort(byNumber).map(withRates);
    const total = { number: '', name: '合計' };
    BAT_KEYS.forEach((key) => { total[key] = batting.reduce((a, r) => a + r[key], 0); });
    const pitRows = Object.values(pit).sort(byNumber);
    const pitching = pitRows.map((r) => {
      const row = { number: r.number, name: r.name, IP: ipText(r.outs), ER: r.erMissing ? '-' : r.ER };
      PIT_KEYS.forEach((key) => { row[key] = r[key]; });
      return row;
    });
    const pitchingTotal = { number: '', name: '合計', IP: ipText(pitRows.reduce((a, r) => a + r.outs, 0)), ER: erIncomplete ? '-' : pitRows.reduce((a, r) => a + r.ER, 0) };
    PIT_KEYS.forEach((key) => { pitchingTotal[key] = pitRows.reduce((a, r) => a + r[key], 0); });
    return { record, games, batting, battingTotal: withRates(total), pitching, pitchingTotal, erIncomplete, missing };
  }

  const api = { groups, summarize, BAT_KEYS, PIT_KEYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SeasonStats = api;
})(this);
