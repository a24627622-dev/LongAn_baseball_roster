/* 舊網址轉址（V01.14.01）：網站從 GitHub Pages 搬到 Cloudflare Pages（2026-10-24）。
   在舊網址（a24627622-dev.github.io/LongAn_baseball_roster/…）打開任何一頁，自動轉到新網址的同一頁（參數、# 都保留）。
   每一頁的 <head> 最前面載入；新網址、本機開發不受影響。使用者決定關閉舊網址（repo 改私人）後，這支可以拿掉。
   測試：tests/test_moved.js */
(function (root) {
  const NEW_SITE = 'https://longan-baseball.pages.dev';
  const OLD_HOST = 'a24627622-dev.github.io';
  const OLD_BASE = '/LongAn_baseball_roster';

  function movedUrl(href) {
    let u;
    try { u = new URL(href); } catch (e) { return null; }
    if (u.hostname !== OLD_HOST) return null;
    if (u.pathname !== OLD_BASE && !u.pathname.startsWith(OLD_BASE + '/')) return null;
    const rest = u.pathname.slice(OLD_BASE.length) || '/';
    return NEW_SITE + rest + u.search + u.hash;
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { movedUrl, NEW_SITE }; return; }
  const to = movedUrl(root.location.href);
  if (to) root.location.replace(to);
})(this);
