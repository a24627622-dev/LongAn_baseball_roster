/* 球隊管理密碼（V01.13.01）：tools/ 底下每一頁都在 <head> 載入這支。
   這支手機登入過、而且通行證還沒過期（30 天）就直接顯示頁面；否則先遮住頁面，輸入隊務密碼（GAS 登入）。
   只在手機上檢查到期時間，不連網、不驗簽章：球場沒訊號照樣打得開。
   這是防一般人誤闖的基本機制，不是資安保護（真正的資料寫入仍由 GAS 驗證通行證）。
   測試：tests/test_gate.js */
(function (root) {
  const TOKEN_KEY = 'longan_auth_token';   // 和陣容調度、實況賽事紀錄共用
  // 正式 GAS 網址（和 site.js 的 PROD_GAS_URL 相同；陣容調度沒有載入 site.js，所以這裡自己帶一份）
  const PROD_GAS_URL = 'https://script.google.com/macros/s/AKfycbxiAU0ZEuamWUpI_uX8DmSkmxuMcUxNd-BzwT9YgfahXU8pdfAxl5LKGkaKfglsirOx/exec';

  /* 通行證（gas/Auth.gs：base64url(JSON{exp}) + '.' + 簽章）還沒過期就是 true */
  function tokenValid(token, now) {
    if (typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0]) return false;
    try {
      let b = parts[0].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      const bin = typeof atob === 'function' ? atob(b) : Buffer.from(b, 'base64').toString('binary');
      const json = decodeURIComponent(bin.split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
      const payload = JSON.parse(json);
      return typeof payload.exp === 'number' && payload.exp > now;
    } catch (e) {
      return false;
    }
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { tokenValid }; return; }

  const doc = root.document;
  const store = {
    get() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(TOKEN_KEY, v); } catch (e) { /* 無痕模式存不了 */ } },
  };
  if (tokenValid(store.get(), Date.now())) return;

  // 先遮住頁面（只留密碼框），避免內容閃一下
  doc.documentElement.classList.add('gate-lock');
  const style = doc.createElement('style');
  style.textContent = `
    html.gate-lock body > *:not(#gate) { display: none !important; }
    #gate { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #0f172a; z-index: 9999; padding: 16px; font-family: inherit; }
    #gate form { background: #fff; border-radius: 16px; padding: 24px; width: 100%; max-width: 360px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,.3); }
    #gate img { width: 64px; height: 64px; }
    #gate h1 { font-size: 1.15rem; margin: 10px 0 4px; color: #0f172a; }
    #gate p { font-size: .85rem; color: #64748b; margin: 0 0 14px; }
    #gate input { width: 100%; box-sizing: border-box; font-size: 1.1rem; padding: 12px; border: 1px solid #cbd5e1; border-radius: 10px; margin-bottom: 12px; }
    #gate button { width: 100%; min-height: 50px; font-size: 1.05rem; font-weight: 700; border: none; border-radius: 10px; background: #b91c1c; color: #fff; cursor: pointer; }
    #gate button:disabled { opacity: .5; }
    #gate .err { color: #b91c1c; font-size: .9rem; font-weight: 700; min-height: 1.3em; margin: 10px 0 0; }
    #gate a { display: inline-block; margin-top: 12px; font-size: .85rem; color: #64748b; }`;
  doc.head.appendChild(style);

  const gasUrl = () => (typeof root.gasUrl === 'function' ? root.gasUrl()
    : (/^(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(location.hostname) ? '/gas' : PROD_GAS_URL));
  const logo = /\/tools\//.test(location.pathname) ? '../logo-192.png' : 'logo-192.png';

  function show() {
    const box = doc.createElement('div');
    box.id = 'gate';
    box.innerHTML = `<form>
      <img src="${logo}" alt="">
      <h1>龍安棒球隊 球隊管理</h1>
      <p>請輸入隊務密碼。登入一次，這支手機 30 天內都不用再輸入。</p>
      <input type="password" autocomplete="current-password" placeholder="隊務密碼" required>
      <button type="submit">進入</button>
      <div class="err"></div>
      <a href="${/\/tools\//.test(location.pathname) ? '../' : './'}">← 回官網</a>
    </form>`;
    doc.body.appendChild(box);
    const form = box.querySelector('form');
    const input = box.querySelector('input');
    const btn = box.querySelector('button');
    const err = box.querySelector('.err');
    input.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!input.value) return;
      btn.disabled = true; err.textContent = '';
      try {
        const res = await fetch(gasUrl(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'login', passcode: input.value }) });
        const r = JSON.parse(await res.text());
        if (r && r.success && r.token) {
          store.set(r.token);
          location.reload();   // 重新載入：頁面裡的工具也會讀到新的通行證
          return;
        }
        err.textContent = (r && r.message) || '密碼不對';
      } catch (ex) {
        err.textContent = '登入失敗（沒有網路？）';
      }
      btn.disabled = false;
      input.select();
    });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', show); else show();
})(this);
