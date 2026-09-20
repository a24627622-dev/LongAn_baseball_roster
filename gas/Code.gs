// ==========================================
// 全域設定
// ==========================================

// 局數比分表：先固定 5 局（延長賽狀況之後再擴充，目前只做格式，實際輸入工具晚點做）
var INNINGS_COUNT = 5;
var INNING_HEADER_ROW = 5;
var HOME_TEAM_ROW = 6;   // 龍安固定在第6列
var AWAY_TEAM_ROW = 7;   // 對手固定在第7列（隊名依 gameInfo.opponent 動態帶入，不寫死）

// 打者資料區塊：21欄（打順~角色 5欄 + AB~SB 10欄 + AVG/OBP/SLG/OPS 4欄 + 調度上傳時間 + 成績上傳時間）
var BATTER_HEADERS = ["打順", "守位", "背號", "球員姓名", "角色", "AB", "R", "H", "2B", "3B", "HR", "RBI", "BB", "K", "SB", "AVG", "OBP", "SLG", "OPS", "調度上傳時間", "成績上傳時間"];
var BATTER_WIDTH = BATTER_HEADERS.length; // 21
// 純守位變更列（同一棒次同一球員再次出現）的打擊欄位填充值
var DASH = "-";

// 投手資料區塊：14欄（順序~WP）+ 右側 ERA/K9/BB9/WHIP 4欄
// 刻意對齊打者表 AVG 開始的欄位位置（P欄），中間 O 欄留空，視覺上跟打者表一致
var PITCHER_HEADERS = ["順序", "守位", "背號", "球員姓名", "更換說明", "IP", "R", "H", "ER", "BB", "SO", "HR", "HBP", "WP"];
var PITCHER_WIDTH = PITCHER_HEADERS.length; // 14
var PITCHER_RATE_HEADERS = ["ERA", "K9", "BB9", "WHIP"];
var PITCHER_RATE_START_COL = 16; // P欄
var PITCHER_RATE_WIDTH = PITCHER_RATE_HEADERS.length; // 4

var COLOR_HEADER_BG = "#1e293b";
var COLOR_HEADER_FONT = "#ffffff";
var COLOR_TOTALS_BG = "#e2f0e2";
var COLOR_INNING_BG = "#93c47d";
var COLOR_RHE_BG = "#ffd966";
var COLOR_TEAMNAME_BG = "#f1f5f9";

// 打者列底色（比照戰報海報的配色）：先發＝「打順」欄藍底白字 + 其餘欄位冰藍色；替補＝整列白底
var COLOR_STARTER_BADGE_BG = "#2563eb";
var COLOR_STARTER_BADGE_FONT = "#ffffff";
var COLOR_STARTER_ROW_BG = "#dbeafe";
var COLOR_ROW_WHITE_BG = "#ffffff";
var COLOR_ROW_BLACK_FONT = "#000000";

// ==========================================
// 1. GET 請求：讀取「球員名單」分頁 (含投手標記)
// ==========================================
function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("球員名單");

    if (!sheet) {
      return jsonOut({ success: false, message: "找不到「球員名單」工作表！" });
    }

    var values = sheet.getDataRange().getValues();
    var backgrounds = sheet.getDataRange().getBackgrounds();
    var headers = values[0];
    var nameIndex = headers.indexOf("球員姓名");
    var players = [];

    for (var i = 1; i < values.length; i++) {
      var row = values[i];
      if (!row[nameIndex]) continue;

      var p = {};
      for (var j = 0; j < headers.length; j++) {
        p[headers[j]] = row[j];
      }
      var bg = (nameIndex !== -1 && backgrounds[i]) ? backgrounds[i][nameIndex].toLowerCase() : "";
      p.isPitcher = (bg === "#ffd966" || bg === "#d9ead3" || bg === "#b6d7a8");
      players.push(p);
    }

    return ContentService.createTextOutput(JSON.stringify(players))
                         .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return jsonOut({ success: false, message: "讀取球員名單時發生錯誤：" + err.toString() });
  }
}

// ==========================================
// 2. POST 請求：建立賽事分頁、寫入先發/調度、回讀歷史紀錄
// ==========================================
function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var data = JSON.parse(e.postData.contents);

    // 隊務登入驗證（Auth.gs）：login／authStatus 在這裡直接回應；沒通過驗證的請求在這裡被擋下
    var gate = authGate_(data);
    if (gate) return gate;

    var action = data.action;
    var gameInfo = data.gameInfo || {};
    var timestamp = new Date();
    var timeFormatted = Utilities.formatDate(timestamp, "GMT+8", "yyyy/MM/dd HH:mm:ss");

    var gameIdStr = ((gameInfo.date || "") + "_" + (gameInfo.gameNum || "") + "_" + (gameInfo.opponent || ""))
                    .replace(/[\/\\\?\*\[\]\:]/g, "-");

    // action = getGameLineup：回讀某場比賽目前已上傳的完整先發＋調度紀錄
    if (action === 'getGameLineup') {
      if (!gameIdStr || gameIdStr === "__") {
        return jsonOut({ success: false, message: "請先填寫比賽日期／場次／對手名稱，才能搜尋對應的雲端紀錄。" });
      }
      var lookupSheet = ss.getSheetByName(gameIdStr);
      if (!lookupSheet) {
        return jsonOut({ success: false, message: "找不到此場比賽的雲端紀錄：" + gameIdStr });
      }
      var loaded = readGameSheetAsActiveLineup(lookupSheet);
      return jsonOut({
        success: true, mode: 'json', message: "讀取成功",
        data: { activeLineup: loaded.activeLineup, pitchers: readGameSheetPitchers(lookupSheet) }
      });
    }

    // 歷史紀錄備份 (流水簿)
    var logSheet = ss.getSheetByName("調度紀錄");
    if (!logSheet) {
      logSheet = ss.insertSheet("調度紀錄");
      logSheet.appendRow(["時間戳記", "動作", "日期", "場次", "對手", "詳細內容 JSON"]);
    }
    // 通行證（token）不寫進流水簿
    var logData = {};
    for (var k in data) { if (k !== 'token' && k !== 'passcode') logData[k] = data[k]; }
    logSheet.appendRow([timestamp, action, gameInfo.date || "", gameInfo.gameNum || "", gameInfo.opponent || "", JSON.stringify(logData)]);

    if (gameIdStr && gameIdStr !== "__") {
      var gameSheet = ss.getSheetByName(gameIdStr);

      // 全新比賽：一次建立完整版面（基本資料／局數比分表／打者表／投手表）
      if (!gameSheet) {
        gameSheet = ss.insertSheet(gameIdStr);
        initGameSheetLayout(gameSheet, gameIdStr, gameInfo, timeFormatted);
      }

      if (action === 'saveStarters') {
        var starters = data.lineup || data.starters || [];
        var startersAsSlots = starters.map(function (p) {
          return { starter: p, substitutes: [] };
        });
        writeBatterBlock(gameSheet, startersAsSlots, timeFormatted);
        writePitcherBlock(gameSheet, { activeLineup: startersAsSlots, pitchers: data.pitchers }, timeFormatted);
      }

      else if (action === 'saveSubstitutions' || action === 'saveChanges') {
        if (data.activeLineup) {
          writeBatterBlock(gameSheet, data.activeLineup, timeFormatted);
          writePitcherBlock(gameSheet, data, timeFormatted);
        } else {
          var subs = data.substitutions || data.changes || [];
          appendLegacySubstituteRows(gameSheet, subs);
        }
      }

      // action = finishGame：比賽結案。先完整同步一次最終陣容與投手表，
      // 再於基本資料區蓋上「比賽結束時間」代表本場已收尾。
      // （前端收到 success 才會清除本機暫存，同步失敗時草稿會保留）
      else if (action === 'finishGame') {
        if (data.activeLineup && data.activeLineup.length > 0) {
          writeBatterBlock(gameSheet, data.activeLineup, timeFormatted);
          writePitcherBlock(gameSheet, data, timeFormatted);
        }
        gameSheet.getRange(3, 3, 1, 2).setValues([["比賽結束時間", timeFormatted]]);
        gameSheet.getRange(3, 3).setFontWeight("bold");

        return jsonOut({
          success: true,
          message: "本場比賽已結案，結束時間：" + timeFormatted,
          finishedAt: timeFormatted
        });
      }
    }

    return jsonOut({ success: true, message: "同步成功！" });

  } catch (err) {
    return jsonOut({ success: false, message: err.toString() });
  }
}

// ==========================================
// 共用工具函式
// ==========================================

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}

// 在指定分頁裡，找到 A 欄內容等於 label 的那一列（例如"打順"、"順序"），找不到回傳 -1
function findHeaderRowByLabel(sheet, label, maxScanRows) {
  var lastCheckRow = Math.min(sheet.getLastRow(), maxScanRows || 200);
  if (lastCheckRow < 1) return -1;
  var colA = sheet.getRange(1, 1, lastCheckRow, 1).getValues();
  for (var i = 0; i < colA.length; i++) {
    if (colA[i][0] === label) return i + 1;
  }
  return -1;
}

// 確保表頭列是完整、正確的標準格式；不是的話自動補齊欄位名稱與樣式
function ensureHeaderRow(sheet, headerRow, headers, width) {
  var current = sheet.getRange(headerRow, 1, 1, width).getValues()[0];
  var matches = headers.every(function (h, i) { return current[i] === h; });
  if (matches) return;
  sheet.getRange(headerRow, 1, 1, width).setValues([headers]);
  sheet.getRange(headerRow, 1, 1, width)
       .setBackground(COLOR_HEADER_BG)
       .setFontColor(COLOR_HEADER_FONT)
       .setFontWeight("bold");
}

// ==========================================
// 建立全新比賽分頁的完整版面
// ==========================================
function initGameSheetLayout(sheet, gameIdStr, gameInfo, timeFormatted) {
  sheet.getRange(1, 1, 1, 4).setValues([["比賽 ID", gameIdStr, "比賽日期", gameInfo.date || ""]]);
  sheet.getRange(2, 1, 1, 4).setValues([["比賽場次", gameInfo.gameNum || "", "對手名稱", gameInfo.opponent || ""]]);
  sheet.getRange(3, 1, 1, 2).setValues([["建立時間", timeFormatted]]);
  // 第4列留白分隔

  // --- 局數比分表（第5~7列）---
  var inningHeader = [""];
  for (var i = 1; i <= INNINGS_COUNT; i++) inningHeader.push(i.toString());
  inningHeader.push("R", "H", "E");
  sheet.getRange(INNING_HEADER_ROW, 1, 1, inningHeader.length).setValues([inningHeader]);
  sheet.getRange(INNING_HEADER_ROW, 2, 1, INNINGS_COUNT).setBackground(COLOR_INNING_BG).setFontWeight("bold");
  sheet.getRange(INNING_HEADER_ROW, 2 + INNINGS_COUNT, 1, 3).setBackground(COLOR_RHE_BG).setFontWeight("bold");

  sheet.getRange(HOME_TEAM_ROW, 1).setValue("龍安");
  sheet.getRange(AWAY_TEAM_ROW, 1).setValue(gameInfo.opponent || "對手");
  sheet.getRange(HOME_TEAM_ROW, 1, 2, 1).setBackground(COLOR_TEAMNAME_BG).setFontWeight("bold");
  // 各局比分、E(失誤) 這階段先留白手動輸入；龍安的 R、H 等打者表建立後會自動接上公式

  // --- 打者表表頭（固定在第9列：5+4）---
  var batterHeaderRow = INNING_HEADER_ROW + 4;
  sheet.getRange(batterHeaderRow, 1, 1, BATTER_WIDTH).setValues([BATTER_HEADERS]);
  sheet.getRange(batterHeaderRow, 1, 1, BATTER_WIDTH)
       .setBackground(COLOR_HEADER_BG).setFontColor(COLOR_HEADER_FONT).setFontWeight("bold");

  // 先建立空的打者成績合計列（上傳先發後會自動長出球員列）
  var battersTotalsRow = writeBatterBlock(sheet, [], timeFormatted);

  // 打者區塊下方空一列，接著放投手表表頭（這是投手表第一次出現，之後都用搜尋"順序"定位，這裡要先手動寫出來）
  var pitcherHeaderRow = battersTotalsRow + 2;
  sheet.getRange(pitcherHeaderRow, 1, 1, PITCHER_WIDTH).setValues([PITCHER_HEADERS]);
  sheet.getRange(pitcherHeaderRow, 1, 1, PITCHER_WIDTH)
       .setBackground(COLOR_HEADER_BG).setFontColor(COLOR_HEADER_FONT).setFontWeight("bold");
  sheet.getRange(pitcherHeaderRow, PITCHER_RATE_START_COL, 1, PITCHER_RATE_WIDTH).setValues([PITCHER_RATE_HEADERS]);
  sheet.getRange(pitcherHeaderRow, PITCHER_RATE_START_COL, 1, PITCHER_RATE_WIDTH)
       .setBackground(COLOR_INNING_BG).setFontWeight("bold");

  writePitcherBlock(sheet, { activeLineup: [] }, timeFormatted);
}

// ==========================================
// 打者資料區塊
// ==========================================

function buildStatFormulas(r) {
  var fAVG = '=IF(F' + r + '>0, TEXT(H' + r + '/F' + r + ', ".000"), ".000")';
  var fOBP = '=IF((F' + r + '+M' + r + ')>0, TEXT((H' + r + '+M' + r + ')/(F' + r + '+M' + r + '), ".000"), ".000")';
  var fSLG = '=IF(F' + r + '>0, TEXT((H' + r + '+I' + r + '+2*J' + r + '+3*K' + r + ')/F' + r + ', ".000"), ".000")';
  var fOPS = '=IF(F' + r + '>0, TEXT(((H' + r + '+M' + r + ')/(F' + r + '+M' + r + ')) + ((H' + r + '+I' + r + '+2*J' + r + '+3*K' + r + ')/F' + r + '), ".000"), ".000")';
  return [fAVG, fOBP, fSLG, fOPS];
}

// 把完整的 activeLineup（每個打序的 starter + substitutes[]）整段寫入試算表。
// 資料列數量變動時用插入/刪除列處理，讓下面的成績合計列、投手表都正確跟著位移。
// AB~SB 手動填的成績、以及「成績上傳時間」欄位，依「打順+姓名+角色」比對保留，不會被清空。
function writeBatterBlock(sheet, activeLineupArr, timeFormatted) {
  var headerRow = findHeaderRowByLabel(sheet, "打順", 30);
  if (headerRow === -1) return;

  ensureHeaderRow(sheet, headerRow, BATTER_HEADERS, BATTER_WIDTH);

  var lastRow = sheet.getLastRow();
  var oldEndRow = headerRow;
  var savedStats = {};
  var seenReadCount = {};

  if (lastRow > headerRow) {
    var existing = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, BATTER_WIDTH).getValues();
    for (var i = 0; i < existing.length; i++) {
      var role = (existing[i][4] || "").toString();
      if (role !== "先發" && role !== "替補") break;
      oldEndRow = headerRow + 1 + i;
      // 同一棒次可能有同名同角色的多列（代打者之後又換守位），
      // 所以 key 要再帶上「第幾次出現」，否則後面的列會覆蓋前面的列，
      // 重寫時就會把該球員真正的成績換成守位變更列的「-」。
      var baseKey = existing[i][0] + "|" + existing[i][3] + "|" + role;
      seenReadCount[baseKey] = (seenReadCount[baseKey] || 0) + 1;
      var key = baseKey + "|" + seenReadCount[baseKey];
      savedStats[key] = { stats: existing[i].slice(5, 15), statTime: existing[i][20] };
    }
  }

  var flatRows = [];
  activeLineupArr.forEach(function (slot, idx) {
    var order = (idx + 1).toString();
    var people = [slot.starter].concat(slot.substitutes || []);
    var seenInSlot = {};
    people.forEach(function (p, subIdx) {
      if (!p) return;
      var isStarter = subIdx === 0;
      // 同一棒次裡同一位球員再次出現 = 純守位變更（例如 3B→P、DH→RF），
      // 不是另一筆打擊紀錄。他的打擊成績集中在這個棒次的第一列，
      // 這一列的打擊欄位一律寫「-」；投球成績另外記在投手表。
      var ident = (p.number || "") + "|" + (p.name || "");
      var isPositionChange = !!seenInSlot[ident];
      seenInSlot[ident] = true;
      flatRows.push({
        order: order, pos: p.posLabel || p.pos || "", number: p.number || "",
        name: isStarter ? (p.name || "") : ("↳ " + (p.name || "")),
        role: isStarter ? "先發" : "替補", isStarter: isStarter,
        isPositionChange: isPositionChange
      });
    });
  });

  var newCount = flatRows.length;
  var oldCount = oldEndRow - headerRow;

  if (newCount > oldCount) {
    sheet.insertRowsAfter(oldEndRow > headerRow ? oldEndRow : headerRow, newCount - oldCount);
  } else if (newCount < oldCount) {
    sheet.deleteRows(headerRow + newCount + 1, oldCount - newCount);
  }

  var totalsRow;
  if (newCount === 0) {
    totalsRow = headerRow + 1;
    writeTeamTotalsRow(sheet, headerRow + 1, 0);
  } else {
    var startRow = headerRow + 1;
    var outValues = [];
    var seenWriteCount = {};
    flatRows.forEach(function (row, i) {
      var r = startRow + i;
      var stats, formulas, statTime;
      if (row.isPositionChange) {
        // 純守位變更列：打擊欄位與率值一律「-」。
        // 率值寫字串而不是公式 —— 若 AB 欄是文字「-」，Sheets 的 "-">0 會判定為 TRUE，
        // 公式會算出無意義的值。
        stats = [DASH, DASH, DASH, DASH, DASH, DASH, DASH, DASH, DASH, DASH];
        formulas = [DASH, DASH, DASH, DASH];
        statTime = DASH;
      } else {
        var baseKey = row.order + "|" + row.name + "|" + row.role;
        seenWriteCount[baseKey] = (seenWriteCount[baseKey] || 0) + 1;
        var key = baseKey + "|" + seenWriteCount[baseKey];
        var saved = savedStats[key];
        stats = saved ? saved.stats : ["", "", "", "", "", "", "", "", "", ""];
        statTime = saved ? saved.statTime : "";
        formulas = buildStatFormulas(r);
      }
      outValues.push([row.order, row.pos, row.number, row.name, row.role].concat(stats).concat(formulas).concat([timeFormatted || "", statTime]));
    });
    var rng = sheet.getRange(startRow, 1, outValues.length, BATTER_WIDTH);
    rng.setValues(outValues);
    rng.setFontWeight("normal");
    // 先整段清成白底黑字，避免插入列時繼承到表頭的深色底（Sheets 插入列預設會沿用上一列格式）
    rng.setBackground(COLOR_ROW_WHITE_BG).setFontColor(COLOR_ROW_BLACK_FONT);
    flatRows.forEach(function (row, i) {
      var r = startRow + i;
      if (row.isStarter) {
        sheet.getRange(r, 1, 1, BATTER_WIDTH).setFontWeight("bold");
        // 先發：「打順」欄藍底白字，其餘欄位冰藍色（比照戰報海報配色）
        sheet.getRange(r, 1, 1, 1).setBackground(COLOR_STARTER_BADGE_BG).setFontColor(COLOR_STARTER_BADGE_FONT);
        sheet.getRange(r, 2, 1, BATTER_WIDTH - 1).setBackground(COLOR_STARTER_ROW_BG).setFontColor(COLOR_ROW_BLACK_FONT);
      }
      // 替補列維持整列白底（上面已經設過，這裡不用再處理）
    });
    totalsRow = startRow + outValues.length;
    writeTeamTotalsRow(sheet, startRow, outValues.length);
  }

  // 局數比分表「龍安」列的 R、H 直接接上打者成績合計列（自動加總，不用手動輸入）
  sheet.getRange(HOME_TEAM_ROW, 2 + INNINGS_COUNT).setFormula("=G" + totalsRow);
  sheet.getRange(HOME_TEAM_ROW, 3 + INNINGS_COUNT).setFormula("=H" + totalsRow);

  return totalsRow;
}

function writeTeamTotalsRow(sheet, startRow, playerRowCount) {
  var totalsRow = startRow + playerRowCount;
  var rowValues = ["", "", "", "成績合計", ""];

  if (playerRowCount === 0) {
    rowValues = rowValues.concat(["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    sheet.getRange(totalsRow, 1, 1, BATTER_WIDTH).setValues([rowValues]);
    sheet.getRange(totalsRow, 1, 1, BATTER_WIDTH).setBackground(COLOR_TOTALS_BG).setFontWeight("bold");
    return;
  }

  var firstDataRow = startRow;
  var lastDataRow = startRow + playerRowCount - 1;
  var sumCols = ["F", "G", "H", "I", "J", "K", "L", "M", "N", "O"]; // AB~SB
  sumCols.forEach(function (col) {
    rowValues.push('=SUM(' + col + firstDataRow + ':' + col + lastDataRow + ')');
  });
  var r = totalsRow;
  var fAVG = '=IF(F' + r + '>0, TEXT(H' + r + '/F' + r + ', ".000"), ".000")';
  var fOBP = '=IF((F' + r + '+M' + r + ')>0, TEXT((H' + r + '+M' + r + ')/(F' + r + '+M' + r + '), ".000"), ".000")';
  var fSLG = '=IF(F' + r + '>0, TEXT((H' + r + '+I' + r + '+2*J' + r + '+3*K' + r + ')/F' + r + ', ".000"), ".000")';
  var fOPS = '=IF(F' + r + '>0, TEXT(((H' + r + '+M' + r + ')/(F' + r + '+M' + r + ')) + ((H' + r + '+I' + r + '+2*J' + r + '+3*K' + r + ')/F' + r + '), ".000"), ".000")';
  rowValues.push(fAVG, fOBP, fSLG, fOPS, "", "");

  sheet.getRange(totalsRow, 1, 1, BATTER_WIDTH).setValues([rowValues]);
  sheet.getRange(totalsRow, 1, 1, BATTER_WIDTH).setBackground(COLOR_TOTALS_BG).setFontWeight("bold");
}

// ==========================================
// 投手資料區塊
// ==========================================

// 判斷這個人這次的守位是不是「投手(P)」。用 split(' ')[0] 精準比對，
// 避免 PH(代打)、PR(代跑) 被字首"P"誤判成投手。
function isPitcherEvent(p) {
  if (!p) return false;
  if ((p.pos || "").toString().trim() === "P") return true;
  var label = (p.posLabel || "").toString().trim();
  return label.split(/\s+/)[0] === "P";
}

function buildPitcherRateFormulas(r) {
  // F=IP, H=H, I=ER, J=BB, K=SO
  var fERA = '=IF(F' + r + '>0, TEXT(9*I' + r + '/F' + r + ', "0.00"), "0.00")';
  var fK9 = '=IF(F' + r + '>0, TEXT(9*K' + r + '/F' + r + ', "0.00"), "0.00")';
  var fBB9 = '=IF(F' + r + '>0, TEXT(9*J' + r + '/F' + r + ', "0.00"), "0.00")';
  var fWHIP = '=IF(F' + r + '>0, TEXT((H' + r + '+J' + r + ')/F' + r + ', "0.00"), "0.00")';
  return [fERA, fK9, fBB9, fWHIP];
}

function ensurePitcherRateHeader(sheet, headerRow) {
  var current = sheet.getRange(headerRow, PITCHER_RATE_START_COL, 1, PITCHER_RATE_WIDTH).getValues()[0];
  var matches = PITCHER_RATE_HEADERS.every(function (h, i) { return current[i] === h; });
  if (matches) return;
  sheet.getRange(headerRow, PITCHER_RATE_START_COL, 1, PITCHER_RATE_WIDTH).setValues([PITCHER_RATE_HEADERS]);
  sheet.getRange(headerRow, PITCHER_RATE_START_COL, 1, PITCHER_RATE_WIDTH).setBackground(COLOR_INNING_BG).setFontWeight("bold");
}

// 維護投手表（先發投手 + 後援投手）。投手名單由 Pitchers.gs 的 resolvePitchers_ 決定：
//   優先使用前端送來的 payload.pitchers（DH 制下投手不在打序裡，只能靠這個）；
//   舊版前端沒帶 pitchers 時，才退回掃 activeLineup 裡守位是 P 的球員。
// 每位投手只會出現一列（依上場順序）。
// IP/R/H/ER/BB/SO/HR/HBP/WP 這些數據欄位是手動填的，依「背號+姓名」比對保留，不會被清空。
// payload：{ activeLineup: [...], pitchers: [...] }（為了相容，直接傳 activeLineup 陣列也可以）
function writePitcherBlock(sheet, payload, timeFormatted) {
  if (Array.isArray(payload)) payload = { activeLineup: payload };
  var headerRow = findHeaderRowByLabel(sheet, "順序", 300);
  if (headerRow === -1) return;

  ensureHeaderRow(sheet, headerRow, PITCHER_HEADERS, PITCHER_WIDTH);
  ensurePitcherRateHeader(sheet, headerRow);

  var lastRow = sheet.getLastRow();
  var oldEndRow = headerRow;
  var savedStats = {};

  if (lastRow > headerRow) {
    var existing = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, PITCHER_WIDTH).getValues();
    for (var i = 0; i < existing.length; i++) {
      var label = (existing[i][4] || "").toString();
      if (label !== "先發投手" && label !== "後援投手") break;
      oldEndRow = headerRow + 1 + i;
      var key = existing[i][2] + "|" + existing[i][3]; // 背號|球員姓名
      savedStats[key] = existing[i].slice(5, 14); // F~N：IP~WP
    }
  }

  var pitchers = resolvePitchers_(payload || {});

  var newCount = pitchers.length;
  var oldCount = oldEndRow - headerRow;

  if (newCount > oldCount) {
    sheet.insertRowsAfter(oldEndRow > headerRow ? oldEndRow : headerRow, newCount - oldCount);
  } else if (newCount < oldCount) {
    sheet.deleteRows(headerRow + newCount + 1, oldCount - newCount);
  }

  if (newCount === 0) {
    writePitcherTotalsRow(sheet, headerRow + 1, 0);
    return;
  }

  var startRow = headerRow + 1;
  var outValues = [];
  pitchers.forEach(function (p, i) {
    var r = startRow + i;
    var key = p.number + "|" + p.name;
    var stats = savedStats[key] || ["", "", "", "", "", "", "", "", ""];
    var row = [(i + 1).toString(), p.posLabel, p.number, p.name, i === 0 ? "先發投手" : "後援投手"].concat(stats);
    outValues.push(row);
  });

  var pRng = sheet.getRange(startRow, 1, outValues.length, PITCHER_WIDTH);
  pRng.setValues(outValues);
  // 跟打者表一樣，先清成白底黑字，避免插入列時繼承到表頭的深色底
  pRng.setBackground(COLOR_ROW_WHITE_BG).setFontColor(COLOR_ROW_BLACK_FONT).setFontWeight("normal");
  pitchers.forEach(function (p, i) {
    var r = startRow + i;
    var rate = buildPitcherRateFormulas(r);
    var rateRng = sheet.getRange(r, PITCHER_RATE_START_COL, 1, PITCHER_RATE_WIDTH);
    rateRng.setValues([rate]);
    rateRng.setBackground(COLOR_ROW_WHITE_BG).setFontColor(COLOR_ROW_BLACK_FONT);
  });

  writePitcherTotalsRow(sheet, startRow, outValues.length);
}

function writePitcherTotalsRow(sheet, startRow, playerRowCount) {
  var totalsRow = startRow + playerRowCount;
  var rowValues = ["", "", "", "成績合計", ""];

  if (playerRowCount === 0) {
    rowValues = rowValues.concat(["", "", "", "", "", "", "", "", ""]);
    sheet.getRange(totalsRow, 1, 1, PITCHER_WIDTH).setValues([rowValues]);
    sheet.getRange(totalsRow, 1, 1, PITCHER_WIDTH).setBackground(COLOR_TOTALS_BG).setFontWeight("bold");
    sheet.getRange(totalsRow, PITCHER_RATE_START_COL, 1, PITCHER_RATE_WIDTH).setValues([["0.00", "0.00", "0.00", "0.00"]]);
    sheet.getRange(totalsRow, PITCHER_RATE_START_COL, 1, PITCHER_RATE_WIDTH).setBackground(COLOR_TOTALS_BG).setFontWeight("bold");
    return;
  }

  var firstDataRow = startRow;
  var lastDataRow = startRow + playerRowCount - 1;
  var sumCols = ["F", "G", "H", "I", "J", "K", "L", "M", "N"]; // IP~WP
  sumCols.forEach(function (col) {
    rowValues.push('=SUM(' + col + firstDataRow + ':' + col + lastDataRow + ')');
  });
  sheet.getRange(totalsRow, 1, 1, PITCHER_WIDTH).setValues([rowValues]);
  sheet.getRange(totalsRow, 1, 1, PITCHER_WIDTH).setBackground(COLOR_TOTALS_BG).setFontWeight("bold");

  var rate = buildPitcherRateFormulas(totalsRow);
  sheet.getRange(totalsRow, PITCHER_RATE_START_COL, 1, PITCHER_RATE_WIDTH).setValues([rate]);
  sheet.getRange(totalsRow, PITCHER_RATE_START_COL, 1, PITCHER_RATE_WIDTH).setBackground(COLOR_TOTALS_BG).setFontWeight("bold");
}

// ==========================================
// 回讀雲端歷史紀錄
// ==========================================

// 把試算表裡已經寫入的先發＋替補資料，讀回成前端 activeLineup 的資料結構
function readGameSheetAsActiveLineup(sheet) {
  var headerRow = findHeaderRowByLabel(sheet, "打順", 30);
  var slots = [];
  for (var i = 0; i < 9; i++) slots.push({ starter: null, substitutes: [] });
  if (headerRow === -1) return { activeLineup: [] };

  var lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) return { activeLineup: [] };

  var rows = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, 5).getValues(); // A~E
  for (var i = 0; i < rows.length; i++) {
    var order = parseInt(rows[i][0], 10);
    var role = (rows[i][4] || "").toString();
    if (!order || order < 1 || order > 9) continue;
    if (role !== "先發" && role !== "替補") continue;

    var posLabel = (rows[i][1] || "").toString();
    var posCode = posLabel.split(" ")[0];
    var rawName = (rows[i][3] || "").toString().replace(/^↳\s*/, "");

    var playerObj = {
      pos: posCode, posLabel: posLabel, number: (rows[i][2] || "").toString(),
      name: rawName, id: null
    };

    if (role === "先發") {
      slots[order - 1].starter = playerObj;
    } else {
      playerObj.isUploaded = true;
      slots[order - 1].substitutes.push(playerObj);
    }
  }

  var activeLineup = slots.filter(function (s) { return s.starter; });
  return { activeLineup: activeLineup };
}

// 讀回投手表（先發投手／後援投手），給前端回讀 DH 制比賽時還原投手用
function readGameSheetPitchers(sheet) {
  var headerRow = findHeaderRowByLabel(sheet, "順序", 300);
  if (headerRow === -1) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) return [];
  var rows = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, 5).getValues(); // A~E
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var label = (rows[i][4] || "").toString();
    if (label !== "先發投手" && label !== "後援投手") break;
    out.push({
      posLabel: (rows[i][1] || "").toString(),
      pos: "P",
      number: (rows[i][2] || "").toString(),
      name: (rows[i][3] || "").toString()
    });
  }
  return out;
}

// 相容非常舊版前端可能送出的扁平 substitutions/changes 陣列格式（附加寫入，不覆寫；
// 正常情況下現在的前端一律會送 activeLineup，這個函式應該用不到）
function appendLegacySubstituteRows(sheet, subs) {
  for (var k = 0; k < subs.length; k++) {
    var s = subs[k];
    var subRow = sheet.getLastRow() + 1;
    var formulas = buildStatFormulas(subRow);
    sheet.appendRow([
      s.battingOrder ? s.battingOrder.toString() : "-",
      s.posLabel || s.pos || "", s.number || "", "↳ " + (s.name || ""), "替補",
      "", "", "", "", "", "", "", "", "", "",
      formulas[0], formulas[1], formulas[2], formulas[3], "", ""
    ]);
    sheet.getRange(subRow, 1, 1, BATTER_WIDTH).setFontWeight("normal");
  }
}

// ==========================================
// 以下為既有的一次性手動搶救用工具，維持原樣未修改
// （日期／球員名單皆寫死在程式碼裡，只補救 2026-08-30_G4_雨人 這場，不影響新分頁）
// ==========================================

function restoreRainManExactWithSubs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var targetGameId = "2026-08-30_G4_雨人";

  var oldSheet = ss.getSheetByName(targetGameId);
  if (oldSheet) ss.deleteSheet(oldSheet);

  var sheet = ss.insertSheet(targetGameId);
  sheet.appendRow(["比賽 ID", targetGameId, "比賽日期", "2026-08-30"]);
  sheet.appendRow(["比賽場次", "G4", "對手名稱", "雨人"]);
  sheet.appendRow(["建立時間", "2026/08/30 18:21:00", "", ""]);
  sheet.appendRow([""]);

  var headers = ["打順", "守位", "背號", "球員姓名", "角色", "AB", "R", "H", "2B", "3B", "HR", "RBI", "BB", "K", "SB", "AVG", "OBP", "OPS"];
  sheet.appendRow(headers);
  sheet.getRange(5, 1, 1, headers.length)
       .setBackground("#1e293b")
       .setFontColor("#ffffff")
       .setFontWeight("bold");

  var fullRoster = [
    { order: "1", pos: "3B (5)", num: "56", name: "蘇垣華/小天", role: "先發" },
    { order: "1", pos: "P (1)",  num: "56", name: "↳ 蘇垣華/小天", role: "替補" },
    { order: "2", pos: "1B (3)", num: "17", name: "蘇巽雄/志忠", role: "先發" },
    { order: "2", pos: "PR (代跑)", num: "5", name: "↳ 李浩偉", role: "替補" },
    { order: "3", pos: "C (2)",  num: "93", name: "黃宥憬/GD", role: "先發" },
    { order: "4", pos: "LF (7)", num: "2",  name: "梁佑丞", role: "先發" },
    { order: "4", pos: "LF (7)", num: "55", name: "↳ 葉展昆", role: "替補" },
    { order: "5", pos: "SS (6)", num: "19", name: "林廷軒/Donut", role: "先發" },
    { order: "6", pos: "RF (9)", num: "91", name: "黃宥挺/小樂", role: "先發" },
    { order: "6", pos: "RF (9)", num: "36", name: "↳ 李尊堯/堯堯", role: "替補" },
    { order: "7", pos: "2B (4)", num: "12", name: "陳佳瑋/A-WEI", role: "先發" },
    { order: "8", pos: "CF (8)", num: "39", name: "駱家鈞/駱鈞", role: "先發" },
    { order: "9", pos: "P (1)",  num: "1",  name: "張容基/阿基", role: "先發" },
    { order: "9", pos: "PH (代打)", num: "49", name: "↳ 蘇辰雄", role: "替補" },
    { order: "9", pos: "3B (5)", num: "49", name: "↳ 蘇辰雄", role: "替補" }
  ];

  for (var i = 0; i < fullRoster.length; i++) {
    var p = fullRoster[i];
    var r = sheet.getLastRow() + 1;

    var fAVG = '=IF(F' + r + '>0, TEXT(H' + r + '/F' + r + ', ".000"), ".000")';
    var fOBP = '=IF((F' + r + '+M' + r + ')>0, TEXT((H' + r + '+M' + r + ')/(F' + r + '+M' + r + '), ".000"), ".000")';
    var fOPS = '=IF(F' + r + '>0, TEXT(((H' + r + '+M' + r + ')/(F' + r + '+M' + r + ')) + ((H' + r + '+I' + r + '+2*J' + r + '+3*K' + r + ')/F' + r + '), ".000"), ".000")';

    sheet.appendRow([
      p.order, p.pos, p.num, p.name, p.role,
      "", "", "", "", "", "", "", "", "", "",
      fAVG, fOBP, fOPS
    ]);

    if (p.role === "先發") {
      sheet.getRange(r, 1, 1, 18).setFontWeight("bold");
    } else {
      sheet.getRange(r, 1, 1, 18).setFontWeight("normal");
    }
  }

  sheet.appendRow([""]);
  var pHeaders = ["球員姓名", "背號", "守位", "更換說明", "IP", "H", "R", "ER", "BB", "K", "HR", "ERA", "紀錄時間"];
  sheet.appendRow(pHeaders);
  sheet.getRange(sheet.getLastRow(), 1, 1, pHeaders.length)
       .setBackground("#0d9488")
       .setFontColor("#ffffff")
       .setFontWeight("bold");

  sheet.appendRow(["張容基/阿基", "1", "P (1)", "先發投手", "", "", "", "", "", "", "", "", "2026/08/30 18:21:00"]);
  sheet.appendRow(["蘇垣華/小天", "56", "P (1)", "後援投手", "", "", "", "", "", "", "", "", "2026/08/30 18:25:00"]);

  SpreadsheetApp.getUi().alert("🎉 已將完整的「先發＋5位替補」全部精準排回，格式已完成！");
}

function fixHeaderAndRowColors() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("2026-08-30_G4_雨人");
  if (!sheet) {
    SpreadsheetApp.getUi().alert("找不到分頁：2026-08-30_G4_雨人");
    return;
  }

  var data = sheet.getDataRange().getValues();
  var headerRow = -1;
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === "打順") {
      headerRow = i + 1;
      break;
    }
  }

  if (headerRow === -1) {
    SpreadsheetApp.getUi().alert("找不到「打順」表頭列！");
    return;
  }

  sheet.getRange(headerRow, 1, 1, 18)
       .setBackground("#1e293b")
       .setFontColor("#ffffff")
       .setFontWeight("bold");

  var lastRow = sheet.getLastRow();
  var totalPlayerRows = lastRow - headerRow;
  if (totalPlayerRows > 0) {
    var playerRange = sheet.getRange(headerRow + 1, 1, totalPlayerRows, 18);
    playerRange.setBackground(null)
               .setFontColor("#000000");

    for (var r = headerRow + 1; r <= lastRow; r++) {
      var role = sheet.getRange(r, 5).getValue().toString().trim();
      if (role === "先發") {
        sheet.getRange(r, 1, 1, 18).setFontWeight("bold");
      } else {
        sheet.getRange(r, 1, 1, 18).setFontWeight("normal");
      }
    }
  }

  SpreadsheetApp.getUi().alert("✅ 顏色與排版已校正：第 " + headerRow + " 列為深藍表頭，球員名單已清除異常底色！");
}