// ==========================================
// LINE「龍安虛擬球隊經理」（V01.14.00）：群組裡打「#關鍵字」，回覆時程、公告、戰績、球員成績
// - 只處理「#」（或全形「＃」）開頭的文字訊息，其他訊息不理、不記錄；回覆用 reply（不計入推播則數）
// - 資料一律讀官網的資料檔（時程、公告、球員名單、球場資訊、賽事成績），和官網同步，不另外維護
// - 戰績、球員成績用 season-stats.js（部署時貼成 SeasonStats.gs，和官網戰績頁同一套算法）
// - 指令碼屬性：LINE_CHANNEL_ACCESS_TOKEN（必填）、CWA_API_KEY（氣象署，沒有就不顯示天氣）、
//   LINE_SITE_URL（官網網址，可省略）
// - GAS 讀不到 LINE 附在請求上的簽章：機器人只回答官網上本來就公開的資訊，假冒的請求也拿不到能回覆群組的 replyToken
// 測試：tests/test_line.js
// ==========================================
var LINE_SITE_DEFAULT = 'https://longan-baseball.pages.dev';   // 2026-10-24 搬到 Cloudflare Pages
var LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
var LINE_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
var LINE_INTRO = '大家好，我是龍安虛擬球隊經理 ⚾\n我可以回答比賽、練球、戰績、球員成績等問題，打「#說明」看用法。\n我只處理「#」開頭的訊息，其他聊天內容不會記錄。';
var LINE_HELP = [
  '⚾ 龍安虛擬球隊經理 使用說明',
  '#下一場　下一場比賽的時間、地點',
  '#練球　下一次練球的時間、地點',
  '#公告　最新一則公告',
  '#戰績　本季戰績',
  '#上一場　上一場比賽的比分',
  '#陳奕瑋　球員本季成績（也可以打背號 #5 或暱稱）',
].join('\n');
var LINE_DOWN = '資料暫時讀不到，請稍後再試 🙏';

// LINE 傳來的請求長這樣：{ destination, events: [...] }（隊務工具的請求有 action，不會有這兩個欄位）
function isLineWebhook_(data) {
  return !!data && typeof data.destination === 'string' && data.events instanceof Array;
}

function lineHandle_(data) {
  var site = lineProp_('LINE_SITE_URL') || LINE_SITE_DEFAULT;
  data.events.forEach(function (ev) {
    try {
      var text = lineEventText_(ev, site);
      if (text) lineReply_(ev.replyToken, text);
    } catch (e) {
      Logger.log('LINE 處理失敗：' + e);
    }
  });
  return jsonOut({ ok: true });
}

function lineProp_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }

function lineEventText_(ev, site) {
  if (!ev) return '';
  if (ev.type === 'join') return LINE_INTRO;
  if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return '';
  var cmd = lineParse_(ev.message.text);
  if (!cmd) return '';
  if (cmd.type === 'help') return LINE_HELP;
  var L = lineLoader_(site);
  try {
    return lineAnswer_(cmd, L, site);
  } catch (e) {
    if (e && e.lineDown) return LINE_DOWN;
    throw e;
  }
}

// 「#下一場」→ { type: 'next' }；「#陳奕瑋（啦啦隊風格）」→ { type: 'player', q: '陳奕瑋' }（括號裡的風格第一版不用）
function lineParse_(text) {
  var t = String(text || '').trim();
  if (t.charAt(0) !== '#' && t.charAt(0) !== '＃') return null;
  var body = t.slice(1).replace(/[（(][^）)]*[）)]/g, '').trim();
  if (!body) return null;
  var map = { '下一場': 'next', '練球': 'practice', '公告': 'news', '戰績': 'record', '上一場': 'last', '說明': 'help', 'help': 'help', '幫助': 'help' };
  var k = map[body] || map[body.toLowerCase()];
  return k ? { type: k } : { type: 'player', q: body };
}

// 讀官網資料檔（同一次請求讀過就不再讀）；讀不到時丟 lineDown
function lineLoader_(site) {
  var cache = {};
  var get = function (path) {
    if (path in cache) return cache[path];
    var r = UrlFetchApp.fetch(site + '/data/' + path, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) { var err = new Error('讀不到 ' + path); err.lineDown = true; throw err; }
    cache[path] = JSON.parse(r.getContentText());
    return cache[path];
  };
  return {
    json: function (name) { return get(name + '.json'); },
    // 單場賽事成績：讀不到就當作沒有（戰績頁也是這樣處理）
    game: function (id) { try { return get('games/' + encodeURIComponent(id) + '.json'); } catch (e) { return null; } },
  };
}

// 台灣時間的今天 'YYYY-MM-DD'
function lineToday_() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }
function lineDays_(from, to) { return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000); }
function lineMD_(iso) {
  var d = new Date(iso + 'T00:00:00Z');
  return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '（' + LINE_WEEKDAYS[d.getUTCDay()] + '）';
}
function lineMapUrl_(q) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q); }

function lineAnswer_(cmd, L, site) {
  var today = lineToday_();
  if (cmd.type === 'next' || cmd.type === 'practice') return lineEvent_(cmd.type, L, today);
  if (cmd.type === 'news') {
    var list = (L.json('announcements') || []).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    if (!list.length) return '目前沒有公告 📢';
    return '📢 最新公告（' + lineMD_(list[0].date).replace(/（.）$/, '') + '）\n' + list[0].title + '\n👉 ' + site + '/news.html';
  }
  if (cmd.type === 'record') {
    var gp = SeasonStats.groups(L.json('schedule'))[0];
    if (!gp) return '還沒有戰績，開季後就查得到囉！⚾';
    var s = lineSeason_(gp, L);
    return '🏆 ' + gp.label + '\n' + s.record.played + ' 場 ' + s.record.win + ' 勝 ' + s.record.loss + ' 敗 ' + s.record.tie + ' 和\n👉 ' + site + '/standings.html';
  }
  if (cmd.type === 'last') return lineLast_(L, today, site);
  return linePlayer_(cmd.q, L, site);
}

function lineSeason_(gp, L) {
  var byId = {};
  gp.entries.forEach(function (e) { byId[e.id] = L.game(e.id); });
  return SeasonStats.summarize(gp.entries, byId);
}

// #下一場、#練球
function lineEvent_(type, L, today) {
  var isGame = type === 'next';
  var list = (L.json('schedule') || []).filter(function (x) {
    return x && x.type === (isGame ? 'game' : 'practice') && String(x.date) >= today && (!isGame || !x.cancelled);
  }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  var it = list[0];
  if (!it) return isGame ? '目前時程沒有下一場比賽，有新賽程會再公告 📅' : '目前時程沒有排練球 📅';
  if (it.cancelled) return '❌ ' + lineMD_(it.date) + '練球取消' + (it.note ? '：' + it.note : '');
  var out = [];
  if (isGame) {
    out.push('📣 下一場比賽來囉！');
    out.push(lineMD_(it.date) + 'vs ' + (it.opponent || '未定') + (typeof it.league === 'string' && it.league.trim() ? '｜' + it.league.trim() : ''));
    out.push('⏰ ' + (it.gatherTime ? it.gatherTime + ' 集合、' : '') + (it.startTime || '時間未定') + ' 開賽');
  } else {
    out.push('🏃 下一次練球');
    out.push(lineMD_(it.date) + (it.startTime ? it.startTime + (it.endTime ? '～' + it.endTime : '') : ''));
  }
  var venue = String(it.venue || '').trim();
  var v = null;
  if (!venue) {
    out.push('📍 地點未定，請留意公告');
  } else {
    out.push('📍 ' + venue);
    v = lineVenue_(L, venue);
    out.push('🗺️ 地圖：' + (v && v.map ? v.map : lineMapUrl_(venue)));
    if (v && v.parking) out.push('🅿️ 停車：' + v.parking);
    if (v && v.meet) out.push('🚩 集合：' + v.meet);
    if (v && v.note) out.push('⚠️ ' + v.note);
  }
  if (it.note) out.push('📝 ' + it.note);
  if (v && v.area) out = out.concat(lineWeather_(v.area, it.date, it.startTime || '12:00'));
  var n = lineDays_(today, it.date);
  if (isGame) out.push(n === 0 ? '就是今天！大家加油！💪' : n === 1 ? '就是明天，大家加油！💪' : '還有 ' + n + ' 天，大家加油！💪');
  else out.push(n === 0 ? '就是今天！' : n === 1 ? '就是明天！' : '還有 ' + n + ' 天');
  return out.join('\n');
}

function lineVenue_(L, name) {
  var list;
  try { list = L.json('venues'); } catch (e) { return null; }   // 球場資訊檔讀不到不影響其他內容
  for (var i = 0; i < (list || []).length; i++) if (list[i] && String(list[i].name).trim() === name) return list[i];
  return null;
}

// 天氣（V01.15.02）：氣象署「各縣市一週預報」（F-D0047-091），用球場所在縣市查；開賽在 7 天內才查。
// 取開賽時間所在的那一段（06 開始＝白天、18＝晚上、00＝凌晨），回傳要加進回覆的幾行：
//   🌦️ 11/15（日）白天 新北市
//   多雲短暫陣雨｜23～27°C｜降雨機率 30%    ← 沒有的項目省略（第 4～7 天的降雨機率是「-」）
//   💡 提醒（雨、熱／紫外線、涼；規則見下面）
// 沒有金鑰、讀不到、格式不對、找不到縣市或時段、三項都沒有 → 回空陣列（不顯示天氣段）
var LINE_CWA_ELEMENTS = ['天氣現象', '最高溫度', '最低溫度', '最高體感溫度', '最低體感溫度', '12小時降雨機率', '紫外線指數'];
function lineWeather_(area, date, time) {
  var key = lineProp_('CWA_API_KEY');
  var county = String(area).slice(0, 3);
  var start = Date.parse(date + 'T' + (time || '12:00') + ':00+08:00');
  if (!key || !county || isNaN(start) || start < Date.now() - 3 * 3600 * 1000 || start > Date.now() + 7 * 24 * 3600 * 1000) return [];
  try {
    var url = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-091?Authorization=' + encodeURIComponent(key)
      + '&LocationName=' + encodeURIComponent(county) + '&ElementName=' + encodeURIComponent(LINE_CWA_ELEMENTS.join(','));
    var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return [];
    var groups = (((JSON.parse(r.getContentText()) || {}).records || {}).Locations) || [];
    var loc = null;
    groups.forEach(function (g) { (g.Location || []).forEach(function (x) { if (!loc && x.LocationName === county) loc = x; }); });
    if (!loc) return [];
    var slot = null;   // 開賽時間所在那一段的開始時間
    var val = function (name, field) {   // 這個欄位在開賽那一段的值；沒有、「-」、空白 → null
      var el = (loc.WeatherElement || []).filter(function (e) { return e.ElementName === name; })[0];
      var ts = (el && el.Time) || [];
      for (var i = 0; i < ts.length; i++) {
        var a = Date.parse(ts[i].StartTime);
        var b = Date.parse(ts[i].EndTime);
        if (start >= a && start < b) {
          if (slot === null) slot = ts[i].StartTime;
          var v = ((ts[i].ElementValue || [])[0] || {})[field];
          return v === undefined || v === null || v === '' || v === '-' ? null : String(v);
        }
      }
      return null;
    };
    var num = function (v) { return v === null || isNaN(Number(v)) ? null : Number(v); };
    var wx = val('天氣現象', 'Weather');
    var maxT = num(val('最高溫度', 'MaxTemperature'));
    var minT = num(val('最低溫度', 'MinTemperature'));
    var maxAT = num(val('最高體感溫度', 'MaxApparentTemperature'));
    var minAT = num(val('最低體感溫度', 'MinApparentTemperature'));
    var pop = num(val('12小時降雨機率', 'ProbabilityOfPrecipitation'));
    var uv = num(val('紫外線指數', 'UVIndex'));
    var parts = [];
    if (wx) parts.push(wx);
    if (minT !== null && maxT !== null) parts.push(minT === maxT ? maxT + '°C' : minT + '～' + maxT + '°C');
    else if (minT !== null || maxT !== null) parts.push((minT !== null ? minT : maxT) + '°C');
    if (pop !== null) parts.push('降雨機率 ' + pop + '%');
    if (!parts.length || slot === null) return [];
    var hour = Number(String(slot).slice(11, 13));
    var when = hour >= 6 && hour < 18 ? '白天' : hour >= 18 ? '晚上' : '凌晨';
    var out = ['🌦️ ' + lineMD_(date) + when + ' ' + county, parts.join('｜')];
    if (pop !== null && pop >= 70) out.push('💡 降雨機率高，請留意群組通知（可能延賽）');
    else if (pop !== null && pop >= 50) out.push('💡 可能下雨，記得帶雨具');
    var hot = maxAT !== null && maxAT >= 32;
    var sun = uv !== null && uv >= 8;
    if (hot && sun) out.push('💡 體感偏熱、紫外線很強，記得防曬、多補充水分');
    else if (hot) out.push('💡 體感偏熱，記得防曬、多補充水分');
    else if (sun) out.push('💡 紫外線很強，記得防曬');
    if (minAT !== null && minAT <= 15) out.push('💡 天氣偏涼，注意保暖、多做熱身');
    return out;
  } catch (e) {
    Logger.log('氣象署讀取失敗：' + e);
  }
  return [];
}

// #上一場：最近一場有賽事成績（resultUrl）的比賽
function lineLast_(L, today, site) {
  var list = (L.json('schedule') || []).filter(function (x) {
    return x && x.type === 'game' && !x.cancelled && String(x.date) <= today && /^game\.html\?id=[^&#\s]+$/.test(String(x.resultUrl || ''));
  }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  var it = list[0];
  if (!it) return '還沒有發布過賽事成績 📋';
  var g = L.game(decodeURIComponent(it.resultUrl.slice('game.html?id='.length)));
  var us = g && g.score ? g.score.us : (it.score && it.score.longan);
  var opp = g && g.score ? g.score.opp : (it.score && it.score.opponent);
  var line = '';
  if (typeof us === 'number' && typeof opp === 'number') {
    line = '\n龍安 ' + us + '：' + opp + ' ' + it.opponent + '，' + (us > opp ? '勝 🎉' : us < opp ? '敗，下一場再拚！💪' : '和');
  }
  return '⚾ 上一場：' + lineMD_(it.date) + 'vs ' + it.opponent + line + '\n👉 ' + site + '/' + it.resultUrl;
}

// #陳奕瑋、#5、#坦克：最新一季的成績
function linePlayer_(q, L, site) {
  var players = L.json('players') || [];
  var hits = /^\d+$/.test(q)
    ? players.filter(function (p) { return String(p.number) === q; })
    : players.filter(function (p) { return p.name === q || (p.nickname && p.nickname === q); });
  if (!hits.length) return '找不到「' + q + '」🤔 打 #說明 看用法';
  if (hits.length > 1) return '有 ' + hits.length + ' 位「' + q + '」，請改打背號：' + hits.map(function (p) { return '#' + p.number; }).join('、');
  var p = hits[0];
  var gp = SeasonStats.groups(L.json('schedule'))[0];
  var head = '⚾ #' + p.number + ' ' + p.name + (gp ? '｜' + gp.label : '');
  if (!gp) return head + '\n還沒有戰績，開季後就查得到囉！⚾';
  var s = lineSeason_(gp, L);
  var b = s.batting.filter(function (r) { return r.number === String(p.number); })[0];
  var pi = s.pitching.filter(function (r) { return r.number === String(p.number); })[0];
  if (!b && !pi) return head + '\n本季還沒有出賽紀錄';
  var out = [head];
  if (b) {
    out.push('打擊：' + b.AB + ' 打數 ' + b.H + ' 安打' + (b.HR ? '、' + b.HR + ' 全壘打' : '') + '、' + b.RBI + ' 打點');
    out.push('打擊率 ' + b.AVG + '／上壘率 ' + b.OBP + '／長打率 ' + b.SLG);
  }
  if (pi) out.push('投手：' + pi.IP + ' 局、自責分 ' + pi.ER + '、三振 ' + pi.SO);
  out.push('完整成績 👉 ' + site + '/standings.html');
  return out.join('\n');
}

function lineReply_(replyToken, text) {
  var token = lineProp_('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) { Logger.log('沒有設定 LINE_CHANNEL_ACCESS_TOKEN，回覆沒有送出'); return false; }
  var r = UrlFetchApp.fetch(LINE_REPLY_URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: String(text).slice(0, 5000) }] }),
  });
  if (r.getResponseCode() !== 200) Logger.log('LINE 回覆失敗：' + r.getResponseCode() + ' ' + r.getContentText());
  return true;
}
