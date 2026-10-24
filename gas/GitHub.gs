// ============================================================================
// 一鍵發布（V01.15.00）：賽事成績發布按一個按鈕，成績檔、時程、公告合成一次修改寫進 GitHub 的 main
// - 要一起貼的檔案：PublishCore.gs（＝ publish-core.js）、DataCheck.gs（＝ data-check.js），內容整份照貼
// - 指令碼屬性：GITHUB_TOKEN（必填，GitHub 的 fine-grained 金鑰，只開這個 repo 的 Contents 讀寫）、
//   GITHUB_REPO（可省略，預設 a24627622-dev/LongAn_baseball_roster）
// - 時程、公告一律從 GitHub 讀最新的再改，不會蓋掉剛在 GitHub 網頁上改的東西；剛好有人同時在改就重讀再送一次
// - 改完先過資料檢查（DataCheck），有錯就不送出
// 測試：tests/test_gas_modules.js「GitHub.gs 一鍵發布」
// ============================================================================
var GH_API = 'https://api.github.com';
var GH_REPO_DEFAULT = 'a24627622-dev/LongAn_baseball_roster';
var GH_TRIES = 2;   // 剛好有人同時在改時，最多送幾次

function ghProp_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
function ghToday_() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }
function ghFail_(message, code) { return { success: false, code: code || 'PUBLISH_FAILED', message: message }; }

function ghCall_(method, path, body, accept) {
  var params = {
    method: method, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ghProp_('GITHUB_TOKEN'), Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  };
  if (body) { params.contentType = 'application/json; charset=utf-8'; params.payload = JSON.stringify(body); }
  var r = UrlFetchApp.fetch(GH_API + '/repos/' + (ghProp_('GITHUB_REPO') || GH_REPO_DEFAULT) + path, params);
  var text = r.getContentText();
  var json = null;
  try { json = JSON.parse(text); } catch (e) { /* 讀原始檔時不是 JSON */ }
  return { code: r.getResponseCode(), text: text, json: json };
}

// 把 GitHub 的錯誤翻成看得懂的話
function ghError_(r) {
  if (r.code === 401 || r.code === 403) return 'GitHub 金鑰無效或過期（或權限不足），請重新產生 GITHUB_TOKEN（步驟見 DEVELOPMENT.md）';
  return 'GitHub 回應錯誤（' + r.code + '）：' + ((r.json && r.json.message) || '');
}

// 讀 main 上的檔案原文；不存在回 text: null
function ghRead_(path) {
  var enc = path.split('/').map(encodeURIComponent).join('/');
  var r = ghCall_('get', '/contents/' + enc + '?ref=main', null, 'application/vnd.github.raw+json');
  if (r.code === 200) return { ok: true, text: r.text };
  if (r.code === 404) return { ok: true, text: null };
  return { ok: false, error: ghError_(r) };
}

// 讀時程、公告（JSON）；壞掉就回錯誤
function ghReadData_() {
  var out = {};
  var names = { schedule: 'data/schedule.json', announcements: 'data/announcements.json' };
  for (var k in names) {
    var f = ghRead_(names[k]);
    if (!f.ok) return { ok: false, error: f.error };
    if (f.text === null) return { ok: false, error: 'GitHub 上找不到 ' + names[k] };
    try { out[k] = JSON.parse(f.text); } catch (e) { return { ok: false, error: 'GitHub 上的 ' + names[k] + ' 不是正確的 JSON，請先修好再發布' }; }
  }
  out.ok = true;
  return out;
}

// 多個檔案合成一次修改（content: null ＝ 刪除）；不強制覆蓋，main 被別人先改了就回 conflict
function ghCommit_(files, message) {
  var ref = ghCall_('get', '/git/ref/heads/main');
  if (ref.code !== 200) return { ok: false, error: ghError_(ref) };
  var parent = ref.json.object.sha;
  var commit = ghCall_('get', '/git/commits/' + parent);
  if (commit.code !== 200) return { ok: false, error: ghError_(commit) };
  var tree = ghCall_('post', '/git/trees', {
    base_tree: commit.json.tree.sha,
    tree: files.map(function (f) {
      return f.content === null ? { path: f.path, mode: '100644', type: 'blob', sha: null } : { path: f.path, mode: '100644', type: 'blob', content: f.content };
    })
  });
  if (tree.code !== 201) return { ok: false, error: ghError_(tree) };
  var made = ghCall_('post', '/git/commits', { message: message, tree: tree.json.sha, parents: [parent] });
  if (made.code !== 201) return { ok: false, error: ghError_(made) };
  var upd = ghCall_('patch', '/git/refs/heads/main', { sha: made.json.sha, force: false });
  if (upd.code === 200) return { ok: true, sha: made.json.sha };
  if (upd.code === 409 || upd.code === 422) return { ok: false, conflict: true };
  return { ok: false, error: ghError_(upd) };
}

// 改完的時程、公告要過資料檢查
function ghCheck_(files) {
  var kinds = { 'data/schedule.json': 'checkSchedule', 'data/announcements.json': 'checkAnnouncements' };
  for (var i = 0; i < files.length; i++) {
    var fn = kinds[files[i].path];
    if (!fn || files[i].content === null) continue;
    var r = DataCheck[fn](JSON.parse(files[i].content));
    var errs = r.fatal ? [r.fatal] : r.errors.map(function (e) { return e.where + '：' + e.msg; });
    if (errs.length) return files[i].path + ' 資料檢查沒過，沒有送出：' + errs.slice(0, 3).join('；');
  }
  return '';
}

function ghReady_() {
  if (!ghProp_('GITHUB_TOKEN')) return ghFail_('還沒設定 GitHub 金鑰（指令碼屬性 GITHUB_TOKEN），請先照 DEVELOPMENT.md 設定，或用「備用：手動發布」', 'NO_GITHUB_TOKEN');
  if (typeof PublishCore === 'undefined' || typeof DataCheck === 'undefined') return ghFail_('GAS 還沒貼 PublishCore.gs 或 DataCheck.gs', 'NO_GITHUB_GS');
  return null;
}

// action = publishGame：{ game（賽事成績）, er: [{ number, ER }], league（undefined＝沿用時程的，''＝友誼賽）, announcement: { title, body } 或 null }
function publishGame_(ss, data) {
  var notReady = ghReady_();
  if (notReady) return notReady;
  var game = data.game;
  if (!game || !PublishCore.validId(game.id)) return ghFail_('比賽 ID 不合格式：' + JSON.stringify(game && game.id));

  // ER：每位投手都要填，套進賽事成績
  game = JSON.parse(JSON.stringify(game));
  var er = data.er instanceof Array ? data.er : [];
  var noER = [];
  (game.pitching || []).forEach(function (p) {
    var e = er.filter(function (x) { return String(x.number) === String(p.number); })[0];
    if (e && typeof e.ER === 'number' && e.ER % 1 === 0) p.ER = e.ER; else noER.push('#' + p.number + ' ' + p.name);
  });
  if (noER.length) return ghFail_('還沒填 ER：' + noER.join('、'));
  var chk = DataCheck.checkGame(game);
  if (chk.fatal || chk.errors.length) return ghFail_('賽事成績資料檢查沒過：' + (chk.fatal || chk.errors.map(function (e) { return e.msg; }).join('；')));

  // 比賽分頁：ER 寫回、清掉黃色（GitHub 失敗也算確認過了）
  var sheetName = (game.date + '_' + game.gameNum + '_' + game.opponent).replace(/[\/\\\?\*\[\]\:]/g, '-');
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return ghFail_('找不到比賽分頁「' + sheetName + '」，ER 沒辦法寫回試算表');
  writeGameER_(sheet, game.pitching);

  for (var t = 0; t < GH_TRIES; t++) {
    var d = ghReadData_();
    if (!d.ok) return ghFail_(d.error);
    var built = PublishCore.buildPublish({ game: game, schedule: d.schedule, announcements: d.announcements, league: data.league, announcement: data.announcement || null, today: ghToday_() });
    if (!built.ok) return ghFail_(built.error);
    var bad = ghCheck_(built.files);
    if (bad) return ghFail_(bad);
    var c = ghCommit_(built.files, built.message);
    if (c.ok) return { success: true, mode: built.mode, announced: built.announced, message: built.message, commit: c.sha };
    if (!c.conflict) return ghFail_(c.error);
  }
  return ghFail_('剛好有人同時在改 GitHub，請過一下再按一次');
}

// action = unpublishGame：{ gameId }
function unpublishGame_(data) {
  var notReady = ghReady_();
  if (notReady) return notReady;
  var id = data.gameId;
  if (!PublishCore.validId(id)) return ghFail_('比賽 ID 不合格式：' + JSON.stringify(id));
  for (var t = 0; t < GH_TRIES; t++) {
    var f = ghRead_(PublishCore.gamePath(id));
    if (!f.ok) return ghFail_(f.error);
    var d = ghReadData_();
    if (!d.ok) return ghFail_(d.error);
    var built = PublishCore.buildUnpublish({ gameId: id, gameExists: f.text !== null, schedule: d.schedule, announcements: d.announcements });
    if (!built.ok) return ghFail_(built.error);
    if (!built.files.length) return { success: true, message: '這場沒有發布過，不用撤回' };
    var bad = ghCheck_(built.files);
    if (bad) return ghFail_(bad);
    var c = ghCommit_(built.files, built.message);
    if (c.ok) return { success: true, message: built.message, commit: c.sha };
    if (!c.conflict) return ghFail_(c.error);
  }
  return ghFail_('剛好有人同時在改 GitHub，請過一下再按一次');
}
