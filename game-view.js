/* 龍安棒球隊 比賽文字轉播的畫面（CPBL 式）
   /tools/record-converter.html 的預覽、公開的文字轉播頁共用這一份，預覽看到的就是上線後的樣子。
   需要先載入 site.js（escapeHtml）。資料格式是 record-converter 產生的 data/games/<比賽ID>.json。 */
(function (root) {
  const esc = (s) => root.escapeHtml(s == null ? '' : String(s));
  const HALF_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

  // 簡碼標籤的顏色分類：安打、上壘（沒有打數）、出局
  function badgeClass(kind) {
    if (['1B', '2B', '3B', 'HR'].includes(kind)) return 'hit';
    if (['BB', 'IBB', 'HBP', 'E', 'FC', 'K_REACH', 'CI'].includes(kind)) return 'onbase';
    return 'out';
  }

  /* 龍安是不是先攻（客隊）。比分一律先攻的隊伍在前，跟 CPBL 一樣 */
  function usBatFirst(game) {
    const h = game.halves[0];
    return h ? (h.offense === 'us') === h.top : true;
  }

  /* 對手的半局有沒有記完整。沒記完整時，對手的分數是「未知」，不能當成 0 顯示 */
  function oppKnown(game) {
    return game.pitchingStatus === 'complete';
  }

  /* 比分表：每局得分、R、H */
  function linescoreHTML(game) {
    const innings = Math.max(5, ...game.halves.map((h) => h.inning));
    const row = (side) => {
      const cells = [];
      let r = 0;
      let hits = 0;
      for (let i = 1; i <= innings; i++) {
        const h = game.halves.find((x) => x.inning === i && x.offense === side);
        if (!h) { cells.push('<td class="na">-</td>'); continue; }
        if (h.unrecorded) { cells.push('<td class="na">?</td>'); continue; }
        r += h.runs;
        hits += h.items.filter((it) => it.type === 'pa' && ['1B', '2B', '3B', 'HR'].includes(it.kind)).length;
        cells.push(`<td>${h.runs}</td>`);
      }
      return { cells: cells.join(''), r, hits };
    };
    const us = row('us');
    const opp = row('opp');
    if (!oppKnown(game)) { opp.r = '?'; opp.hits = '?'; }
    const rows = [
      { name: game.opponent || '對手', ...opp, cls: 'opp' },
      { name: game.teamName || '龍安', ...us, cls: 'us' },
    ];
    if (usBatFirst(game)) rows.reverse(); // 先攻的隊伍排上面
    const head = Array.from({ length: innings }, (_, i) => `<th>${i + 1}</th>`).join('');
    return `
      <div class="gv-linescore-wrap">
        <table class="gv-linescore">
          <thead><tr><th class="team"></th>${head}<th class="sum">R</th><th class="sum">H</th></tr></thead>
          <tbody>${rows.map((x) => `<tr class="${x.cls}"><td class="team">${esc(x.name)}</td>${x.cells}<td class="sum">${x.r}</td><td class="sum">${x.hits}</td></tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  function avatarHTML(it, isUs, photos) {
    if (!isUs) return `<div class="gv-avatar gv-slot">${it.slot ? it.slot : '?'}</div>`;
    const src = photos[it.number] || photos.__silhouette;
    return `<img class="gv-avatar" src="${esc(src)}" alt="" loading="lazy" onerror="this.src='${esc(photos.__silhouette)}'">`;
  }

  function outsHTML(n) {
    return `<span class="gv-outs" title="${n} 出局">${[1, 2].map((i) => `<i class="${n >= i ? 'on' : ''}"></i>`).join('')}</span>`;
  }

  function basesHTML(bases) {
    if (!bases) return '';
    const on = (i) => (bases[i] ? 'on' : '');
    return `<span class="gv-bases" title="壘包"><i class="b2 ${on(1)}"></i><i class="b3 ${on(2)}"></i><i class="b1 ${on(0)}"></i></span>`;
  }

  function itemHTML(it, half, game, photos) {
    const isUs = half.offense === 'us';
    if (it.type === 'sub') return `<div class="gv-action">${esc(it.text)}</div>`;
    if (it.type === 'note') return `<div class="gv-action">${esc(it.text)}</div>`;
    if (it.unparsed) {
      return `<div class="gv-play unparsed"><div class="gv-body"><div class="gv-desc">${esc(it.desc)}</div></div></div>`;
    }
    const who = isUs
      ? `第${it.slot}棒 ${esc(it.name || ('#' + it.number))}`
      : `${esc(game.opponent || '對手')} 第${it.slot}棒`;
    const extra = [];
    if (it.scorers && it.scorers.length) extra.push(`${it.scorers.map((s) => esc(s.name)).join('、')}回本壘得分`);
    if (it.rbi) extra.push(`${it.rbi}分打點`);
    const oppScore = oppKnown(game) ? it.score.opp : '?';
    const score = usBatFirst(game) ? `${it.score.us}:${oppScore}` : `${oppScore}:${it.score.us}`;
    return `
      <div class="gv-play${it.runs ? ' scored' : ''}">
        ${avatarHTML(it, isUs, photos)}
        <div class="gv-body">
          <div class="gv-desc"><b>${who}</b>：${esc(it.desc)}${extra.length ? `<span class="gv-extra">${extra.join('，')}。</span>` : ''}</div>
          <div class="gv-meta">
            <span class="gv-badge ${badgeClass(it.kind)}">${esc(it.display)}</span>
            ${outsHTML(Math.min(it.outsAfter, 2))}${it.outsAfter >= 3 ? '<span class="gv-3out">三出局</span>' : basesHTML(it.bases)}
            <span class="gv-score">${score}</span>
          </div>
        </div>
      </div>`;
  }

  function halvesHTML(game, photos) {
    return game.halves.map((h) => {
      const team = h.offense === 'us' ? (game.teamName || '龍安') : (game.opponent || '對手');
      // 每個半局預設收起來，點標題展開（<details> 是瀏覽器內建的收折，不需要 JS）
      return `
        <details class="gv-half ${h.offense}">
          <summary class="gv-half-head">${HALF_CN[h.inning] || h.inning}局${h.top ? '上' : '下'}　${esc(team)}攻<span>${h.unrecorded ? '未記錄' : h.runs + ' 分'}</span></summary>
          ${h.items.map((it) => itemHTML(it, h, game, photos)).join('')}
        </details>`;
    }).join('');
  }

  function battingHTML(game) {
    // E（失誤）：實況賽事紀錄才有（V01.09.00 起），舊的文字紀錄場次沒有這欄就不顯示
    const cols = ['AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'BB', 'HBP', 'K', 'SB', ...(game.batting.some((b) => 'E' in b) ? ['E'] : [])];
    const rows = game.batting.filter((b) => cols.some((c) => b[c]) || b.appeared);
    const sum = (c) => rows.reduce((a, b) => a + (b[c] || 0), 0);
    let lastSlot = null;
    return `
      <div class="gv-table-wrap">
        <table class="gv-stats">
          <thead><tr><th>棒</th><th class="l">球員</th>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map((b) => {
              const first = b.slot !== lastSlot;
              lastSlot = b.slot;
              return `<tr class="${first ? 'starter' : 'sub'}"><td>${first ? (b.slot || '') : ''}</td><td class="l">${first ? '' : '↳ '}${esc(b.name)}</td>${cols.map((c) => `<td>${b[c] || 0}</td>`).join('')}</tr>`;
            }).join('')}
            <tr class="total"><td></td><td class="l">合計</td>${cols.map((c) => `<td>${sum(c)}</td>`).join('')}</tr>
          </tbody>
        </table>
      </div>`;
  }

  function pitchingHTML(game) {
    const cols = [['IP', 'IP'], ['H', 'H'], ['R', 'R'], ['BB', 'BB'], ['HBP', 'HBP'], ['SO', 'SO'], ['HR', 'HR']];
    return `
      <div class="gv-table-wrap">
        <table class="gv-stats">
          <thead><tr><th class="l">投手</th>${cols.map(([, t]) => `<th>${t}</th>`).join('')}</tr></thead>
          <tbody>${game.pitching.map((p) => `<tr><td class="l">${esc(p.name)}</td>${cols.map(([k]) => `<td>${p[k]}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  /* 整場：比分表 → 打者成績 → 投手成績 → 文字轉播（半局預設收起）。photos：{ 背號: 圖片網址, __silhouette: 剪影網址 } */
  function renderGame(game, photos) {
    const team = esc(game.teamName || '龍安');
    return `
      <div class="gv">
        ${linescoreHTML(game)}
        <h2 class="gv-h2">${team} 打者成績</h2>
        ${battingHTML(game)}
        ${game.pitching && game.pitching.length ? `<h2 class="gv-h2">${team} 投手成績</h2>${pitchingHTML(game)}` : ''}
        <h2 class="gv-h2 gv-h2-row">文字轉播<button type="button" class="gv-toggle-all">全部展開</button></h2>
        ${halvesHTML(game, photos)}
      </div>`;
  }

  /* 「全部展開／全部收起」：用事件委派，畫面重畫（轉換頁預覽）後照樣有效 */
  if (root.document) {
    root.document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.gv-toggle-all');
      if (!btn) return;
      const halves = btn.closest('.gv').querySelectorAll('.gv-half');
      const open = !Array.from(halves).every((d) => d.open);
      halves.forEach((d) => { d.open = open; });
      btn.textContent = open ? '全部收起' : '全部展開';
    });
    // 一局一局手動點開到全部都開時，按鈕文字也要跟著變
    root.document.addEventListener('toggle', (e) => {
      if (!e.target.classList || !e.target.classList.contains('gv-half')) return;
      const gv = e.target.closest('.gv');
      const btn = gv && gv.querySelector('.gv-toggle-all');
      if (btn) btn.textContent = Array.from(gv.querySelectorAll('.gv-half')).every((d) => d.open) ? '全部收起' : '全部展開';
    }, true);
  }

  /* data/players.json → renderGame 用的照片對照表；prefix 是頁面到 repo 根目錄的相對路徑（例：'../'） */
  function photoMap(players, prefix) {
    const map = { __silhouette: prefix + 'images/players/silhouette.svg' };
    (players || []).forEach((p) => { if (p.photo) map[p.number] = prefix + p.photo; });
    return map;
  }

  root.GameView = { renderGame, photoMap, badgeClass, oppKnown };
})(this);
