// ==========================================================================
// 龍安棒球隊 - 隊務密碼驗證模組 (Auth.gs)
// 放法：Apps Script 編輯器左側「檔案」旁的 ＋ → 指令碼 → 命名為 Auth，整份貼上。
//       同一個專案裡的 .gs 檔共用全域範圍，Code.gs 可以直接呼叫這裡的函式。
//
// 設定（專案設定 ⚙️ → 指令碼屬性）：
//   TEAM_PASSCODE  隊務密碼（必填，只有能編輯這支 Apps Script 的人看得到）
//   AUTH_ENFORCED  填 true 才會真的擋下沒登入的寫入；沒填或其他值 = 測試模式，只驗證不擋
//   AUTH_SECRET    簽發通行證用的金鑰，第一次登入時自動產生，不用手動填
//
// 換密碼：改 TEAM_PASSCODE 後，執行一次 rotateAuthSecret()，所有手機上的舊登入會一起失效。
// ==========================================================================

var AUTH_TOKEN_DAYS = 30;          // 登入後保持幾天
var AUTH_MAX_FAILS = 10;           // 連續錯幾次就暫時鎖住
var AUTH_LOCK_SECONDS = 600;       // 鎖住多久（秒）
var AUTH_PUBLIC_ACTIONS = ['login', 'authStatus'];  // 不需要登入的 POST 動作

function authJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}

function authProps_() {
  return PropertiesService.getScriptProperties();
}

function authSecret_() {
  var props = authProps_();
  var secret = props.getProperty('AUTH_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('AUTH_SECRET', secret);
  }
  return secret;
}

function authIsEnforced_() {
  return String(authProps_().getProperty('AUTH_ENFORCED') || '').toLowerCase() === 'true';
}

function authSign_(text) {
  var bytes = Utilities.computeHmacSha256Signature(text, authSecret_());
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

// 長度固定的比較，避免從回應時間猜出密碼
function authSafeEqual_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  var len = Math.max(a.length, b.length);
  for (var i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function authIssueToken_() {
  var payload = { exp: Date.now() + AUTH_TOKEN_DAYS * 24 * 60 * 60 * 1000, role: 'staff' };
  var body = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8).replace(/=+$/, '');
  return body + '.' + authSign_(body);
}

// 回傳 true / false
function authVerifyToken_(token) {
  if (!token || typeof token !== 'string') return false;
  var parts = token.split('.');
  if (parts.length !== 2) return false;
  if (!authSafeEqual_(authSign_(parts[0]), parts[1])) return false;
  try {
    var padded = parts[0];
    while (padded.length % 4) padded += '=';
    var json = Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString('UTF-8');
    var payload = JSON.parse(json);
    return typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch (e) {
    return false;
  }
}

function handleLogin_(data) {
  var cache = CacheService.getScriptCache();
  var fails = parseInt(cache.get('auth_fail_count') || '0', 10);
  if (fails >= AUTH_MAX_FAILS) {
    return authJson_({ success: false, code: 'AUTH_LOCKED', message: '密碼錯誤次數過多，請 10 分鐘後再試。' });
  }

  var expected = authProps_().getProperty('TEAM_PASSCODE');
  if (!expected) {
    return authJson_({ success: false, code: 'AUTH_NOT_CONFIGURED', message: '後端尚未設定隊務密碼（指令碼屬性 TEAM_PASSCODE）。' });
  }

  if (!authSafeEqual_(String(data.passcode || ''), expected)) {
    cache.put('auth_fail_count', String(fails + 1), AUTH_LOCK_SECONDS);
    return authJson_({ success: false, code: 'AUTH_FAILED', message: '密碼錯誤。' });
  }

  cache.remove('auth_fail_count');
  return authJson_({ success: true, token: authIssueToken_(), expiresInDays: AUTH_TOKEN_DAYS });
}

/**
 * 在 doPost 最前面呼叫。
 * - 回傳 ContentService 物件：代表這個請求已經處理完（登入、或被擋下），doPost 直接 return 它。
 * - 回傳 null：可以繼續往下執行原本的動作。
 */
function authGate_(data) {
  var action = data && data.action;
  if (action === 'login') return handleLogin_(data);
  if (action === 'authStatus') {
    return authJson_({ success: true, enforced: authIsEnforced_(), valid: authVerifyToken_(data.token) });
  }
  if (AUTH_PUBLIC_ACTIONS.indexOf(action) !== -1) return null;

  if (authVerifyToken_(data && data.token)) return null;
  if (!authIsEnforced_()) return null;  // 測試模式：沒登入也放行

  return authJson_({
    success: false,
    code: 'AUTH_REQUIRED',
    message: '需要隊務登入才能執行這個動作（登入可能已過期）。'
  });
}

// 手動執行：換密碼後讓所有舊登入失效
function rotateAuthSecret() {
  authProps_().deleteProperty('AUTH_SECRET');
  authSecret_();
  Logger.log('已更換金鑰，所有裝置需要重新登入。');
}

// 手動執行：檢查設定狀態（不會印出密碼本身）
function checkAuthSetup() {
  var props = authProps_();
  Logger.log('TEAM_PASSCODE 已設定：' + (!!props.getProperty('TEAM_PASSCODE')));
  Logger.log('AUTH_ENFORCED：' + authIsEnforced_());
  Logger.log('AUTH_SECRET 已產生：' + (!!props.getProperty('AUTH_SECRET')));
}
