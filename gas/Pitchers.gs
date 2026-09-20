// ==========================================================================
// 龍安棒球隊 - 投手名單整理模組 (Pitchers.gs)
// 放法：Apps Script 編輯器 ＋ → 指令碼 → 命名為 Pitchers，整份貼上。
//
// 為什麼要有這支：DH 制下，先發投手／後援投手不在打序裡，
// 只掃 activeLineup 找 pos==='P' 會抓不到。前端上傳時已經附上整理好的 data.pitchers，
// 這裡優先使用它；舊版前端沒帶 pitchers 時，才退回掃打序的做法。
// ==========================================================================

/**
 * @param {Object} data doPost 收到的 payload
 * @return {Array<{number:string,name:string,posLabel:string,role:string,note:string}>} 依上場順序、同一人只出現一次
 */
function resolvePitchers_(data) {
  var raw = [];

  if (data && Array.isArray(data.pitchers) && data.pitchers.length > 0) {
    raw = data.pitchers.slice();
  } else {
    raw = pitchersFromLineup_(data);
  }

  var seen = {};
  var result = [];
  for (var i = 0; i < raw.length; i++) {
    var p = raw[i] || {};
    var name = String(p.name || '').replace(/^↳\s*/, '').trim();
    var number = String(p.number == null ? '' : p.number).trim();
    if (!name) continue;
    var key = number + '_' + name;
    if (seen[key]) continue;
    seen[key] = true;
    result.push({
      number: number,
      name: name,
      posLabel: String(p.posLabel || p.pos || 'P (1)'),
      role: result.length === 0 ? '先發' : '後援',
      note: result.length === 0 ? (p.reason || '先發投手') : (p.reason || '比賽中更換投手')
    });
  }
  return result;
}

// 舊版相容：從打序裡找守位是 P 的人（嚴格比對，不會把 PH/PR 算進來）
function pitchersFromLineup_(data) {
  var out = [];
  var slots = (data && (data.activeLineup || null)) || null;

  if (Array.isArray(slots)) {
    var events = [];
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i] || {};
      if (isPitcherPos_(slot.starter)) {
        events.push({ p: slot.starter, t: 0, order: i });
      }
      var subs = slot.substitutes || [];
      for (var j = 0; j < subs.length; j++) {
        if (isPitcherPos_(subs[j])) {
          events.push({ p: subs[j], t: subs[j].timestamp || (1e15 + i * 100 + j), order: i });
        }
      }
    }
    events.sort(function (a, b) { return a.t - b.t || a.order - b.order; });
    for (var k = 0; k < events.length; k++) out.push(events[k].p);
    return out;
  }

  var starters = (data && (data.lineup || data.starters)) || [];
  for (var s = 0; s < starters.length; s++) {
    if (isPitcherPos_(starters[s])) out.push(starters[s]);
  }
  return out;
}

// 守位是不是投手 P：pos 完全等於 P，或 posLabel 第一段是 P（避免 PH/PR 被誤判）
function isPitcherPos_(p) {
  if (!p) return false;
  if (String(p.pos || '').trim() === 'P') return true;
  return String(p.posLabel || '').trim().split(/\s+/)[0] === 'P';
}
