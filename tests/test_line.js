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

const SITE = 'https://a24627622-dev.github.io/LongAn_baseball_roster';
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
// 氣象署 F-C0032-001（縣市 36 小時預報）的格式
const WEATHER = { records: { location: [{ locationName: '新北市', weatherElement: [{ elementName: 'PoP', time: [
  { startTime: '2026-11-14 18:00:00', endTime: '2026-11-15 06:00:00', parameter: { parameterName: '20' } },
  { startTime: '2026-11-15 06:00:00', endTime: '2026-11-15 18:00:00', parameter: { parameterName: '60' } },
] }] }] } };

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
      return id === GAME_1101.id ? { code: 200, body: GAME_1101 } : { code: 404, body: '' };
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

test('#下一場：跳過已過的比賽；日期、對手、賽事、集合／開賽、球場、地圖、停車、集合點、注意事項、降雨機率、倒數', () => {
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
    '☔ 降雨機率 60%',
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

test('天氣：超過預報範圍、沒有氣象署金鑰、氣象署讀不到 → 不顯示降雨機率，其他照常', () => {
  const far = one('#下一場', { now: TPE(2026, 11, 12, 20) });
  assert.ok(!/降雨機率/.test(far) && /還有 3 天/.test(far));
  const noKey = run('#下一場', { now: TPE(2026, 11, 14, 20), props: { CWA_API_KEY: '' } });
  assert.ok(!/降雨機率/.test(noKey.replies[0]));
  assert.ok(!noKey.fetches.some((f) => f.url.includes('cwa.gov.tw')));
  assert.ok(!/降雨機率/.test(one('#下一場', { now: TPE(2026, 11, 14, 20), weather: null })));
});

test('天氣：查的是球場所在縣市（大漢B球場 → 新北市），網址帶金鑰', () => {
  const r = run('#下一場', { now: TPE(2026, 11, 14, 20) });
  const w = r.fetches.find((f) => f.url.includes('cwa.gov.tw'));
  assert.strictEqual(w.url, 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001?Authorization=cwa&locationName=%E6%96%B0%E5%8C%97%E5%B8%82');
});

test('#練球：下一次練球；地點空白 → 「地點未定，請留意公告」', () => {
  assert.strictEqual(one('#練球', { now: TPE(2026, 11, 5, 9) }),
    ['🏃 下一次練球', '11/8（日）08:00～12:00', '📍 地點未定，請留意公告', '還有 3 天'].join('\n'));
});

test('#練球：下一次練球取消 → 註明取消和備註', () => {
  assert.strictEqual(one('#練球', { now: TPE(2026, 11, 16, 9) }), '❌ 11/22（日）練球取消：因雨取消');
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

test('#上一場：最近一場有賽事成績的比賽，比分和勝負，附賽事成績頁連結', () => {
  assert.strictEqual(one('#上一場'), `⚾ 上一場：11/1（日）vs ZERO\n龍安 14：3 ZERO，勝 🎉\n👉 ${SITE}/game.html?id=2026-11-01_G1_ZERO`);
});

test('#上一場：從來沒有發布過賽事成績 → 提示', () => {
  assert.strictEqual(one('#上一場', { data: { schedule: [practice('2026-11-08')] } }), '還沒有發布過賽事成績 📋');
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
  assert.strictEqual(one('#help'), t);
  assert.strictEqual(one('#幫助'), t);
});

test('機器人被邀進群組 → 自我介紹', () => {
  const r = run(null, { events: [{ type: 'join', replyToken: 'j', source: { type: 'group', groupId: 'G1' } }] });
  assert.strictEqual(r.replies[0], '大家好，我是龍安虛擬球隊經理 ⚾\n我可以回答比賽、練球、戰績、球員成績等問題，打「#說明」看用法。\n我只處理「#」開頭的訊息，其他聊天內容不會記錄。');
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
