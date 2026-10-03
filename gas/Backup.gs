// ==========================================
// 實況賽事紀錄（tools/game-record.html）的雲端備份
// 一場比賽一個分頁「賽事紀錄_比賽ID」，一筆紀錄一列，人看得懂，也能讀回來接著記：
//   第 1～6 列：比賽 ID、比賽日期、比賽場次、對手名稱、建立時間、更新時間（比賽 ID 那列的 E 欄放開賽設定）
//   第 7 列空白，第 8 列起：半局標題列（龍安攻橘色、對手攻淺藍色）與紀錄列
//   A～D 欄給人看（棒次｜簡寫｜球員｜描述），E 欄是程式讀的資料（這一筆紀錄，灰色小字，請勿修改）
// 每一列要寫什麼字由手機端算好（game-core.js 的 sheetRows），這裡只負責寫入、上色、讀回；每次上傳整頁重寫。
// ==========================================
var RECORD_SHEET_PREFIX = '賽事紀錄_';
var RECORD_FIRST_ROW = 8;            // 半局標題與紀錄從第 8 列開始
var RECORD_CELL_MAX = 50000;         // Google 試算表一格最多 5 萬字
var RECORD_US_BG = '#f9cb9c';        // 龍安攻的半局標題：橘色
var RECORD_OPP_BG = '#c9daf8';       // 對手攻的半局標題：淺藍色
var RECORD_DATA_FONT = '#999999';    // E 欄（程式用）：灰色小字

// 分頁名稱：和陣容調度工具的比賽分頁同一套替換規則（/ \ ? * [ ] : 換成 -）
function recordSheetName_(gameId) {
  return RECORD_SHEET_PREFIX + String(gameId).replace(/[\/\\\?\*\[\]\:]/g, '-');
}

function saveRecordBackup_(ss, gameId, setup, rows) {
  if (typeof gameId !== 'string' || !/^\d{4}-\d{2}-\d{2}_G\d+_.+/.test(gameId)) {
    return { success: false, message: '比賽 ID 格式不對：' + gameId };
  }
  if (!setup || typeof setup !== 'object' || !(rows instanceof Array)) {
    return { success: false, message: '備份資料不完整（缺少開賽設定或紀錄）' };
  }
  if (setup.id !== gameId) {
    return { success: false, message: '開賽設定的比賽 ID（' + setup.id + '）和要存的比賽 ID 不同' };
  }
  var body = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] || {};
    var cells = row.cells;
    if (!(cells instanceof Array) || cells.length !== 4) return { success: false, message: '備份資料不完整（第 ' + (i + 1) + ' 列格式不對）' };
    if (row.type === 'half') body.push({ values: cells.concat(['']), bg: row.offense === 'us' ? RECORD_US_BG : RECORD_OPP_BG });
    else if (row.type === 'event' && row.ev && typeof row.ev.t === 'string') body.push({ values: cells.concat([JSON.stringify(row.ev)]), bg: null });
    else return { success: false, message: '備份資料不完整（第 ' + (i + 1) + ' 列沒有紀錄資料）' };
  }

  var now = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm:ss');
  var head = [
    ['比賽 ID', gameId, '', '', JSON.stringify(setup)],
    ['比賽日期', setup.date || '', '', '', ''],
    ['比賽場次', setup.gameNum || '', '', '', ''],
    ['對手名稱', setup.opponent || '', '', '', ''],
    ['建立時間', now, '', '', ''],
    ['更新時間', now, '', '', ''],
    ['', '', '', '', '事件資料（程式用，請勿修改）'],
  ];
  var values = head.concat(body.map(function (b) { return b.values; }));
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < 5; c++) {
      if (String(values[r][c]).length > RECORD_CELL_MAX) {
        return { success: false, message: '第 ' + (r + 1) + ' 列有一格超過 5 萬字（試算表一格的上限），無法備份' };
      }
    }
  }

  var name = recordSheetName_(gameId);
  var sh = ss.getSheetByName(name);
  if (sh) {
    var old = sh.getRange(1, 2, 5, 1).getValues();
    if (String(old[0][0]) !== gameId) {
      return { success: false, message: '分頁「' + name + '」已經是另一場比賽（' + old[0][0] + '）的紀錄' };
    }
    if (old[4][0]) values[4][1] = old[4][0];   // 建立時間保留第一次的
    sh.clear();
  } else {
    sh = ss.insertSheet(name);
  }

  sh.getRange(1, 1, values.length, 5).setValues(values);
  for (var k = 0; k < body.length; k++) {
    if (body[k].bg) sh.getRange(RECORD_FIRST_ROW + k, 1, 1, 4).setBackground(body[k].bg);
  }
  sh.getRange(1, 5, values.length, 1).setFontColor(RECORD_DATA_FONT).setFontSize(8);
  sh.setColumnWidth(1, 80);
  sh.setColumnWidth(2, 90);
  sh.setColumnWidth(3, 120);
  sh.setColumnWidth(4, 420);
  sh.setColumnWidth(5, 160);
  var count = rows.filter(function (x) { return x && x.type === 'event'; }).length;
  return { success: true, message: '已備份（' + count + ' 筆）', events: count };
}

function loadRecordBackup_(ss, gameId) {
  var name = recordSheetName_(gameId || '');
  var sh = ss.getSheetByName(name);
  var v = sh ? sh.getDataRange().getValues() : [];
  if (!sh || String((v[0] || [])[1]) !== String(gameId)) {
    return { success: false, message: '找不到這場比賽的雲端備份：' + gameId };
  }
  var setup;
  try { setup = JSON.parse(v[0][4]); } catch (e) {
    return { success: false, message: '雲端備份第 1 列的開賽設定（E 欄）被改壞了，無法讀回' };
  }
  var events = [];
  for (var r = RECORD_FIRST_ROW - 1; r < v.length; r++) {
    var cell = String(v[r][4] || '');
    if (!cell) continue;                 // 半局標題列、空白列
    try { events.push(JSON.parse(cell)); } catch (e2) {
      return { success: false, message: '雲端備份第 ' + (r + 1) + ' 列的事件資料（E 欄）被改壞了，無法讀回' };
    }
  }
  return { success: true, record: { setup: setup, events: events }, updatedAt: v[5] ? v[5][1] : '' };
}
