/* 龍安棒球隊 實況賽事紀錄的計算核心
   /tools/game-record.html（記錄畫面）與 Node 測試（tests/test_game_core.js）共用這一份。
   規格：docs/賽事紀錄工具_構想.md 第 11 節、docs/賽事紀錄工具_規則漏洞清單.md。

   一場比賽 ＝ 開賽設定（setup）＋ 一串紀錄（events）。目前的狀態一律由 replay(setup, events) 重算：
   - 復原上一筆 ＝ 刪掉最後一筆再重算
   - 雲端備份上傳的也是這一串紀錄
   紀錄的種類：
     { t:'pa',   result, pos, runners:[{from,to,reason}], rbi?, sf?, sac?, runsBeforeTag?, bunt? }  打席
     { t:'run',  runners:[{from,to,reason}] }                                            跑壘事件（盜壘、暴投…）
     { t:'sub',  kind:'PH'|'PR'|'P'|'DEF', in:{number,name}, slot?, base?, pos? }       換人
     { t:'pos',  changes:[{slot,pos}] }                                                  守位調整
     { t:'dhOff', slot }                                                                 DH 取消：投手接第 slot 棒
     { t:'note', text }                                                                  備註（例：對手換投）
     { t:'end' }                                                                         比賽結束
   跑者的 from：0 ＝ 打者，1～3 ＝ 壘包；to：-1 ＝ 出局，1～3 ＝ 壘包，4 ＝ 回本壘得分。
   輸出（toGame）和 data/games/*.json 同格式，公開的賽事成績頁（game-view.js）直接畫得出來。 */
(function (root) {
  const FIELD = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
  const POS_LABEL = { P: '投手', C: '捕手', '1B': '一壘', '2B': '二壘', '3B': '三壘', SS: '游擊', LF: '左外野', CF: '中外野', RF: '右外野', DH: 'DH' };
  const NUM_POS = { 1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF' };
  const POS_CHAR = { 1: '投', 2: '捕', 3: '一', 4: '二', 5: '三', 6: '游', 7: '左', 8: '中', 9: '右' };
  const BASE_LABEL = { 0: '本壘', 1: '一壘', 2: '二壘', 3: '三壘', 4: '本壘' };

  const HITS = { '1B': 1, '2B': 2, '3B': 3, HR: 4 };
  const ON_RESULTS = ['1B', '2B', '3B', 'HR', 'BB', 'IBB', 'HBP', 'CI', 'E', 'FC', 'K_REACH'];
  const OUT_RESULTS = ['K', 'GROUND', 'FLY', 'LINE', 'BUNT', 'OUT'];
  const DEAD_BALL = ['IBB', 'HBP', 'CI']; // 死球：跑者只能被擠進一個壘（漏洞清單 A1、A3；故意四壞採申告）
  const AB_KINDS = ['1B', '2B', '3B', 'HR', 'K', 'K_REACH', 'GROUND', 'FLY', 'LINE', 'BUNT', 'OUT', 'E', 'FC', 'DP', 'TP'];
  const NO_RBI_KINDS = ['E', 'K_REACH', 'DP', 'TP'];
  const NO_RBI_REASONS = ['失誤', '暴投', '捕逸', '盜壘'];
  const OUTFIELD = [7, 8, 9];

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const isOut = (r) => r.to === -1;

  /* ---------- 開賽 ---------- */
  function newGame(setup) {
    const lineup = setup.lineup.map((p) => ({ number: String(p.number), name: p.name || '', pos: p.pos || null }));
    return {
      meta: { teamName: setup.teamName || '龍安', opponent: setup.opponent || '對手' },
      inning: 1, top: true, offense: setup.usBatFirst === false ? 'opp' : 'us',
      outs: 0, bases: [null, null, null], score: { us: 0, opp: 0 },
      usNext: 0, oppNext: 0,
      lineup,
      dh: !!setup.dh,
      pitcher: setup.dh && setup.pitcher ? { number: String(setup.pitcher.number), name: setup.pitcher.name || '' } : null,
      bench: (setup.bench || []).map((p) => ({ number: String(p.number), name: p.name || '' })),
      removed: [],
      slotHistory: lineup.map((p) => [p.number]), // 每一棒依序上場過的人（成績表的列順序）
      halves: [],
      stats: { batting: {}, pitching: {}, pitchOrder: [] },
      ended: false,
    };
  }

  /* ---------- 查詢 ---------- */
  function currentPitcher(s) {
    if (s.dh) return s.pitcher;
    const p = s.lineup.find((x) => x.pos === 'P');
    return p ? { number: p.number, name: p.name } : null;
  }

  /* 我方守備的問題：守位未排、重複、缺位。空陣列 ＝ 可以開始守備 */
  function fieldingProblems(s) {
    const out = [];
    s.lineup.forEach((p, i) => { if (!p.pos) out.push(`第 ${i + 1} 棒 ${p.name || '#' + p.number} 尚未排守位`); });
    const count = {};
    s.lineup.forEach((p) => { if (p.pos && p.pos !== 'DH') count[p.pos] = (count[p.pos] || 0) + 1; });
    if (s.dh && s.pitcher) count.P = (count.P || 0) + 1;
    const dup = FIELD.filter((k) => count[k] > 1);
    const missing = FIELD.filter((k) => !count[k]);
    if (dup.length) out.push(`守位重複：${dup.map((k) => POS_LABEL[k]).join('、')}`);
    if (missing.length) out.push(`尚缺守位：${missing.map((k) => POS_LABEL[k]).join('、')}`);
    return out;
  }

  function fielderAt(s, posNum) {
    const code = NUM_POS[posNum];
    if (!code) return null;
    if (code === 'P') return currentPitcher(s);
    return s.lineup.find((p) => p.pos === code) || null;
  }

  function batterOf(s) {
    if (s.offense === 'us') {
      const p = s.lineup[s.usNext];
      return { side: 'us', slot: s.usNext + 1, number: p.number, name: p.name };
    }
    return { side: 'opp', slot: s.oppNext + 1, number: null, name: '' };
  }

  const runnerName = (s, r) => (r.side === 'us' ? (r.name || '#' + r.number) : `${s.meta.opponent}第${r.slot}棒`);

  /* ---------- 預設去向 ---------- */
  /* 被擠：打者要上一壘，前面的壘全都有人 */
  function forcedBases(bases) {
    const f = [false, false, false];
    for (let b = 1; b <= 3; b++) f[b - 1] = !!bases[b - 1] && bases.slice(0, b - 1).every(Boolean);
    return f;
  }

  /* 打者＋壘上跑者的預設去向：[{ from, to, forced }]，打者在第一個 */
  function defaults(s, result) {
    const forced = forcedBases(s.bases);
    const rows = [];
    const n = HITS[result];
    let batterTo;
    if (n) batterTo = n;
    else if (ON_RESULTS.includes(result)) batterTo = 1;
    else batterTo = -1;
    rows.push({ from: 0, to: batterTo, forced: false });
    s.bases.forEach((r, i) => {
      if (!r) return;
      const from = i + 1;
      let to = from;
      if (n) to = Math.min(from + n, 4);
      else if (ON_RESULTS.includes(result) || result === 'GROUND') to = forced[i] ? from + 1 : from; // 漏洞清單 C1：滾地出局時被擠的跑者預設進一壘
      rows.push({ from, to, forced: forced[i] });
    });
    return rows;
  }

  /* 依預設去向組出一筆打席紀錄；moves 是例外：{ 0: {to, reason}, 1: {...} } */
  function buildPA(s, result, pos, opts = {}) {
    const moves = opts.moves || {};
    const runners = defaults(s, result).map((d) => {
      const m = moves[d.from];
      const row = { from: d.from, to: m && m.to !== undefined ? m.to : d.to };
      if (m && m.reason) row.reason = m.reason;
      return row;
    });
    const ev = { t: 'pa', result, pos: pos == null ? null : pos, runners };
    ['rbi', 'sf', 'sac', 'runsBeforeTag', 'bunt'].forEach((k) => { if (opts[k] !== undefined) ev[k] = opts[k]; });
    return ev;
  }

  /* ---------- 檢查 ---------- */
  function checkRunnerMoves(s, rows, out) {
    // 同一個壘、超過前位跑者、一球超過三個出局
    const outs = rows.filter(isOut).length;
    if (s.outs + outs > 3) out.push(`一球最多只能到三個出局（現在 ${s.outs} 出局，這球記了 ${outs} 個出局）`);
    rows.forEach((r) => {
      if (![-1, 1, 2, 3, 4].includes(r.to)) out.push('跑者去向不正確');
      else if (!isOut(r) && r.to < r.from) out.push(`${BASE_LABEL[r.from]}跑者不能退回 ${BASE_LABEL[r.to]}`);
    });
    // 這一球三出局：半局結束、壘包清空，跑者停在哪裡不影響紀錄，不檢查同壘與超前（【修正】雙殺結束半局時卡住）
    if (s.outs + outs >= 3) return;
    const safe = rows.filter((r) => !isOut(r) && r.to < 4);
    const seen = {};
    safe.forEach((r) => {
      if (seen[r.to]) out.push(`兩位跑者在同一個壘（${BASE_LABEL[r.to]}），請調整`);
      seen[r.to] = true;
    });
    const alive = rows.filter((r) => !isOut(r)).sort((a, b) => a.from - b.from);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const back = alive[i];
        const front = alive[j];
        if (back.to >= front.to && !(back.to === 4 && front.to === 4)) {
          out.push('後面的跑者不能超過前面的跑者（除非前面的跑者出局）');
          return;
        }
      }
    }
  }

  function validatePA(s, ev, out) {
    const result = ev.result;
    if (!ON_RESULTS.includes(result) && !OUT_RESULTS.includes(result)) { out.push(`不認得的打席結果：${result}`); return; }
    if (s.offense === 'opp') {
      const fp = fieldingProblems(s);
      if (fp.length) out.push(`防守前守位要先排好：${fp.join('；')}`);
    }
    if (result === 'K_REACH' && s.bases[0] && s.outs < 2) out.push('不死三振不成立：一壘有人且未滿兩出局，請記三振');
    const rows = ev.runners || [];
    const fromList = rows.map((r) => r.from).sort();
    const expected = [0, ...s.bases.map((r, i) => (r ? i + 1 : null)).filter((x) => x !== null)];
    if (fromList.join() !== expected.join()) { out.push('跑者資料和壘包對不上，請重新選擇'); return; }
    const def = {};
    defaults(s, result).forEach((d) => { def[d.from] = d; });
    rows.forEach((r) => {
      const d = def[r.from];
      const label = r.from === 0 ? '打者' : `${BASE_LABEL[r.from]}跑者`;
      if (DEAD_BALL.includes(result)) {
        if (r.to !== d.to) out.push(`死球（觸身、申告故意四壞、妨礙打擊）：${label}只能照被擠的方式前進，不能多跑或出局`);
        return;
      }
      if (result === 'HR') {
        if (r.to !== 4) out.push('全壘打時打者和所有跑者都要回本壘');
        return;
      }
      if (result === 'BB' && d.forced && r.to === r.from) out.push(`${label}被擠，不能留在原壘`);
      if (isOut(r) && d.to !== -1 && !r.reason) out.push(`${label}出局要選原因（封殺、觸殺、回壘不及）`);
      const extra = !isOut(r) && (d.to === -1 || r.to > d.to);
      if (extra && !r.reason && (r.from === 0 || result === 'BB')) out.push(`${label}比預設多跑，要選原因`);
    });
    checkRunnerMoves(s, rows, out);
    // 漏洞清單 D1：第三個出局是觸殺（或回壘不及）又有人回本壘，要選是不是先踩本壘
    const outs = rows.filter(isOut).length;
    const scored = rows.filter((r) => r.to === 4).length;
    if (outs && s.outs + outs === 3 && scored && !voidByForce(rows) && typeof ev.runsBeforeTag !== 'boolean') {
      out.push('觸殺（或回壘不及）造成第三出局：請選跑者是否先踩本壘，決定得分算不算');
    }
  }

  /* 第三出局是打者出局或封殺：這一球的得分一律不算（5.08(a)） */
  const voidByForce = (rows) => rows.some((r) => isOut(r) && (r.from === 0 || r.reason === '封殺'));

  function validateRun(s, ev, out) {
    const rows = ev.runners || [];
    if (!rows.length) { out.push('跑壘事件至少要有一位跑者移動'); return; }
    rows.forEach((r) => {
      if (!s.bases[r.from - 1]) out.push(`${BASE_LABEL[r.from] || '?'}沒有跑者`);
      if (r.to === r.from) out.push(`${BASE_LABEL[r.from]}跑者沒有移動`);
      if (!r.reason) out.push(`${BASE_LABEL[r.from]}跑者要選原因（盜壘、暴投、捕逸…）`);
    });
    const all = s.bases.map((r, i) => (r ? (rows.find((x) => x.from === i + 1) || { from: i + 1, to: i + 1 }) : null)).filter(Boolean);
    checkRunnerMoves(s, all, out);
  }

  function validateSub(s, ev, out) {
    const p = ev.in;
    if (!p || !p.number) { out.push('請選擇換上的球員'); return; }
    const num = String(p.number);
    if (s.removed.includes(num)) out.push(`#${num} 已經退場，不能再上場`);
    if (s.lineup.some((x) => x.number === num) || (s.dh && s.pitcher && s.pitcher.number === num && ev.kind !== 'P')) out.push(`#${num} 已經在場上`);
    if (ev.kind === 'PH' && s.offense !== 'us') out.push('代打只能在我方進攻時記');
    if (ev.kind === 'PR') {
      const r = s.bases[(ev.base || 0) - 1];
      if (s.offense !== 'us' || !r || r.side !== 'us') out.push('這個壘包上沒有我方跑者，無法代跑');
    }
    if (ev.kind === 'P' && !currentPitcher(s)) out.push('找不到現在的投手，請先用「守位調整」排好投手');
    if (ev.kind === 'DEF' && !(ev.slot >= 1 && ev.slot <= 9)) out.push('請選擇要換下第幾棒');
    if (!['PH', 'PR', 'P', 'DEF'].includes(ev.kind)) out.push('不認得的換人種類');
  }

  function validate(s, ev) {
    const out = [];
    if (s.ended) return ['比賽已經結束，不能再記'];
    switch (ev && ev.t) {
      case 'pa': validatePA(s, ev, out); break;
      case 'run': validateRun(s, ev, out); break;
      case 'sub': validateSub(s, ev, out); break;
      case 'pos':
        (ev.changes || []).forEach((c) => {
          if (!(c.slot >= 1 && c.slot <= 9)) out.push('守位調整的棒次不正確');
          if (![...FIELD, 'DH'].includes(c.pos)) out.push(`不認得的守位：${c.pos}`);
          if (c.pos === 'DH' && !s.dh) out.push('這場沒有 DH（或 DH 已取消）');
          if (c.pos === 'P' && s.dh) out.push('DH 有效時不能把打序裡的球員排去投手（DH 會取消），請先記「DH 取消」');
        });
        break;
      case 'dhOff':
        if (!s.dh) out.push('這場沒有 DH（或 DH 已取消）');
        if (!(ev.slot >= 1 && ev.slot <= 9)) out.push('請選擇投手接第幾棒');
        break;
      case 'note': case 'end': break;
      default: out.push('不認得的紀錄種類');
    }
    return out;
  }

  /* ---------- 成績 ---------- */
  function bat(s, p) {
    const k = String(p.number);
    if (!s.stats.batting[k]) {
      s.stats.batting[k] = { number: k, name: p.name || '', AB: 0, R: 0, H: 0, '2B': 0, '3B': 0, HR: 0, RBI: 0, BB: 0, IBB: 0, HBP: 0, K: 0, SB: 0, CS: 0, E: 0 };
    }
    return s.stats.batting[k];
  }
  function pit(s) {
    const p = currentPitcher(s);
    if (!p) return null;
    if (!s.stats.pitching[p.number]) {
      s.stats.pitching[p.number] = { number: p.number, name: p.name || '', outs: 0, H: 0, R: 0, BB: 0, HBP: 0, SO: 0, HR: 0, WP: 0 };
      s.stats.pitchOrder.push(p.number);
    }
    return s.stats.pitching[p.number];
  }

  /* ---------- 半局 ---------- */
  const HALF_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  function curHalf(s) {
    let h = s.halves[s.halves.length - 1];
    if (!h || h.inning !== s.inning || h.top !== s.top) {
      h = { inning: s.inning, top: s.top, offense: s.offense, label: `${HALF_CN[s.inning] || s.inning}局${s.top ? '上' : '下'}`, runs: 0, items: [] };
      s.halves.push(h);
    }
    return h;
  }
  function endHalf(s) {
    s.outs = 0;
    s.bases = [null, null, null];
    if (s.top) s.top = false;
    else { s.top = true; s.inning += 1; }
    s.offense = s.offense === 'us' ? 'opp' : 'us';
  }

  /* ---------- 顯示文字 ---------- */
  function displayOf(kind, pos) {
    const c = POS_CHAR[pos] || '';
    switch (kind) {
      case '1B': return '一安';
      case '2B': return '二安';
      case '3B': return '三安';
      case 'HR': return '全打';
      case 'BB': return '四壞';
      case 'IBB': return '故意四壞';
      case 'HBP': return '死球';
      case 'CI': return '妨礙';
      case 'K': case 'K_REACH': return '三振';
      case 'SF': return '犧飛';
      case 'SAC': return '犧觸';
      case 'DP': return '雙殺';
      case 'TP': return '三殺';
      case 'FC': return '野選';
      case 'E': return c + '失';
      case 'FLY': return c + '飛';
      case 'LINE': return c + '平';
      case 'GROUND': return c + '滾';
      case 'BUNT': return c + '觸';
      default: return '出局';
    }
  }

  function describe(s, ev, kind, fielder) {
    const where = POS_LABEL[NUM_POS[ev.pos]] || '';
    const dir = where ? `${where}方向` : '';
    const base = {
      '1B': `${dir}一壘安打`, '2B': `${dir}二壘安打`, '3B': `${dir}三壘安打`, HR: `${dir}全壘打`,
      BB: '四壞球保送', IBB: '故意四壞球保送', HBP: '觸身球', CI: '捕手妨礙打擊，打者上一壘',
      E: `${where}${fielder ? ' ' + fielder.name : ''} 失誤，打者上壘`, FC: `${where}野手選擇，打者上壘`,
      K: '三振出局', K_REACH: '不死三振，打者上壘',
      GROUND: `${where}滾地球出局`, FLY: `${where}高飛球接殺`, LINE: `${where}平飛球接殺`, BUNT: `${where}觸擊出局`, OUT: '出局',
    }[ev.result] || '';
    // 觸擊安打：成績照樣是安打，只有文字不同（一安寫「捕手方向觸擊安打」，長打保留壘數）
    let hitText = base;
    if (ev.bunt && HITS[ev.result]) hitText = ev.result === '1B' ? `${dir}觸擊安打` : base.replace('安打', '觸擊安打');
    const tag = { SF: '（高飛犧牲打）', SAC: '（犧牲觸擊）', DP: '（雙殺）', TP: '（三殺）' }[kind] || '';
    return hitText.trim() + tag + runnerNotes(s, ev.runners, true);
  }

  /* 跑者的特別狀況：有原因或出局的才寫（正常推進不寫，避免太長） */
  function runnerNotes(s, rows, leadingComma) {
    const notes = [];
    rows.forEach((r) => {
      if (r.from === 0 && !r.reason) return;
      if (r.from > 0 && !r.reason && !isOut(r)) return;
      const who = r.from === 0 ? '打者' : `${BASE_LABEL[r.from]}跑者 ${runnerName(s, s.bases[r.from - 1])}`;
      const dest = isOut(r) ? '出局' : r.to === 4 ? '回本壘' : `上${BASE_LABEL[r.to]}`;
      notes.push(`${who}${r.reason ? ' ' + r.reason : ''}${dest}`);
    });
    if (!notes.length) return '';
    return (leadingComma ? '，' : '') + notes.join('，');
  }

  const basesOut = (s) => s.bases.map((r) => (r ? { number: r.number, name: runnerName(s, r) } : null));

  /* ---------- 套用 ---------- */
  function applyPA(s, ev) {
    const h = curHalf(s);
    const isUs = s.offense === 'us';
    const batter = batterOf(s);
    const outsBefore = s.outs;
    const rows = ev.runners.map((r) => ({ ...r, runner: r.from === 0 ? batter : s.bases[r.from - 1] }));
    const outsOnPlay = rows.filter(isOut).length;
    const outsAfter = outsBefore + outsOnPlay;
    const scorers = rows.filter((r) => r.to === 4);
    const voided = outsAfter === 3 && scorers.length && (voidByForce(rows) || ev.runsBeforeTag === false);
    const counted = voided ? [] : scorers;
    const batterOut = isOut(rows.find((r) => r.from === 0));
    const result = ev.result;

    let kind = result;
    if (['FLY', 'LINE'].includes(result) && batterOut && outsBefore < 2 && counted.length && (ev.sf === true || OUTFIELD.includes(ev.pos))) kind = 'SF';
    if (result === 'BUNT' && batterOut && outsBefore < 2 && outsOnPlay === 1 && ev.sac !== false && rows.some((r) => r.from > 0 && !isOut(r) && r.to > r.from)) kind = 'SAC';
    if (outsOnPlay === 2) kind = 'DP';
    if (outsOnPlay >= 3) kind = 'TP';

    let rbi;
    if (typeof ev.rbi === 'number') rbi = ev.rbi;
    else if (NO_RBI_KINDS.includes(kind)) rbi = 0;
    else rbi = counted.filter((r) => !NO_RBI_REASONS.includes(r.reason)).length;

    const fielder = !isUs && ev.result === 'E' ? fielderAt(s, ev.pos) : null;
    const desc = describe(s, ev, kind, fielder);

    if (isUs) {
      const b = bat(s, batter);
      if (AB_KINDS.includes(kind)) b.AB += 1;
      if (HITS[result]) {
        b.H += 1;
        if (result !== '1B') b[result] += 1;
      }
      if (result === 'BB' || result === 'IBB') b.BB += 1;
      if (result === 'IBB') b.IBB += 1;
      if (result === 'HBP') b.HBP += 1;
      if (result === 'K' || result === 'K_REACH') b.K += 1;
      b.RBI += rbi;
      counted.forEach((r) => { bat(s, r.runner).R += 1; });
      rows.forEach((r) => {
        if (r.from === 0) return;
        if (r.reason === '盜壘' && !isOut(r)) bat(s, r.runner).SB += 1;
        if (r.reason === '盜壘失敗') bat(s, r.runner).CS += 1;
      });
    } else {
      const p = pit(s);
      if (p) {
        p.outs += outsOnPlay;
        if (HITS[result]) p.H += 1;
        if (result === 'HR') p.HR += 1;
        if (result === 'BB' || result === 'IBB') p.BB += 1;
        if (result === 'HBP') p.HBP += 1;
        if (result === 'K' || result === 'K_REACH') p.SO += 1;
        p.R += counted.length;
        if (rows.some((r) => r.reason === '暴投')) p.WP += 1;
      }
      if (fielder) bat(s, fielder).E += 1;
      if (result === 'CI') { const c = fielderAt(s, 2); if (c) bat(s, c).E += 1; }
    }

    const bases = [null, null, null];
    rows.forEach((r) => { if (r.to >= 1 && r.to <= 3) bases[r.to - 1] = r.runner; });
    s.bases = bases;
    s.outs = outsAfter;
    if (isUs) { s.score.us += counted.length; s.usNext = (s.usNext + 1) % 9; } else { s.score.opp += counted.length; s.oppNext = (s.oppNext + 1) % 9; }
    h.runs += counted.length;
    h.items.push({
      type: 'pa', slot: batter.slot, number: batter.number, name: batter.name, kind,
      display: displayOf(kind, ev.pos), desc,
      runs: counted.length, voidedRuns: voided ? scorers.length : 0, rbi: isUs ? rbi : null,
      scorers: counted.map((r) => ({ number: r.runner.number, name: runnerName(s, r.runner) })),
      runnersOut: rows.filter((r) => isOut(r) && r.from > 0).map((r) => ({ number: r.runner.number, name: runnerName(s, r.runner) })),
      outsBefore, outsAfter: Math.min(outsAfter, 3),
      bases: outsAfter >= 3 ? [null, null, null] : basesOut(s),
      score: { ...s.score },
    });
    if (outsAfter >= 3) endHalf(s);
  }

  function applyRun(s, ev) {
    const h = curHalf(s);
    const isUs = s.offense === 'us';
    const text = runnerNotes(s, ev.runners, false);
    const rows = ev.runners.map((r) => ({ ...r, runner: s.bases[r.from - 1] }));
    const outs = rows.filter(isOut).length;
    const scored = rows.filter((r) => r.to === 4);
    const bases = s.bases.slice();
    rows.forEach((r) => { bases[r.from - 1] = null; });
    rows.forEach((r) => { if (r.to >= 1 && r.to <= 3) bases[r.to - 1] = r.runner; });
    if (isUs) {
      rows.forEach((r) => {
        if (r.reason === '盜壘' && !isOut(r)) bat(s, r.runner).SB += 1;
        if (r.reason === '盜壘失敗') bat(s, r.runner).CS += 1;
      });
      scored.forEach((r) => { bat(s, r.runner).R += 1; });
      s.score.us += scored.length;
    } else {
      const p = pit(s);
      if (p) {
        p.outs += outs;
        p.R += scored.length;
        if (rows.some((r) => r.reason === '暴投')) p.WP += 1;
      }
      s.score.opp += scored.length;
    }
    h.runs += scored.length;
    s.bases = bases;
    s.outs += outs;
    h.items.push({ type: 'note', text: text + (scored.length ? `（得 ${scored.length} 分）` : '') });
    if (s.outs >= 3) endHalf(s);
  }

  function enter(s, slotIdx, p, pos) {
    const old = s.lineup[slotIdx];
    if (old && !s.removed.includes(old.number)) s.removed.push(old.number);
    s.lineup[slotIdx] = { number: String(p.number), name: p.name || '', pos };
    if (!s.slotHistory[slotIdx].includes(String(p.number))) s.slotHistory[slotIdx].push(String(p.number));
    s.bench = s.bench.filter((b) => b.number !== String(p.number));
    return old;
  }

  function applySub(s, ev) {
    const h = curHalf(s);
    const p = { number: String(ev.in.number), name: ev.in.name || '' };
    let text;
    if (ev.kind === 'PH') {
      const idx = s.usNext;
      const old = enter(s, idx, p, s.lineup[idx].pos === 'DH' ? 'DH' : null);
      text = `更換代打：${old.name}=>${p.name}`;
    } else if (ev.kind === 'PR') {
      const r = s.bases[ev.base - 1];
      const idx = r.slot - 1;
      const old = enter(s, idx, p, s.lineup[idx].pos === 'DH' ? 'DH' : null);
      s.bases[ev.base - 1] = { side: 'us', slot: r.slot, number: p.number, name: p.name };
      text = `更換代跑：${old.name}=>${p.name}`;
    } else if (ev.kind === 'P') {
      if (s.dh) {
        const old = s.pitcher;
        s.removed.push(old.number);
        s.pitcher = p;
        s.bench = s.bench.filter((b) => b.number !== p.number);
        text = `更換投手：${old.name}=>${p.name}`;
      } else {
        const idx = s.lineup.findIndex((x) => x.pos === 'P');
        const old = enter(s, idx, p, 'P');
        text = `更換投手：${old.name}=>${p.name}`;
      }
    } else {
      const idx = ev.slot - 1;
      const pos = ev.pos || s.lineup[idx].pos;
      const old = enter(s, idx, p, pos);
      text = `更換守備：${old.name}=>${p.name}${pos ? '（' + POS_LABEL[pos] + '）' : ''}`;
    }
    h.items.push({ type: 'sub', text });
  }

  function applyPos(s, ev) {
    const h = curHalf(s);
    ev.changes.forEach((c) => { s.lineup[c.slot - 1].pos = c.pos; });
    h.items.push({ type: 'sub', text: `守備調整：${ev.changes.map((c) => `${s.lineup[c.slot - 1].name} 守${POS_LABEL[c.pos]}`).join('、')}` });
  }

  function applyDhOff(s, ev) {
    const h = curHalf(s);
    const pitcher = s.pitcher;
    s.lineup.forEach((x) => { if (x.pos === 'DH') x.pos = null; });
    const old = enter(s, ev.slot - 1, pitcher, 'P');
    s.dh = false;
    s.pitcher = null;
    h.items.push({ type: 'sub', text: `DH 取消：投手 ${pitcher.name} 接第 ${ev.slot} 棒（${old.name} 退場）` });
  }

  function apply(state, ev) {
    const errors = validate(state, ev);
    if (errors.length) throw new Error(errors.join('；'));
    const s = clone(state);
    switch (ev.t) {
      case 'pa': applyPA(s, ev); break;
      case 'run': applyRun(s, ev); break;
      case 'sub': applySub(s, ev); break;
      case 'pos': applyPos(s, ev); break;
      case 'dhOff': applyDhOff(s, ev); break;
      case 'note': curHalf(s).items.push({ type: 'note', text: ev.text || '' }); break;
      case 'end': s.ended = true; break;
      default: break;
    }
    return s;
  }

  function replay(setup, events) {
    let s = newGame(setup);
    (events || []).forEach((ev, i) => {
      try { s = apply(s, ev); } catch (e) { throw new Error(`第 ${i + 1} 筆紀錄：${e.message}`); }
    });
    return s;
  }

  /* ---------- 調度紀錄，給裁判看的寫法：只有背號和守位號碼（例：#21 代打 #17、#12 守 1）----------
     s 是這一筆「套用前」的狀態（用來判斷換下誰）；不是調度的紀錄回傳 null */
  const POS_NUM = Object.fromEntries(Object.entries(NUM_POS).map(([n, c]) => [c, n]));
  function umpireText(s, ev) {
    const num = (c) => POS_NUM[c] || c;
    if (ev.t === 'sub') {
      const n = `#${ev.in.number}`;
      if (ev.kind === 'PH') return `${n} 代打 #${s.lineup[s.usNext].number}`;
      if (ev.kind === 'PR') return `${n} 代跑 #${s.bases[ev.base - 1].number}`;
      if (ev.kind === 'P') { const p = currentPitcher(s); return `${n} 換 #${p ? p.number : '?'}，守 1`; }
      const old = s.lineup[ev.slot - 1];
      return `${n} 換 #${old.number}，守 ${num(ev.pos || old.pos)}`;
    }
    if (ev.t === 'pos') return ev.changes.map((c) => `#${s.lineup[c.slot - 1].number} 守 ${num(c.pos)}`).join('、');
    if (ev.t === 'dhOff') return `DH 取消：#${s.pitcher.number} 打第 ${ev.slot} 棒、守 1，#${s.lineup[ev.slot - 1].number} 退場`;
    return null;
  }

  /* ---------- 雲端備份的表格列（試算表「賽事紀錄_比賽ID」分頁，一筆紀錄一列）----------
     半局標題列：{ type:'half', offense, cells:['一局上','龍安攻','2分',''] }
     紀錄列：    { type:'event', cells:[A,B,C,D], ev }（ev 是原本那一筆，讀回來就能接著記） */
  const SUB_KIND = { PH: '代打', PR: '代跑', P: '換投', DEF: '守備' };
  function scoreNote(runs, rbi) {
    const parts = [];
    if (runs) parts.push(`得 ${runs} 分`);
    if (rbi) parts.push(`打點 ${rbi}`);
    return parts.length ? `（${parts.join('，')}）` : '';
  }
  function eventCells(s, n, ev) {
    const isUs = s.offense === 'us';
    const lastItem = () => { const h = n.halves[n.halves.length - 1]; return h.items[h.items.length - 1]; };
    switch (ev.t) {
      case 'pa': {
        const it = lastItem();
        return [`第${HALF_CN[it.slot]}棒`, it.display, isUs ? `#${it.number} ${it.name}` : 'NA', it.desc + scoreNote(it.runs, it.rbi)];
      }
      case 'run': {
        const reasons = [...new Set(ev.runners.map((r) => r.reason).filter(Boolean))].join('、') || '跑壘';
        const who = ev.runners.map((r) => s.bases[r.from - 1]);
        const runner = !isUs ? 'NA' : who.length === 1 ? `#${who[0].number} ${who[0].name}` : who.map((r) => `#${r.number}`).join('、');
        return ['跑壘', reasons, runner, lastItem().text];
      }
      case 'sub': return ['調度', SUB_KIND[ev.kind], `#${ev.in.number} ${ev.in.name || ''}`.trim(), umpireText(s, ev)];
      case 'pos': return ['調度', '守位', '', umpireText(s, ev)];
      case 'dhOff': return ['調度', 'DH 取消', '', umpireText(s, ev)];
      case 'note': return ['備註', '', '', ev.text || ''];
      case 'end': return ['比賽結束', '', '', `${n.meta.teamName} ${n.score.us}：${n.score.opp} ${n.meta.opponent}`];
      default: return ['', '', '', ''];
    }
  }
  function sheetRows(setup, events) {
    const rows = [];
    const heads = [];
    let s = newGame(setup);
    (events || []).forEach((ev, i) => {
      let n;
      try { n = apply(s, ev); } catch (e) { throw new Error(`第 ${i + 1} 筆紀錄：${e.message}`); }
      const last = heads[heads.length - 1];
      if (ev.t !== 'end' && (!last || last.inning !== s.inning || last.top !== s.top)) {
        const team = s.offense === 'us' ? s.meta.teamName : s.meta.opponent;
        const head = { type: 'half', offense: s.offense, cells: [`${HALF_CN[s.inning] || s.inning}局${s.top ? '上' : '下'}`, `${team}攻`, '', ''] };
        heads.push({ inning: s.inning, top: s.top, row: head });
        rows.push(head);
      }
      rows.push({ type: 'event', cells: eventCells(s, n, ev), ev: clone(ev) });
      s = n;
    });
    // 半局得分要等整串重算完才知道
    heads.forEach((h) => {
      const half = s.halves.find((x) => x.inning === h.inning && x.top === h.top);
      h.row.cells[2] = `${half ? half.runs : 0}分`;
    });
    return rows;
  }

  /* ---------- 產出賽事成績資料（data/games/<比賽ID>.json）---------- */
  function toGame(setup, events, opts = {}) {
    const s = replay(setup, events);
    const batting = [];
    const listed = new Set();
    s.slotHistory.forEach((nums, i) => {
      nums.forEach((num) => {
        if (listed.has(num)) return;
        listed.add(num);
        const row = s.stats.batting[num] || bat(clone(s), { number: num, name: (s.lineup.find((p) => p.number === num) || {}).name });
        const name = row.name || findName(setup, num);
        batting.push({ slot: i + 1, ...row, name, appeared: true });
      });
    });
    const pitching = s.stats.pitchOrder.map((num) => {
      const p = s.stats.pitching[num];
      return { ...p, IP: `${Math.floor(p.outs / 3)}.${p.outs % 3}` };
    });
    return {
      id: setup.id, date: setup.date, gameNum: setup.gameNum, opponent: setup.opponent, teamName: setup.teamName || '龍安',
      generatedAt: opts.generatedAt || new Date().toISOString(),
      score: { ...s.score },
      halves: s.halves.map((h) => ({ inning: h.inning, top: h.top, offense: h.offense, label: h.label, runs: h.runs, items: h.items })),
      batting, pitching, pitchingStatus: 'complete', source: 'game-record',
    };
  }
  function findName(setup, num) {
    const all = [...(setup.lineup || []), ...(setup.bench || []), ...(setup.pitcher ? [setup.pitcher] : [])];
    const p = all.find((x) => String(x.number) === num);
    return p ? p.name : '';
  }

  const api = {
    newGame, apply, validate, replay, defaults, buildPA, fieldingProblems, currentPitcher, toGame, displayOf, umpireText, sheetRows,
    FIELD, POS_LABEL, ON_RESULTS, OUT_RESULTS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GameCore = api;
})(this);
