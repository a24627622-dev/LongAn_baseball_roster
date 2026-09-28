/* 龍安棒球隊 比賽文字紀錄轉換引擎
   規則見 docs/文字記錄簡碼字典.md（v2）。網頁（/tools/ 轉換頁、公開文字轉播頁）與 Node 測試共用這一份。

   輸入：記錄員的文字紀錄 ＋ 陣容（打序、換人；來自陣容調度工具上傳的試算表）
   輸出：每個半局的文字轉播資料、打者成績、投手成績、⚠️ 清單

   原則：
   - 規則式解析，不用 AI。描述文字原樣保留，只認「打者」「結果符號」「[N分進帳]」「➔ 狀態」
   - 跑者位置、得分者、打點由程式推算；記錄員寫了 ➔ 狀態就以它為準，並檢查推算是否說得通
   - 看不懂或對不上的地方一律列進 warnings，絕不默默略過 */
(function (root) {
  const POS_CHAR = { 1: '投', 2: '捕', 3: '一', 4: '二', 5: '三', 6: '游', 7: '左', 8: '中', 9: '右' };
  const CHAR_POS = { 投: 1, 捕: 2, 一: 3, 二: 4, 三: 5, 游: 6, 左: 7, 中: 8, 右: 9 };
  const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
  const BASE_CN = { 一: 1, 二: 2, 三: 3, 本: 4 };

  /* ---------- 結果符號 ---------- */
  // 同一段文字裡最早出現的符號當結果；同一個位置有多個符號時，依這個順序（K+PB 要排在 K 前面）
  const RESULT_PATTERNS = [
    { re: /K\s*\+\s*(PB|WP)/, kind: 'K_REACH' },
    { re: /IBB|故意四壞/, kind: 'IBB' },
    { re: /HBP|觸身|死球/, kind: 'HBP' },
    { re: /\bBB\b|四壞|保送/, kind: 'BB' },
    { re: /\bSF\s*(\d)?|犧飛|高飛犧牲/, kind: 'SF' },
    { re: /\bSAC\b|犧觸|犧牲觸擊/, kind: 'SAC' },
    { re: /\bHR\b|全壘打|全打/, kind: 'HR' },
    { re: /\b3B\b|三安|三壘安打/, kind: '3B' },
    { re: /\b2B\b|二安|二壘安打/, kind: '2B' },
    { re: /\b1B\b|一安|內安|內野安打|一壘安打/, kind: '1B' },
    { re: /\b(\d)(?:-\d)+\s*DP\b|\bDP\b|雙殺/, kind: 'DP' },
    { re: /\bE\s*(\d)\b|([投捕一二三游左中右])失(?!誤)/, kind: 'E' },
    { re: /\bFC\s*(\d)?|野選/, kind: 'FC' },
    { re: /\bFF\s*(\d)\b|界飛/, kind: 'FOUL_FLY' },
    { re: /\b[FLP]\s*(\d)\b|([投捕一二三游左中右])飛/, kind: 'FLY' },
    { re: /\b(\d)(?:-\d)+\b|\b(\d)U\b|([投捕一二三游])滾/, kind: 'GROUND' },
    { re: /ꓘ|見振/, kind: 'K' },
    { re: /\bK\b|三振/, kind: 'K' },
  ];
  const EVENT_PATTERNS = [
    { re: /\bSB\b|盜壘成功|盜上/, kind: 'SB' },
    { re: /\bCS\b|盜壘失敗/, kind: 'CS' },
    { re: /\bWP\b|暴投/, kind: 'WP' },
    { re: /\bPB\b|捕逸/, kind: 'PB' },
    { re: /\bBK\b|投手犯規/, kind: 'BK' },
  ];

  const AB_KINDS = new Set(['1B', '2B', '3B', 'HR', 'K', 'K_REACH', 'GROUND', 'FLY', 'FOUL_FLY', 'DP', 'E', 'FC', 'OUT']);
  const HIT_KINDS = { '1B': 1, '2B': 2, '3B': 3, HR: 4 };
  const BATTER_OUT_KINDS = new Set(['K', 'GROUND', 'FLY', 'FOUL_FLY', 'DP', 'SF', 'SAC', 'OUT']);

  function posOf(m) {
    // 從符號的比對結果取出守位號碼（數字或中文守位字）
    for (let i = 1; i < m.length; i++) {
      if (!m[i]) continue;
      if (/^\d$/.test(m[i])) return Number(m[i]);
      if (CHAR_POS[m[i]]) return CHAR_POS[m[i]];
    }
    const first = /(\d)/.exec(m[0]);
    return first ? Number(first[1]) : null;
  }

  function displayOf(kind, pos, line) {
    switch (kind) {
      case '1B': return '一安';
      case '2B': return '二安';
      case '3B': return '三安';
      case 'HR': return '全打';
      case 'BB': return '四壞';
      case 'IBB': return '故意四壞';
      case 'HBP': return '死球';
      case 'K': case 'K_REACH': return '三振';
      case 'SF': return '犧飛';
      case 'SAC': return '犧觸';
      case 'DP': return '雙殺';
      case 'FC': return '野選';
      case 'FOUL_FLY': return '界飛';
      case 'E': return (POS_CHAR[pos] || '') + '失';
      case 'FLY': return (POS_CHAR[pos] || '') + '飛';
      case 'GROUND': return (POS_CHAR[pos] || '') + '滾';
      case 'OUT': return '出局';
      default: return kind;
    }
  }

  /* 一段文字裡的打席結果：最早出現的符號 */
  function findResult(text) {
    let best = null;
    RESULT_PATTERNS.forEach((p, order) => {
      const m = p.re.exec(text);
      if (!m) return;
      if (!best || m.index < best.index || (m.index === best.index && order < best.order)) {
        best = { kind: p.kind, index: m.index, order, match: m };
      }
    });
    if (!best) {
      // 不知道守位的出局：只寫「出局」或 OUT。只在找不到其他符號時才用，
      // 避免「三振出局」「封殺出局」這種描述被誤認
      const m = /\bOUT\b|出局|刺殺/.exec(text);
      return m ? { kind: 'OUT', pos: null, token: m[0] } : null;
    }
    return { kind: best.kind, pos: posOf(best.match), token: best.match[0] };
  }

  /* 一小段文字裡有哪些事件。同一種事件在同一小段只算一次（「#39 SB 盜上二壘」的 SB 和盜上是同一次盜壘）；
     一次寫兩個不同事件（「PB+WP」）就算兩個 */
  function findEvents(text) {
    const t = text.replace(/K\s*\+\s*(PB|WP)/g, ''); // 不死三振的 PB／WP 算在打席結果裡
    const out = [];
    EVENT_PATTERNS.forEach((p) => {
      const m = p.re.exec(t);
      if (m) out.push({ kind: p.kind, index: m.index });
    });
    return out;
  }

  /* ---------- 狀態：「2 Outs, 1B/2B」「滿壘」 ---------- */
  const STATE_RE = /^\s*(\d)\s*Outs?\b\s*[,，]?\s*(.*)$/i;
  function parseState(s) {
    const m = STATE_RE.exec(s);
    if (!m) return null;
    const rest = m[2] || '';
    let bases = [];
    if (/滿壘/.test(rest)) bases = [1, 2, 3];
    else {
      const re = /([123])B/g;
      let b;
      while ((b = re.exec(rest))) bases.push(Number(b[1]));
      bases = [...new Set(bases)].sort();
    }
    return { outs: Number(m[1]), bases };
  }

  /* ---------- 陣容 ---------- */
  function normalizeLineup(lineup) {
    // { slots: [{ starter: {number,name,pos}, subs: [{number,name,pos}] }], pitchers: [{number,name}] }
    const slots = (lineup && lineup.slots) || [];
    return {
      slots: slots.map((s) => ({
        starter: s.starter ? { number: String(s.starter.number), name: s.starter.name || '', pos: s.starter.pos || '' } : null,
        subs: (s.subs || []).map((p) => ({ number: String(p.number), name: p.name || '', pos: p.pos || '' })),
      })),
      pitchers: ((lineup && lineup.pitchers) || []).map((p) => ({ number: String(p.number), name: p.name || '' })),
    };
  }

  function parse(text, options = {}) {
    const teamName = options.teamName || '龍安';
    const lineup = normalizeLineup(options.lineup);
    const playerInfo = {};
    (options.players || []).forEach((p) => { playerInfo[String(p.number)] = p; });
    lineup.slots.forEach((s) => [s.starter, ...s.subs].forEach((p) => {
      if (p && !playerInfo[p.number]) playerInfo[p.number] = { number: p.number, name: p.name };
    }));
    const nickToNumber = {};
    Object.values(playerInfo).forEach((p) => { if (p.nickname) nickToNumber[String(p.nickname).toLowerCase()] = String(p.number); });

    const warnings = [];
    const warn = (where, msg) => warnings.push({ where, msg });
    const nameOf = (num) => (playerInfo[num] ? playerInfo[num].name : '') || `#${num}`;

    // ---- 目前場上的打序（每一棒現在是誰）----
    const current = lineup.slots.map((s) => (s.starter ? s.starter.number : null));
    const slotOf = (num) => current.findIndex((n) => n === num);

    // ---- 成績 ----
    const batting = {}; // key: 背號
    const bat = (num) => (batting[num] = batting[num] || { number: num, name: nameOf(num), AB: 0, R: 0, H: 0, '2B': 0, '3B': 0, HR: 0, RBI: 0, BB: 0, IBB: 0, HBP: 0, K: 0, SB: 0, CS: 0 });
    const pitching = {};
    const pit = (num) => (pitching[num] = pitching[num] || { number: num, name: nameOf(num), outs: 0, H: 0, R: 0, BB: 0, HBP: 0, SO: 0, HR: 0, WP: 0, unrecordedHalves: 0 });
    let ourPitcher = (lineup.pitchers[0] && lineup.pitchers[0].number) || null;
    if (!ourPitcher) {
      const sp = lineup.slots.find((s) => s.starter && /^P\b|^P\s*\(/.test(s.starter.pos));
      if (sp) ourPitcher = sp.starter.number;
    }

    const halves = [];
    let half = null;
    let nextSlot = 0; // 下一位打者應該是第幾棒（0 起算）
    let score = { us: 0, opp: 0 };

    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');

    function closeHalf() {
      if (!half) return;
      const sum = half.items.filter((i) => i.type === 'pa').reduce((a, i) => a + i.runs, 0) + half.eventRunsOutsidePA;
      if (half.headerRuns !== null && half.headerRuns !== sum) {
        warn(half.label, `標題寫得分 ${half.headerRuns}，逐行加總是 ${sum}`);
      }
      half.runs = sum;
      if (!half.unrecorded && half.outs < 3 && !half.isLast) {
        warn(half.label, `這個半局只記到 ${half.outs} 個出局`);
      }
    }

    for (const raw of lines) {
      // ---- 半局標題 ----
      const h = /^([一二三四五六七八九十]+|\d+)局(上|下)\s*[｜|]\s*(.+?)攻(.*)$/.exec(raw);
      if (h) {
        closeHalf();
        const inning = CN_NUM[h[1]] || Number(h[1]);
        const us = h[3].includes(teamName);
        const hr = /得分\s*[:：]\s*(\d+)/.exec(h[4]);
        half = {
          inning, top: h[2] === '上', offense: us ? 'us' : 'opp', label: `${h[1]}局${h[2]}`,
          headerRuns: hr ? Number(hr[1]) : null, items: [], outs: 0, bases: [null, null, null, null],
          unrecorded: false, eventRunsOutsidePA: 0, isLast: false,
        };
        halves.push(half);
        continue;
      }
      if (!half) { warn(raw.slice(0, 20), '在第一個半局標題之前出現，無法判斷是哪一局，已略過'); continue; }
      const where = `${half.label} ${raw.slice(0, 24)}`;

      if (/^未記錄/.test(raw)) { half.unrecorded = true; half.items.push({ type: 'note', text: '未記錄' }); continue; }

      // ---- 換投 ----
      if (/更換投手/.test(raw)) {
        const m = /#(\d+)/.exec(raw);
        if (half.offense === 'opp' && m) {
          ourPitcher = m[1];
          half.items.push({ type: 'sub', kind: 'pitcher', text: `更換投手：${nameOf(m[1])}`, number: m[1] });
        } else {
          half.items.push({ type: 'sub', kind: 'oppPitcher', text: raw.replace(/^[^更]*更換投手/, '對手更換投手') });
        }
        continue;
      }

      // ---- 守備替補：「#55 替補 #2 守左外野」----
      const d = /^#(\d+)\s*替補\s*#(\d+)(.*)$/.exec(raw);
      if (d) {
        const idx = slotOf(d[2]);
        if (idx < 0) warn(where, `#${d[2]} 目前不在打序裡，無法被替補`);
        else {
          current[idx] = d[1];
          checkSubInLineup(idx, d[1], where);
          half.items.push({ type: 'sub', kind: 'defense', text: `更換守備：${nameOf(d[2])}=>${nameOf(d[1])}${d[3].trim() ? '（' + d[3].trim() + '）' : ''}`, slot: idx + 1 });
        }
        continue;
      }

      // ---- 打者行 ----
      const pa = /^(?:#(\d+)|(\d+)\s*棒)\s*(?:[（(]\s*(代打)\s*[)）])?\s*[：:]\s*(.*)$/.exec(raw);
      if (!pa) { warn(where, '看不懂這一行（不是半局標題、打者行或換人），已略過'); continue; }
      handlePA(pa, raw, where);
    }
    if (halves.length) halves[halves.length - 1].isLast = true;
    closeHalf();

    function checkSubInLineup(idx, num, where) {
      if (!lineup.slots.length) return;
      const s = lineup.slots[idx];
      const known = s && ((s.starter && s.starter.number === num) || s.subs.some((p) => p.number === num));
      if (!known) warn(where, `陣容調度紀錄的第 ${idx + 1} 棒沒有 #${num}，請確認換人是否已上傳`);
    }

    function handlePA(pa, raw, where) {
      const isUs = half.offense === 'us';
      let batterNum = null;
      let slotIdx = null;

      if (isUs) {
        if (pa[1]) {
          batterNum = pa[1];
          if (pa[3]) {
            // 代打：接替「應該輪到的那一棒」
            slotIdx = nextSlot;
            const prev = current[slotIdx];
            current[slotIdx] = batterNum;
            checkSubInLineup(slotIdx, batterNum, where);
            half.items.push({ type: 'sub', kind: 'PH', text: `更換代打：${nameOf(prev)}=>${nameOf(batterNum)}`, slot: slotIdx + 1 });
          } else {
            slotIdx = slotOf(batterNum);
            if (slotIdx < 0 && lineup.slots.length) {
              warn(where, `#${batterNum} 不在目前的打序裡（換人沒記到？），先當作第 ${nextSlot + 1} 棒`);
              slotIdx = nextSlot;
              current[slotIdx] = batterNum;
            } else if (slotIdx < 0) {
              slotIdx = nextSlot;
              current[slotIdx] = batterNum;
            }
          }
        } else {
          slotIdx = Number(pa[2]) - 1;
          batterNum = current[slotIdx];
          if (!batterNum) warn(where, `找不到第 ${slotIdx + 1} 棒是誰（沒有陣容資料）`);
        }
        if (slotIdx !== nextSlot && lineup.slots.length) {
          warn(where, `打序不對：這時應該輪到第 ${nextSlot + 1} 棒（${nameOf(current[nextSlot])}），紀錄寫的是第 ${slotIdx + 1} 棒（${nameOf(batterNum)}）`);
        }
        nextSlot = (slotIdx + 1) % 9;
      } else if (pa[2]) {
        slotIdx = Number(pa[2]) - 1; // 對手只記棒次（顯示「雨人 第N棒」用）
      }

      const loadedBefore = isUs && [1, 2, 3].every((b) => half.bases[b]); // 四壞、觸身只有滿壘時才有打點
      const body = pa[4];
      // ---- 切段：最後一個 ➔ 後面若是狀態就當狀態 ----
      let segs = body.split(/➔|→|->/).map((s) => s.trim());
      let state = null;
      const last = segs[segs.length - 1];
      const st = parseState(last);
      if (st && segs.length > 1) {
        state = st;
        segs = segs.slice(0, -1);
        if (/比賽結束/.test(last)) half.isLast = true;
      }

      // ---- 每一段：結果、事件、得分 ----
      let result = null;
      let resultSeg = -1;
      let eventRuns = 0;
      let paRuns = 0;
      const events = [];
      segs.forEach((seg, i) => {
        const inParen = [];
        const main = seg.replace(/[（(]([^）)]*)[)）]/g, (_, c) => { inParen.push(c); return ' '; });
        const r = findResult(main.replace(/\[[^\]]*\]/g, ' '));
        const runsM = /\[\s*(\d+)\s*分/.exec(seg) || /(\d+)\s*分進帳/.exec(seg);
        const runs = runsM ? Number(runsM[1]) : 0;
        findEvents(main).forEach((e) => events.push({ ...e, seg: i, text: seg }));
        inParen.forEach((c) => findEvents(c).forEach((e) => events.push({ ...e, seg: i, text: c })));
        if (r) {
          if (result) warn(where, `一行出現兩個打席結果（${result.token}、${r.token}），以後面的為準`);
          result = r;
          resultSeg = i;
          paRuns += runs;
        } else {
          eventRuns += runs;
        }
      });
      // 結果那一段之後的事件得分（例：保送後暴投回本壘）也不算打點；上面已經歸到 eventRuns

      if (!result) {
        warn(where, '找不到打席結果符號（例：1B、K、4-3、F9、BB），這一行沒有計入成績');
        half.items.push({ type: 'pa', unparsed: true, raw, number: batterNum, slot: slotIdx === null ? null : slotIdx + 1, runs: eventRuns + paRuns, desc: body });
        return;
      }

      const kind = result.kind;
      const fullText = body;
      const hasError = /\bE\s*\d\b|[投捕一二三游左中右]失(?!誤)|暴傳|失誤/.test(fullText) && kind !== 'E';
      let batterDest = 0; // 0 = 出局、1～3 = 壘、4 = 回本壘
      if (HIT_KINDS[kind]) batterDest = HIT_KINDS[kind];
      else if (['BB', 'IBB', 'HBP', 'E', 'FC', 'K_REACH'].includes(kind)) batterDest = 1;
      const safeM = /打者(?:安全)?上([一二三])壘/.exec(fullText);
      if (safeM) batterDest = BASE_CN[safeM[1]];
      const batterOut = batterDest === 0 && BATTER_OUT_KINDS.has(kind);
      // 跑者出局（封殺、觸殺）：從描述判斷
      const forceM = /(?:([一二三])壘跑者[^，。]*?|([二三本])壘)(封殺|觸殺)/.exec(fullText);
      let textRunnerOuts = forceM ? 1 : 0;
      if (kind === 'DP') textRunnerOuts = Math.max(textRunnerOuts, 1);

      const totalRuns = eventRuns + paRuns;
      const outsBefore = half.outs;
      const codeOuts = (batterOut ? 1 : 0) + textRunnerOuts;
      let outsAfter = outsBefore + codeOuts;
      if (state) {
        if (state.outs !== outsAfter) {
          warn(where, `出局數：依結果推算是 ${outsAfter} 出局，紀錄寫 ${state.outs} 出局，以紀錄為準`);
        }
        outsAfter = state.outs;
      }

      let scorers = [];
      let runnerOutNums = [];
      const afterItems = []; // 打完這一球才發生的換人（代跑），接在打席後面顯示
      if (isUs) {
        // ---- 跑者推算（只有龍安進攻需要知道「誰」）----
        const runners = [3, 2, 1].filter((b) => half.bases[b]).map((b) => ({ num: half.bases[b], from: b }));
        const lead = batterDest > 0 ? [...runners, { num: batterNum, from: 0, batter: true }] : runners.slice();
        let runnerOuts = outsAfter - outsBefore - (batterOut ? 1 : 0);
        if (runnerOuts < 0) runnerOuts = 0;
        // 誰出局：描述寫了「一壘跑者」「二壘封殺」就用它，否則當作最靠近打者的跑者（封殺的常態）
        for (let k = 0; k < runnerOuts; k++) {
          let idx = -1;
          if (forceM && k === 0) {
            const fromBase = forceM[1] ? BASE_CN[forceM[1]] : BASE_CN[forceM[2]] - 1;
            idx = lead.findIndex((r) => !r.batter && r.from === fromBase);
          }
          if (idx < 0) {
            const cand = lead.map((r, i) => ({ r, i })).filter((x) => !x.r.batter);
            if (cand.length > 1 && !forceM) warn(where, '有跑者出局但看不出是哪一位，先當作最靠近打者的跑者');
            if (cand.length) idx = cand[cand.length - 1].i;
          }
          if (idx >= 0) runnerOutNums.push(lead.splice(idx, 1)[0].num);
          else warn(where, '出局數比推算的多，但壘上沒有跑者可以出局');
        }
        // 明確寫了誰回本壘：（#17、#93 回本壘）
        const named = /((?:#\d+\s*[、,，]?\s*)+)回本壘/.exec(fullText);
        if (named) {
          const nums = (named[1].match(/#(\d+)/g) || []).map((x) => x.slice(1));
          scorers = nums.filter((n) => lead.some((r) => r.num === n));
          if (scorers.length !== totalRuns) warn(where, `寫了 ${totalRuns} 分，但指名回本壘的是 ${nums.length} 位`);
          nums.forEach((n) => { const i = lead.findIndex((r) => r.num === n); if (i >= 0) lead.splice(i, 1); });
        } else {
          if (totalRuns > lead.length) {
            warn(where, `寫了 ${totalRuns} 分，但壘上加打者只有 ${lead.length} 人`);
          }
          scorers = lead.splice(0, Math.min(totalRuns, lead.length)).map((r) => r.num);
        }
        // 剩下的人放上壘包
        const newBases = [null, null, null, null];
        if (state && state.outs >= 3) {
          // 三出局：壘上的人是殘壘，記錄員通常不寫壘包，不核對
        } else if (state) {
          const occ = state.bases.slice().sort((a, b) => b - a);
          if (occ.length !== lead.length) {
            warn(where, `壘包：推算壘上應該有 ${lead.length} 人，紀錄寫 ${occ.length} 人（${state.bases.map((b) => b + 'B').join('/') || '無人'}），請確認得分或出局有沒有記錯`);
          }
          lead.forEach((r, i) => {
            const b = occ[i];
            if (b === undefined) return;
            if (b < r.from || (r.batter && b < batterDest)) warn(where, `${nameOf(r.num)} 從 ${r.from || '本'}壘退回 ${b} 壘，不合理`);
            newBases[b] = r.num;
          });
        } else {
          // 沒寫狀態：打者到應到的壘，跑者只做被迫的推進
          let floor = 0;
          for (let i = lead.length - 1; i >= 0; i--) {
            const r = lead[i];
            let b = r.batter ? batterDest : Math.max(r.from, floor + 1);
            if (b <= floor) b = floor + 1;
            if (b >= 4) { scorers.push(r.num); warn(where, `${nameOf(r.num)} 被擠回本壘，但紀錄沒寫得分`); continue; }
            newBases[b] = r.num;
            floor = b;
          }
        }
        half.bases = newBases;

        // ---- 代跑：「（二壘跑者 #17 更換代跑 #5）」，暱稱也可以：「更換代跑 Haowei」----
        const prRe = /([一二三])壘跑者\s*(?:#(\d+))?[^更]*?更換代跑\s*(?:#(\d+)|([^\s)），。]+))/g;
        let prM;
        while ((prM = prRe.exec(fullText))) {
          const base = BASE_CN[prM[1]];
          const newNum = prM[3] || nickToNumber[String(prM[4] || '').toLowerCase()];
          if (!newNum) { warn(where, `代跑「${prM[4]}」對不到背號（名單裡沒有這個暱稱），請改寫成 #背號`); continue; }
          const oldNum = half.bases[base];
          if (!oldNum) { warn(where, `${prM[1]}壘上沒有跑者，無法更換代跑`); continue; }
          if (prM[2] && prM[2] !== oldNum) warn(where, `寫的是 #${prM[2]}，但推算${prM[1]}壘跑者是 ${nameOf(oldNum)}`);
          const idx = slotOf(oldNum);
          if (idx >= 0) { current[idx] = newNum; checkSubInLineup(idx, newNum, where); }
          half.bases[base] = newNum;
          afterItems.push({ type: 'sub', kind: 'PR', text: `更換代跑：${nameOf(oldNum)}=>${nameOf(newNum)}`, slot: idx + 1 });
        }
      }
      half.outs = outsAfter;

      // ---- 盜壘 ----
      events.filter((e) => e.kind === 'SB' || e.kind === 'CS').forEach((e) => {
        const m = /#(\d+)/.exec(e.text);
        if (isUs) {
          if (m) bat(m[1])[e.kind] += 1;
          else warn(where, `${e.kind === 'SB' ? '盜壘' : '盜壘失敗'}沒寫是誰（例：#39 SB），沒有計入`);
        }
      });

      // ---- 打點 ----
      let rbi;
      const rbiM = /打點\s*(\d+)/.exec(fullText);
      if (rbiM) rbi = Number(rbiM[1]);
      else if (kind === 'E' || hasError || kind === 'DP' || kind === 'K_REACH') rbi = 0;
      else if (['BB', 'IBB', 'HBP'].includes(kind)) rbi = loadedBefore && totalRuns > 0 ? 1 : 0;
      else rbi = paRuns;

      // ---- 記成績 ----
      if (isUs && batterNum) {
        const b = bat(batterNum);
        if (AB_KINDS.has(kind)) b.AB += 1;
        if (HIT_KINDS[kind]) {
          b.H += 1;
          if (kind === '2B') b['2B'] += 1;
          if (kind === '3B') b['3B'] += 1;
          if (kind === 'HR') b.HR += 1;
        }
        if (kind === 'BB' || kind === 'IBB') b.BB += 1;
        if (kind === 'IBB') b.IBB += 1;
        if (kind === 'HBP') b.HBP += 1;
        if (kind === 'K' || kind === 'K_REACH') b.K += 1;
        b.RBI += rbi;
        scorers.forEach((n) => { bat(n).R += 1; });
      }
      if (!isUs && ourPitcher) {
        const p = pit(ourPitcher);
        p.outs += outsAfter - outsBefore;
        if (HIT_KINDS[kind]) p.H += 1;
        if (kind === 'HR') p.HR += 1;
        if (kind === 'BB' || kind === 'IBB') p.BB += 1;
        if (kind === 'HBP') p.HBP += 1;
        if (kind === 'K' || kind === 'K_REACH') p.SO += 1;
        p.R += totalRuns;
        p.WP += events.filter((e) => e.kind === 'WP').length + (/K\s*\+\s*WP/.test(fullText) ? 1 : 0);
      }

      if (isUs) score.us += totalRuns; else score.opp += totalRuns;
      const sc = new RegExp(teamName + '\\s*(\\d+)\\s*[:：]\\s*(\\d+)').exec(fullText);
      if (sc) {
        if (Number(sc[1]) !== score.us || Number(sc[2]) !== score.opp) {
          warn(where, `比分：推算是 ${teamName} ${score.us}:${score.opp}，紀錄寫 ${sc[1]}:${sc[2]}`);
        }
      }

      half.items.push({
        type: 'pa',
        slot: slotIdx === null ? null : slotIdx + 1,
        number: batterNum,
        name: batterNum ? nameOf(batterNum) : '',
        kind,
        display: displayOf(kind, result.pos, fullText),
        // 顯示用：拿掉記錄用的標記（[N分進帳，比分]、打點N），得分者、打點、比分另外顯示
        desc: body.split(/➔|→|->/).slice(0, state ? -1 : undefined).join(' ➔ ')
          .replace(/\[[^\]]*\]/g, ' ').replace(/打點\s*\d+/g, ' ').replace(/\s+/g, ' ').trim(),
        raw,
        runs: totalRuns,
        rbi: isUs ? rbi : null,
        scorers: scorers.map((n) => ({ number: n, name: nameOf(n) })),
        runnersOut: runnerOutNums.map((n) => ({ number: n, name: nameOf(n) })),
        outsBefore,
        outsAfter,
        bases: isUs ? half.bases.slice(1).map((n) => (n ? { number: n, name: nameOf(n) } : null)) : null,
        score: { ...score },
      });
      afterItems.forEach((it) => half.items.push(it));
    }

    // ---- 整理打者成績：依打序，先發在前、替補依上場順序 ----
    const battingRows = [];
    const listed = new Set();
    lineup.slots.forEach((s, i) => {
      [s.starter, ...s.subs].filter(Boolean).forEach((p) => {
        if (listed.has(p.number)) return;
        listed.add(p.number);
        battingRows.push({ slot: i + 1, ...(batting[p.number] || bat(p.number)) });
      });
    });
    Object.keys(batting).forEach((num) => {
      if (listed.has(num)) return;
      warn(`#${num}`, '有成績但不在陣容調度紀錄裡');
      battingRows.push({ slot: null, ...batting[num] });
    });

    // ---- 投手 ----
    halves.filter((hv) => hv.offense === 'opp' && hv.unrecorded).forEach(() => {
      if (ourPitcher) pit(ourPitcher).unrecordedHalves += 1;
    });
    const oppHalves = halves.filter((hv) => hv.offense === 'opp');
    const pitchingRows = Object.values(pitching).map((p) => ({
      ...p,
      IP: `${Math.floor(p.outs / 3)}.${p.outs % 3}`,
    }));
    const pitchingStatus = oppHalves.length === 0 ? 'unrecorded' : (oppHalves.some((hv) => hv.unrecorded) ? 'partial' : 'complete');
    if (pitchingStatus === 'unrecorded') warn('投手成績', '紀錄裡沒有對手的半局，投手成績無法自動算，請人工填');

    return { halves, batting: battingRows, pitching: pitchingRows, pitchingStatus, score, warnings };
  }

  const api = { parse, findResult, parseState, displayOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RecordEngine = api;
})(this);
