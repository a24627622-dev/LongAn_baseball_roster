// LINE「龍安虛擬球隊經理」（gas/Line.gs，V01.14.00）的測試
// 用假的 LINE、假的官網資料檔、假的氣象署跑 GAS：群組裡打「#關鍵字」→ 回覆的文字。
// 期望值一律手寫（日期、比分、成績都是手算）。
const assert = require('assert');
const { createGasContext, MockSpreadsheet } = require('./gas_mock');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✅ ' + name); }
  catch (e) { console.log('  ❌ ' + name + '\n     ' + String(e.message).split('\n').slice(0, 4).join('\n     ')); process.exitCode = 1; }
};

const SITE = 'https://longan-baseball.pages.dev';
const FILES = ['gas/Code.gs', 'gas/Auth.gs', 'gas/Pitchers.gs', 'gas/Backup.gs', 'season-stats.js', 'gas/Line.gs'];
const TPE = (y, m, d, hh = 0, mm = 0) => Date.UTC(y, m - 1, d, hh - 8, mm);   // 台灣時間 → 毫秒

// ---- 假的官網資料 ----
const game = (date, opponent, o = {}) => ({ type: 'game', date, gatherTime: '09:00', startTime: '10:00', venue: '大漢B球場', opponent, score: null, resultUrl: null, cancelled: false, note: '', ...o });
const practice = (date, o = {}) => ({ type: 'practice', date, startTime: '08:00', endTime: '12:00', venue: '', cancelled: false, note: '', ...o });
const SCHEDULE = [
  game('2026-11-01', 'ZERO', { league: '大漢聯盟', score: { longan: 14, opponent: 3 }, resultUrl: 'game.html?id=2026-11-01_G1_ZERO' }),
  practice('2026-11-08'),
  game('2026-11-15', 'RELOOC', { league: '大漢聯盟' }),
  practice('2026-11-22', { cancelled: true, note: '因雨取消' }),
  game('2026-11-29', '雨人', { venue: '基隆大武崙棒球場', league: '大漢聯盟', cancelled: true }),
  game('2026-12-06', '猛虎', { venue: '新球場', gatherTime: '', startTime: '13:00' }),
];
const ANNOUNCEMENTS = [
  { date: '2026-09-23', title: '龍安官方網站啟用', body: '', pinned: true },
  { date: '2026-11-02', title: '11/15 首戰集合時間', body: '', pinned: false },
];
const PLAYERS = [
  { number: '5', name: '陳奕瑋', nickname: '坦克', photo: null },
  { number: '18', name: '江佑霖', nickname: '', photo: null },
  { number: '19', name: '林廷軒', nickname: '', photo: null },
  { number: '21', name: '林廷軒', nickname: '', photo: null },   // 同名（測試用）
  { number: '33', name: '王新人', nickname: '', photo: null },
];
const VENUES = [
  { name: '基隆大武崙棒球場', parking: '請自行搜尋附近停車場', meet: '球場入口集合', note: '', area: '基隆市安樂區' },
  { name: '大漢B球場', parking: 'https://maps.app.goo.gl/tqgDazJYBsFsLc12A', meet: '球場後方草皮', note: '球場無飲水機與販賣機，請準備充足飲水', area: '新北市板橋區' },
];
const bat = (number, name, o) => ({ number, name, AB: 0, R: 0, H: 0, '2B': 0, '3B': 0, HR: 0, RBI: 0, BB: 0, HBP: 0, K: 0, SB: 0, E: 0, appeared: true, ...o });
const GAME_1101 = { id: '2026-11-01_G1_ZERO', date: '2026-11-01', opponent: 'ZERO', score: { us: 14, opp: 3 },
  batting: [bat('5', '陳奕瑋', { AB: 4, R: 2, H: 2, '2B': 1, HR: 1, RBI: 3, BB: 1 }), bat('18', '江佑霖', { AB: 3, H: 1 })],
  pitching: [{ number: '18', name: '江佑霖', IP: '5.1', H: 4, R: 3, ER: 2, BB: 1, HBP: 0, SO: 3, HR: 0 }] };
// 氣象署 F-D0047-091（各縣市一週預報）的格式（V01.15.02；2026-10-24 使用者用正式金鑰讀過、確認欄位名稱）
// 一段：{ s: 開始, e: 結束, wx, minT, maxT, minAT, maxAT, pop, uv }，沒給的欄位整筆不放（例：晚上沒有紫外線）
const iso = (t) => t.replace(' ', 'T') + ':00+08:00';
const ELEMENTS = [
  ['天氣現象', 'wx', (v) => ({ Weather: v, WeatherCode: '08' })],
  ['最高溫度', 'maxT', (v) => ({ MaxTemperature: v })],
  ['最低溫度', 'minT', (v) => ({ MinTemperature: v })],
  ['最高體感溫度', 'maxAT', (v) => ({ MaxApparentTemperature: v })],
  ['最低體感溫度', 'minAT', (v) => ({ MinApparentTemperature: v })],
  ['12小時降雨機率', 'pop', (v) => ({ ProbabilityOfPrecipitation: v })],
  ['紫外線指數', 'uv', (v) => ({ UVIndex: v, UVExposureLevel: Number(v) >= 8 ? '過量級' : '中量級' })],
];
const LOC = (county, slots) => ({ LocationName: county, Geocode: '65000', WeatherElement: ELEMENTS.map(([name, k, f]) => ({
  ElementName: name, Time: slots.filter((x) => x[k] !== undefined).map((x) => ({ StartTime: iso(x.s), EndTime: iso(x.e), ElementValue: [f(x[k])] })),
})) });
const DAY_1115 = { s: '2026-11-15 06:00', e: '2026-11-15 18:00', wx: '多雲短暫陣雨', minT: '23', maxT: '27', minAT: '24', maxAT: '29', pop: '30', uv: '5' };
const SLOTS = (day = {}) => [
  { s: '2026-11-14 18:00', e: '2026-11-15 06:00', wx: '晴時多雲', minT: '20', maxT: '22', minAT: '20', maxAT: '22', pop: '10' },
  { ...DAY_1115, ...day },
  { s: '2026-11-15 18:00', e: '2026-11-16 06:00', wx: '陰天', minT: '19', maxT: '21', minAT: '14', maxAT: '20', pop: '80' },
];
const WEEK = (day, extra = []) => ({ success: 'true', records: { Locations: [{ DatasetDescription: '臺灣各縣市鄉鎮未來1週天氣預報', LocationsName: '臺灣', Location: [
  LOC('連江縣', SLOTS()), LOC('新北市', SLOTS(day)), LOC('基隆市', [...SLOTS({ wx: '短暫陣雨', minT: '18', maxT: '20', minAT: '15', maxAT: '19', pop: '60', uv: '2' }), ...extra]),
] }] } });
const WEATHER = WEEK();
// 回覆裡的天氣段：🌦️ 標題、下一行（天氣｜溫度｜降雨機率）、接著的 💡 提醒
const wRange = (lines) => {
  const i = lines.findIndex((l) => l.startsWith('🌦️'));
  if (i === -1) return [0, 0];
  let j = i + 2;
  while (j < lines.length && lines[j].startsWith('💡')) j++;
  return [i, j];
};
const wBlock = (t) => { const ls = t.split('\n'); const [i, j] = wRange(ls); return ls.slice(i, j); };
const noWeather = (t) => { const ls = t.split('\n'); const [i, j] = wRange(ls); return ls.filter((_, k) => k < i || k >= j).join('\n'); };

// 跑一次：群組裡有人打 text。回傳 { replies：送出的回覆文字, fetches, logs, res }
function run(texts, { now = TPE(2026, 11, 12, 20), props = {}, data = {}, events = null, siteDown = false, weather = WEATHER } = {}) {
  const files = { schedule: SCHEDULE, announcements: ANNOUNCEMENTS, players: PLAYERS, venues: VENUES, ...data };
  const fetch = (url, params) => {
    if (url === 'https://api.line.me/v2/bot/message/reply') return { code: 200, body: '{}' };
    if (url.startsWith('https://opendata.cwa.gov.tw/')) return weather ? { code: 200, body: weather } : { code: 500, body: '' };
    if (siteDown) return { code: 503, body: '' };
    const m = /\/data\/(.+)\.json$/.exec(url);
    if (m && m[1].startsWith('games/')) {
      const id = decodeURIComponent(m[1].slice(6));
      const games = files.games || { [GAME_1101.id]: GAME_1101 };
      return games[id] ? { code: 200, body: games[id] } : { code: 404, body: '' };
    }
    return m && files[m[1]] ? { code: 200, body: files[m[1]] } : { code: 404, body: '' };
  };
  const ss = new MockSpreadsheet();
  const g = createGasContext({ files: FILES, props: { LINE_CHANNEL_ACCESS_TOKEN: 'tok', CWA_API_KEY: 'cwa', ...props }, spreadsheet: ss, now: () => now, fetch });
  const evs = events || [].concat(texts).map((t, i) => ({ type: 'message', replyToken: 'r' + i, source: { type: 'group', groupId: 'G1' }, message: { type: 'text', text: t } }));
  const res = JSON.parse(g.ctx.doPost({ postData: { contents: JSON.stringify({ destination: 'Ubot', events: evs }) } }).getContent());
  const sent = g.fetches.filter((f) => f.url === 'https://api.line.me/v2/bot/message/reply');
  const replies = sent.map((f) => JSON.parse(f.params.payload).messages[0].text);
  return { replies, sent, fetches: g.fetches, logs: g.logs, res, ss };
}
const one = (text, o) => { const r = run(text, o); assert.strictEqual(r.replies.length, 1, `應該回 1 則，實際 ${r.replies.length} 則`); return r.replies[0]; };

console.log('觸發（只處理 # 開頭的訊息）');

test('「#下一場」「＃下一場」（全形）、前後有空白都會觸發；回覆送到 LINE，帶 replyToken 和金鑰', () => {
  const r = run(['#下一場', '＃下一場', '  #下一場  ']);
  assert.strictEqual(r.replies.length, 3);
  assert.strictEqual(JSON.parse(r.sent[0].params.payload).replyToken, 'r0');
  assert.strictEqual(r.sent[0].params.headers.Authorization, 'Bearer tok');
});

test('沒有 # 的訊息、只有「#」、貼圖 → 不回覆，也不去讀官網資料', () => {
  const r = run(['下一場是哪天？', '今天要練球嗎', '#'], {});
  assert.strictEqual(r.replies.length, 0);
  assert.strictEqual(r.fetches.length, 0);
  const s = run(null, { events: [{ type: 'message', replyToken: 'x', message: { type: 'sticker' } }] });
  assert.strictEqual(s.fetches.length, 0);
});

test('「#陳奕瑋（啦啦隊風格）」→ 括號裡的風格忽略，照「#陳奕瑋」回成績', () => {
  assert.strictEqual(one('#陳奕瑋（啦啦隊風格）'), one('#陳奕瑋'));
  assert.strictEqual(one('#陳奕瑋(啦啦隊風格)'), one('#陳奕瑋'));
});

console.log('\n#下一場、#練球（時程＋球場資訊＋天氣）');

test('#下一場：跳過已過的比賽；日期、對手、賽事、集合／開賽、球場、地圖、停車、集合點、注意事項、天氣、倒數', () => {
  const t = one('#下一場', { now: TPE(2026, 11, 14, 20) });
  assert.strictEqual(t, [
    '📣 下一場比賽來囉！',
    '11/15（日）vs RELOOC｜大漢聯盟',
    '⏰ 09:00 集合、10:00 開賽',
    '📍 大漢B球場',
    '🗺️ 地圖：https://www.google.com/maps/search/?api=1&query=%E5%A4%A7%E6%BC%A2B%E7%90%83%E5%A0%B4',
    '🅿️ 停車：https://maps.app.goo.gl/tqgDazJYBsFsLc12A',
    '🚩 集合：球場後方草皮',
    '⚠️ 球場無飲水機與販賣機，請準備充足飲水',
    '🌦️ 11/15（日）白天 新北市',
    '多雲短暫陣雨｜23～27°C｜降雨機率 30%',
    '就是明天，大家加油！💪',
  ].join('\n'));
});

test('#下一場：跳過取消的比賽；今天的比賽寫「就是今天」；對不到球場資訊只給地圖；沒有集合時間只寫開賽', () => {
  const t = one('#下一場', { now: TPE(2026, 12, 6, 7) });
  assert.strictEqual(t, ['📣 下一場比賽來囉！', '12/6（日）vs 猛虎', '⏰ 13:00 開賽', '📍 新球場',
    '🗺️ 地圖：https://www.google.com/maps/search/?api=1&query=%E6%96%B0%E7%90%83%E5%A0%B4', '就是今天！大家加油！💪'].join('\n'));
  const t2 = one('#下一場', { now: TPE(2026, 11, 16, 9) });   // 11/29 取消 → 12/6
  assert.match(t2, /12\/6（日）vs 猛虎/);
  assert.match(t2, /還有 20 天，大家加油！💪$/);
});

test('#下一場：日期照台灣時間（UTC 還是 11/14、台灣已經 11/15 凌晨）→ 11/15 是「今天」', () => {
  assert.match(one('#下一場', { now: Date.UTC(2026, 10, 14, 16, 30) }), /就是今天！/);
});

test('#下一場：時程沒有下一場 → 「目前時程沒有下一場比賽」', () => {
  assert.strictEqual(one('#下一場', { now: TPE(2026, 12, 7, 9) }), '目前時程沒有下一場比賽，有新賽程會再公告 📅');
});

// ---- 天氣（V01.15.02：一週預報 F-D0047-091，7 天內；溫度、降雨機率、提醒）----
const W = (day, o = {}) => wBlock(one('#下一場', { now: TPE(2026, 11, 12, 20), weather: WEEK(day), ...o }));

test('比賽前約 3 天、降雨機率 30%：標題＋「天氣｜溫度｜降雨機率」，沒有提醒', () => {
  assert.deepStrictEqual(W({}), ['🌦️ 11/15（日）白天 新北市', '多雲短暫陣雨｜23～27°C｜降雨機率 30%']);
});

test('降雨提醒的邊界：70% → 可能延賽；50% → 帶雨具；49% → 沒有', () => {
  assert.deepStrictEqual(W({ pop: '70' }).slice(1), ['多雲短暫陣雨｜23～27°C｜降雨機率 70%', '💡 降雨機率高，請留意群組通知（可能延賽）']);
  assert.deepStrictEqual(W({ pop: '69' }).slice(2), ['💡 可能下雨，記得帶雨具']);
  assert.deepStrictEqual(W({ pop: '50' }).slice(2), ['💡 可能下雨，記得帶雨具']);
  assert.deepStrictEqual(W({ pop: '49' }).slice(2), []);
});

test('溫度提醒的邊界：最高體感 32 → 偏熱、31 → 沒有；最低體感 15 → 偏涼、16 → 沒有', () => {
  assert.deepStrictEqual(W({ maxAT: '32' }).slice(2), ['💡 體感偏熱，記得防曬、多補充水分']);
  assert.deepStrictEqual(W({ maxAT: '31' }).slice(2), []);
  assert.deepStrictEqual(W({ minAT: '15' }).slice(2), ['💡 天氣偏涼，注意保暖、多做熱身']);
  assert.deepStrictEqual(W({ minAT: '16' }).slice(2), []);
});

test('紫外線：8 以上且不熱 → 紫外線那行；又熱又 8 以上 → 合併一行；7 → 沒有；提醒照順序（雨、熱、涼）', () => {
  assert.deepStrictEqual(W({ uv: '8' }).slice(2), ['💡 紫外線很強，記得防曬']);
  assert.deepStrictEqual(W({ uv: '9', maxAT: '34' }).slice(2), ['💡 體感偏熱、紫外線很強，記得防曬、多補充水分']);
  assert.deepStrictEqual(W({ uv: '7' }).slice(2), []);
  assert.deepStrictEqual(W({ pop: '80', maxAT: '33', minAT: '10' }).slice(2),
    ['💡 降雨機率高，請留意群組通知（可能延賽）', '💡 體感偏熱，記得防曬、多補充水分', '💡 天氣偏涼，注意保暖、多做熱身']);
});

test('第 4～7 天降雨機率是「-」：不寫降雨機率，溫度提醒照常；最低最高一樣只寫一個；天氣現象沒有就省略', () => {
  assert.deepStrictEqual(W({ pop: '-', maxAT: '32' }, { now: TPE(2026, 11, 10, 20) }), ['🌦️ 11/15（日）白天 新北市', '多雲短暫陣雨｜23～27°C', '💡 體感偏熱，記得防曬、多補充水分']);
  assert.deepStrictEqual(W({ pop: '-', minT: '25', maxT: '25', wx: '' }).slice(1), ['25°C']);
});

test('超過 7 天、或活動已經過了 → 不顯示，也沒有連到氣象署', () => {
  const far = run('#下一場', { now: TPE(2026, 11, 8, 9) });          // 11/15 10:00 開賽，還有 7 天 1 小時
  assert.ok(!/🌦️/.test(far.replies[0]) && /還有 7 天/.test(far.replies[0]));
  assert.ok(!far.fetches.some((f) => f.url.includes('cwa.gov.tw')));
  const past = run('#下一場', { now: TPE(2026, 11, 15, 14) });       // 開賽過了 4 小時
  assert.ok(!past.fetches.some((f) => f.url.includes('cwa.gov.tw')));
  const near = run('#下一場', { now: TPE(2026, 11, 8, 11) });         // 6 天 23 小時 → 查
  assert.ok(near.fetches.some((f) => f.url.includes('cwa.gov.tw')));
});

test('36 小時內也用一週預報（有溫度、提醒），不再查「今明 36 小時」F-C0032-001', () => {
  const r = run('#下一場', { now: TPE(2026, 11, 14, 20), weather: WEEK({ pop: '70' }) });
  assert.deepStrictEqual(wBlock(r.replies[0]).slice(1), ['多雲短暫陣雨｜23～27°C｜降雨機率 70%', '💡 降雨機率高，請留意群組通知（可能延賽）']);
  assert.ok(!r.fetches.some((f) => f.url.includes('F-C0032-001')));
});

test('時段：10:00 開賽取白天（06～18）；19:00 開賽取晚上（沒有紫外線資料也不出錯）', () => {
  assert.strictEqual(W({})[0], '🌦️ 11/15（日）白天 新北市');
  const night = SCHEDULE.map((x) => (x.date === '2026-11-15' ? { ...x, startTime: '19:00' } : x));
  assert.deepStrictEqual(W({}, { data: { schedule: night } }), ['🌦️ 11/15（日）晚上 新北市', '陰天｜19～21°C｜降雨機率 80%', '💡 降雨機率高，請留意群組通知（可能延賽）', '💡 天氣偏涼，注意保暖、多做熱身']);
});

test('出錯：沒有金鑰、HTTP 錯誤、JSON 壞掉、找不到縣市、找不到時段、全部欄位都是「-」→ 天氣段不顯示，其他照常', () => {
  const base = noWeather(one('#下一場', { now: TPE(2026, 11, 12, 20) }));
  const noKey = run('#下一場', { now: TPE(2026, 11, 12, 20), props: { CWA_API_KEY: '' } });
  assert.strictEqual(noKey.replies[0], base);
  assert.ok(!noKey.fetches.some((f) => f.url.includes('cwa.gov.tw')));
  assert.strictEqual(one('#下一場', { now: TPE(2026, 11, 12, 20), weather: null }), base);
  assert.strictEqual(one('#下一場', { now: TPE(2026, 11, 12, 20), weather: '{"records": [' }), base);
  const noCounty = { records: { Locations: [{ Location: [LOC('臺北市', SLOTS())] }] } };
  assert.strictEqual(one('#下一場', { now: TPE(2026, 11, 12, 20), weather: noCounty }), base);
  const noSlot = { records: { Locations: [{ Location: [LOC('新北市', SLOTS().slice(0, 1))] }] } };
  assert.strictEqual(one('#下一場', { now: TPE(2026, 11, 12, 20), weather: noSlot }), base);
  assert.strictEqual(one('#下一場', { now: TPE(2026, 11, 12, 20), weather: WEEK({ wx: '-', minT: '-', maxT: '-', minAT: '-', maxAT: '-', pop: '-', uv: '-' }) }), base);
  assert.ok(/還有 3 天，大家加油！💪$/.test(base) && /⚠️ 球場無飲水機/.test(base));
});

test('網址：F-D0047-091，帶金鑰、球場所在縣市（大漢B球場 → 新北市）、只要 7 個欄位', () => {
  const r = run('#下一場', { now: TPE(2026, 11, 12, 20) });
  const w = r.fetches.filter((f) => f.url.includes('cwa.gov.tw'));
  assert.strictEqual(w.length, 1);
  assert.strictEqual(w[0].url, 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-091?Authorization=cwa&LocationName=' + encodeURIComponent('新北市')
    + '&ElementName=' + encodeURIComponent('天氣現象,最高溫度,最低溫度,最高體感溫度,最低體感溫度,12小時降雨機率,紫外線指數'));
});

test('基隆市（大武崙棒球場）＋#練球 也有天氣段', () => {
  const sched = SCHEDULE.map((x) => (x.date === '2026-11-08' ? { ...x, date: '2026-11-15', venue: '基隆大武崙棒球場' } : x)).filter((x) => x.type === 'practice' || x.date !== '2026-11-15');
  const r = run('#練球', { now: TPE(2026, 11, 12, 20), data: { schedule: sched } });
  assert.deepStrictEqual(wBlock(r.replies[0]), ['🌦️ 11/15（日）白天 基隆市', '短暫陣雨｜18～20°C｜降雨機率 60%', '💡 可能下雨，記得帶雨具', '💡 天氣偏涼，注意保暖、多做熱身']);   // 最低體感 15
  assert.ok(r.fetches.find((f) => f.url.includes('cwa.gov.tw')).url.includes('LocationName=' + encodeURIComponent('基隆市')));
});

test('#練球：下一次練球；地點空白 → 「地點未定，請留意公告」', () => {
  assert.strictEqual(one('#練球', { now: TPE(2026, 11, 5, 9) }),
    ['🏃 下一次練球', '11/8（日）08:00～12:00', '📍 地點未定，請留意公告', '還有 3 天'].join('\n'));
});

test('#練球：下一次練球取消 → 註明取消和備註', () => {
  assert.strictEqual(one('#練球', { now: TPE(2026, 11, 16, 9) }), '❌ 11/22（日）練球取消：因雨取消');
});

console.log('\n#行程（V01.15.03：今天起 7 天的練球與比賽）');

const WEEK_SCHED = [
  game('2026-11-01', 'ZERO', { league: '大漢聯盟', score: { longan: 14, opponent: 3 }, resultUrl: 'game.html?id=2026-11-01_G1_ZERO' }),
  practice('2026-11-09', { startTime: '06:00', endTime: '08:00' }),
  practice('2026-11-10', { startTime: '19:00', endTime: '21:00', venue: '大漢B球場' }),
  practice('2026-11-12', { cancelled: true, note: '因雨取消' }),
  game('2026-11-15', 'RELOOC', { league: '大漢聯盟' }),
  practice('2026-11-16'),
];
const trip = (o = {}) => one('#行程', { now: TPE(2026, 11, 9, 9), data: { schedule: WEEK_SCHED }, ...o });

test('一週內有練球也有比賽：日期、類型、時間、地點、賽事、天氣，依日期排序；今天的活動（時間已過）也列', () => {
  assert.strictEqual(trip(), [
    '📅 這週行程（11/9～11/15）',
    '11/9（一）🏃 練球',
    '　06:00～08:00｜地點未定',
    '11/10（二）🏃 練球',
    '　19:00～21:00｜大漢B球場',
    '11/12（四）❌ 練球取消：因雨取消',
    '11/15（日）⚾ 比賽 vs RELOOC｜大漢聯盟',
    '　09:00 集合、10:00 開賽｜大漢B球場',
    '　🌦️ 多雲短暫陣雨｜23～27°C｜降雨機率 30%',
    '想看停車、集合點 👉 打 #下一場、#練球',
  ].join('\n'));
});

test('範圍邊界：第 7 天（今天＋6）要列，第 8 天不列；時程沒排序也照日期排', () => {
  const t = trip({ data: { schedule: WEEK_SCHED.slice().reverse() } });
  assert.ok(t.includes('11/15（日）⚾ 比賽 vs RELOOC') && !t.includes('11/16'));
  assert.ok(t.indexOf('11/9（一）') < t.indexOf('11/10（二）') && t.indexOf('11/10（二）') < t.indexOf('11/15（日）'));
  const t2 = trip({ now: TPE(2026, 11, 10, 9) });   // 11/10～11/16：11/9 不列、11/16 列
  assert.ok(t2.startsWith('📅 這週行程（11/10～11/16）') && !t2.includes('11/9（一）') && t2.includes('11/16（一）🏃 練球'));
});

test('取消的比賽也列：「❌ 比賽取消（vs 對手）：備註」', () => {
  const sched = [game('2026-11-15', 'RELOOC', { cancelled: true, note: '颱風' })];
  assert.strictEqual(trip({ data: { schedule: sched } }), ['📅 這週行程（11/9～11/15）', '11/15（日）❌ 比賽取消（vs RELOOC）：颱風', '想看停車、集合點 👉 打 #下一場、#練球'].join('\n'));
});

test('這週沒有活動 → 提示下一個（跳過取消的）；時程完全沒有之後的活動 → 另一句', () => {
  const sched = [practice('2026-11-20', { cancelled: true }), game('2026-12-06', '猛虎'), practice('2026-12-13')];
  assert.strictEqual(trip({ data: { schedule: sched } }), '這週沒有排活動，下一個是 12/6（日）比賽 vs 猛虎 📅');
  assert.strictEqual(trip({ data: { schedule: [practice('2026-12-13')] } }), '這週沒有排活動，下一個是 12/13（日）練球 📅');
  assert.strictEqual(trip({ data: { schedule: [WEEK_SCHED[0]] } }), '目前時程沒有排活動 📅');
});

test('天氣：提醒也縮排；沒有氣象署金鑰 → 不顯示天氣，其他照常', () => {
  const t = trip({ weather: WEEK({ pop: '70' }) });
  assert.ok(t.includes('　🌦️ 多雲短暫陣雨｜23～27°C｜降雨機率 70%\n　💡 降雨機率高，請留意群組通知（可能延賽）\n想看'));
  const noKey = trip({ props: { CWA_API_KEY: '' } });
  assert.strictEqual(noKey, trip().replace('\n　🌦️ 多雲短暫陣雨｜23～27°C｜降雨機率 30%', ''));
});

test('#行程、#本週、#這週、＃行程 都一樣；官網讀不到 → 資料暫時讀不到', () => {
  const t = trip();
  ['#本週', '#這週', '＃行程'].forEach((k) => assert.strictEqual(one(k, { now: TPE(2026, 11, 9, 9), data: { schedule: WEEK_SCHED } }), t, k));
  assert.strictEqual(one('#行程', { siteDown: true }), '資料暫時讀不到，請稍後再試 🙏');
});

console.log('\n#公告、#戰績、#上一場');

test('#公告：日期最新的一則（不是置頂那則），附公告頁連結', () => {
  assert.strictEqual(one('#公告'), `📢 最新公告（11/2）\n11/15 首戰集合時間\n👉 ${SITE}/news.html`);
});

test('#戰績：最新一季的勝敗和（11/1 14：3 勝 → 1 勝 0 敗 0 和），附戰績頁連結', () => {
  assert.strictEqual(one('#戰績'), `🏆 2026 大漢聯盟\n1 場 1 勝 0 敗 0 和\n👉 ${SITE}/standings.html`);
});

test('#戰績：還沒有任何標賽事的比賽 → 還沒有戰績', () => {
  assert.strictEqual(one('#戰績', { data: { schedule: SCHEDULE.map((x) => ({ ...x, league: undefined })) } }), '還沒有戰績，開季後就查得到囉！⚾');
});

test('#上一場（V01.16.01 起和「#成績」查最近一場一樣）：比分、勝負、賽事、亮點、賽事成績頁連結', () => {
  assert.strictEqual(one('#上一場'), `⚾ 11/1（日）vs ZERO｜大漢聯盟\n龍安 14：3 ZERO，勝 🎉\n🔥 安打最多：陳奕瑋 2 支\n💪 打點最多：陳奕瑋 3 分\n👉 ${SITE}/game.html?id=2026-11-01_G1_ZERO`);
});

test('#上一場：從來沒有發布過賽事成績 → 提示', () => {
  assert.strictEqual(one('#上一場', { data: { schedule: [practice('2026-11-08')] } }), '還沒有發布過賽事成績 📋');
});

console.log('\n#成績（V01.16.01：最近 5 場、查單場）');

const pub = (date, opp, us, them, o = {}) => game(date, opp, { league: '大漢聯盟', score: { longan: us, opponent: them }, resultUrl: 'game.html?id=' + encodeURIComponent(`${date}_G1_${opp}`), ...o });
const RES_SCHED = [
  pub('2026-09-27', 'E隊', 5, 0),
  pub('2026-10-04', 'A隊', 3, 1, { league: undefined }),
  pub('2026-10-11', 'B隊', 2, 6),
  pub('2026-10-18', 'F隊', 0, 0, { cancelled: true }),
  pub('2026-10-25', 'D隊', 4, 4),
  SCHEDULE[0],                                   // 11/1 ZERO 14：3（成績檔 GAME_1101）
  practice('2026-11-08'),
  game('2026-11-15', 'RELOOC', { league: '大漢聯盟' }),   // 還沒發布
];
const GAME_1025 = { id: '2026-10-25_G1_D隊', date: '2026-10-25', opponent: 'D隊', score: { us: 4, opp: 4 },
  batting: [bat('5', '陳奕瑋', { H: 2, RBI: 1 }), bat('18', '江佑霖', { H: 2, RBI: 1 }), bat('19', '林廷軒', { H: 1 }), bat('33', '王新人', { H: 2 }), bat('21', '李浩偉', { H: 2, RBI: 1 })], pitching: [] };
const GAME_1011 = { id: '2026-10-11_G1_B隊', date: '2026-10-11', opponent: 'B隊', score: { us: 2, opp: 6 }, batting: [bat('5', '陳奕瑋', { H: 1 })], pitching: [] };
const GAMES = { [GAME_1101.id]: GAME_1101, [GAME_1025.id]: GAME_1025, [GAME_1011.id]: GAME_1011 };   // 9/27、10/4 的成績檔讀不到
const res = (text, o = {}) => one(text, { now: TPE(2026, 11, 12, 20), data: { schedule: RES_SCHED, games: GAMES }, ...o });

test('#成績：最近 5 場（新的在前），沒發布的、取消的不列；比分從時程讀', () => {
  assert.strictEqual(res('#成績'), [
    '⚾ 最近 5 場比賽成績',
    '11/1（日）vs ZERO　14：3 勝',
    '10/25（日）vs D隊　4：4 和',
    '10/11（日）vs B隊　2：6 敗',
    '10/4（日）vs A隊　3：1 勝',
    '9/27（日）vs E隊　5：0 勝',
    '👉 想看某一場：打 #成績 11/15',
  ].join('\n'));
});

test('#成績：超過 5 場只列 5 場；不到 5 場有幾場列幾場', () => {
  const more = [pub('2026-09-20', 'G隊', 1, 2), ...RES_SCHED];
  assert.ok(!res('#成績', { data: { schedule: more, games: GAMES } }).includes('9/20'));
  const two = res('#成績', { data: { schedule: RES_SCHED.slice(4), games: GAMES } });
  assert.strictEqual(two.split('\n').length, 4);
  assert.ok(two.includes('11/1（日）vs ZERO') && two.includes('10/25（日）vs D隊'));
});

test('#成績 單場：比分、勝負、賽事、亮點（同分都列、最多 3 位加「等 N 人」；最多是 0 不顯示）、連結', () => {
  assert.strictEqual(res('#成績 10/25'), [
    '⚾ 10/25（日）vs D隊｜大漢聯盟',
    '龍安 4：4 D隊，和',
    '🔥 安打最多：陳奕瑋、江佑霖、王新人等 4 人 2 支',
    '💪 打點最多：陳奕瑋、江佑霖、李浩偉 1 分',
    `👉 ${SITE}/game.html?id=2026-10-25_G1_D%E9%9A%8A`,
  ].join('\n'));
  assert.strictEqual(res('#成績 10/11'), ['⚾ 10/11（日）vs B隊｜大漢聯盟', '龍安 2：6 B隊，敗，下一場再拚！💪', '🔥 安打最多：陳奕瑋 1 支',
    `👉 ${SITE}/game.html?id=2026-10-11_G1_B%E9%9A%8A`].join('\n'));
});

test('#成績 日期寫法：11/1、11-1、2026-11-01、#比賽 11/1 都一樣', () => {
  const t = res('#成績 11/1');
  ['#成績 11-1', '#成績 2026-11-01', '#比賽 11/1', '#成績 11/01'].forEach((k) => assert.strictEqual(res(k), t, k));
  assert.ok(t.startsWith('⚾ 11/1（日）vs ZERO'));
});

test('#成績 找不到：那天沒比賽 → 最近兩場日期；日期看不懂 → 提示寫法；從沒發布過 → 提示', () => {
  assert.strictEqual(res('#成績 11/16'), '11/16 沒有比賽成績，最近的是 11/1、10/25');
  assert.strictEqual(res('#成績 10/18'), '10/18 沒有比賽成績，最近的是 11/1、10/25');   // 取消的不算
  assert.strictEqual(res('#成績 abc'), '看不懂日期「abc」，請打 #成績 11/15 這樣的格式');
  assert.strictEqual(res('#成績', { data: { schedule: [practice('2026-11-08')] } }), '還沒有發布過賽事成績 📋');
  assert.strictEqual(res('#成績 11/1', { data: { schedule: [practice('2026-11-08')] } }), '還沒有發布過賽事成績 📋');
});

test('#成績 單場的成績檔讀不到 → 照樣有比分（時程的）和連結，沒有亮點；賽事沒填就不寫', () => {
  assert.strictEqual(res('#成績 10/4'), ['⚾ 10/4（日）vs A隊', '龍安 3：1 A隊，勝 🎉', `👉 ${SITE}/game.html?id=2026-10-04_G1_A%E9%9A%8A`].join('\n'));
});

test('#上一場 ＝ #成績 查最近一場；官網讀不到 → 資料暫時讀不到；#說明 列出 #成績', () => {
  assert.strictEqual(res('#上一場'), res('#成績 11/1'));
  assert.strictEqual(one('#成績', { siteDown: true }), '資料暫時讀不到，請稍後再試 🙏');
  assert.ok(one('#說明').includes('#成績　最近 5 場比分（#成績 11/15 看單場）'));
});

console.log('\n#球員（名字、背號、暱稱）');

test('#陳奕瑋：最新一季的打擊成績（手算：4 打數 2 安打、1 全壘打、3 打點；.500／.600／1.500）', () => {
  // 打擊率 2/4；上壘率 (2+1+0)/(4+1+0)=3/5；長打率：安打 2＝二安 1＋全壘打 1 → 壘打 2＋4＝6，6/4＝1.500
  assert.strictEqual(one('#陳奕瑋'), [
    '⚾ #5 陳奕瑋｜2026 大漢聯盟',
    '打擊：4 打數 2 安打、1 全壘打、3 打點',
    '打擊率 .500／上壘率 .600／長打率 1.500',
    `完整成績 👉 ${SITE}/standings.html`,
  ].join('\n'));
});

test('#5（背號）、#坦克（暱稱）都查得到同一位', () => {
  assert.strictEqual(one('#5'), one('#陳奕瑋'));
  assert.strictEqual(one('#坦克'), one('#陳奕瑋'));
});

test('有投球的球員多一行投手成績（5.1 局、自責分 2、三振 3）；沒全壘打不寫全壘打', () => {
  assert.strictEqual(one('#江佑霖'), [
    '⚾ #18 江佑霖｜2026 大漢聯盟',
    '打擊：3 打數 1 安打、0 打點',
    '打擊率 .333／上壘率 .333／長打率 .333',
    '投手：5.1 局、自責分 2、三振 3',
    `完整成績 👉 ${SITE}/standings.html`,
  ].join('\n'));
});

test('名字重複 → 請改打背號；本季沒出賽 → 提示；查無此人 → 提示 #說明', () => {
  assert.strictEqual(one('#林廷軒'), '有 2 位「林廷軒」，請改打背號：#19、#21');
  assert.strictEqual(one('#王新人'), '⚾ #33 王新人｜2026 大漢聯盟\n本季還沒有出賽紀錄');
  assert.strictEqual(one('#下2場'), '找不到「下2場」🤔 打 #說明 看用法');
});

console.log('\n#說明、進群組、出錯');

test('#說明（也接受 #help、#幫助）：列出用法', () => {
  const t = one('#說明');
  ['#下一場', '#練球', '#公告', '#戰績', '#上一場', '#陳奕瑋'].forEach((k) => assert.ok(t.includes(k), k));
  assert.strictEqual(t.split('\n')[1], '#行程　這週的練球、比賽（今天起 7 天）');   // V01.15.03：放第一行
  assert.strictEqual(one('#help'), t);
  assert.strictEqual(one('#幫助'), t);
});

test('機器人被邀進群組 → 自我介紹', () => {
  const r = run(null, { events: [{ type: 'join', replyToken: 'j', source: { type: 'group', groupId: 'G1' } }] });
  assert.strictEqual(r.replies[0], '大家好，我是龍安虛擬球隊經理 ⚾\n我可以回答比賽、練球、戰績、球員成績等問題，打「#說明」看用法。\n我只處理「#」開頭的訊息，其他聊天內容不會記錄。\n打「#行程」就知道這週要幹嘛 📅');
});

test('官網資料讀不到 → 回「資料暫時讀不到」，不會出錯中斷', () => {
  const r = run(['#下一場', '#陳奕瑋'], { siteDown: true });
  assert.deepStrictEqual(r.replies, ['資料暫時讀不到，請稍後再試 🙏', '資料暫時讀不到，請稍後再試 🙏']);
});

test('沒設定 LINE 金鑰 → 不送出，記一筆錯誤，不會出錯中斷', () => {
  const r = run('#說明', { props: { LINE_CHANNEL_ACCESS_TOKEN: '' } });
  assert.strictEqual(r.sent.length, 0);
  assert.ok(r.logs.some((l) => /LINE_CHANNEL_ACCESS_TOKEN/.test(l)));
  assert.strictEqual(r.res.ok, true);
});

console.log('\n不影響原本的隊務功能');

test('LINE 的請求不用隊務登入（強制登入模式也一樣），也不寫進「調度紀錄」', () => {
  const r = run('#說明', { props: { TEAM_PASSCODE: 'abc', AUTH_ENFORCED: 'true' } });
  assert.strictEqual(r.replies.length, 1);
  assert.deepStrictEqual(Object.keys(r.ss.sheets), []);
});

test('LINE 驗證 Webhook 時送來空的 events → 回 ok，不送任何訊息', () => {
  const r = run(null, { events: [] });
  assert.deepStrictEqual([r.res.ok, r.fetches.length], [true, 0]);
});

console.log(`\n共 ${passed} 項通過`);
