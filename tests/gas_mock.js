// 模擬 Google Apps Script 執行環境（只模擬本專案用到的 API）
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// ---------- 簡易試算表模擬（只模擬 Code.gs 用到的 API）----------
class MockRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.rows[this.r - 1 + i] || [];
      const vals = [];
      for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; vals.push(v === undefined ? '' : v); }
      out.push(vals);
    }
    return out;
  }
  getBackgrounds() {
    const bg = this.sheet.bg || [];
    return this.getValues().map((r, i) => r.map((_, j) => ((bg[this.r - 1 + i] || [])[this.c - 1 + j]) || '#ffffff'));
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some(v => v.length !== this.nc)) {
      throw new Error(`setValues 尺寸不符：範圍 ${this.nr}x${this.nc}，資料 ${vals.length}x${vals[0] && vals[0].length}`);
    }
    vals.forEach((row, i) => row.forEach((v, j) => this.sheet.set(this.r + i, this.c + j, v)));
    return this;
  }
  setValue(v) { this.sheet.set(this.r, this.c, v); return this; }
  setFormula(f) { this.sheet.set(this.r, this.c, f); return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setFontWeight() { return this; }
}
class MockSheet {
  constructor(name, rows, bg) { this.name = name; this.rows = rows || []; this.bg = bg || []; }
  set(r, c, v) { while (this.rows.length < r) this.rows.push([]); const row = this.rows[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; }
  getRange(r, c, nr = 1, nc = 1) {
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error(`getRange 參數錯誤 ${r},${c},${nr},${nc}`);
    return new MockRange(this, r, c, nr, nc);
  }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) if ((this.rows[i] || []).some(v => v !== '' && v !== undefined && v !== null)) return i + 1;
    return 0;
  }
  getDataRange() { const lr = this.getLastRow(); const lc = Math.max(1, ...this.rows.map(r => r.length)); return new MockRange(this, 1, 1, Math.max(lr, 1), lc); }
  insertRowsAfter(r, n) { while (this.rows.length < r) this.rows.push([]); this.rows.splice(r, 0, ...Array.from({ length: n }, () => [])); }
  deleteRows(r, n) { this.rows.splice(r - 1, n); }
  appendRow(arr) { const lr = this.getLastRow(); arr.forEach((v, j) => this.set(lr + 1, j + 1, v)); }
  getName() { return this.name; }
  // 測試用：印出 A~E 欄
  dump() { return this.rows.map((r, i) => `${String(i + 1).padStart(2)} | ${(r || []).slice(0, 5).join(' | ')}`).join('\n'); }
}
class MockSpreadsheet {
  constructor() { this.sheets = {}; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { if (this.sheets[n]) throw new Error('分頁已存在 ' + n); return (this.sheets[n] = new MockSheet(n)); }
}

function createGasContext(opts = {}) {
  // propsStore / cacheStore：傳入同一個物件就能跨多次載入共用（本機伺服器用）
  const props = opts.propsStore || Object.assign({}, opts.props || {});
  const cache = opts.cacheStore || {};
  const logs = [];
  let now = opts.now || null;

  const ctx = {
    console,
    JSON, Math, String, Number, Array, Object, parseInt, Error,
    Date: now ? class extends Date { static now() { return now(); } } : Date,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: k => { delete props[k]; },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (k in cache ? cache[k] : null),
        put: (k, v) => { cache[k] = String(v); },
        remove: k => { delete cache[k]; },
      }),
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d) => new Date(new Date(d).getTime() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19).replace(/-/g, '/'),
      Charset: { UTF_8: 'UTF-8' },
      computeHmacSha256Signature: (value, key) =>
        Array.from(crypto.createHmac('sha256', key).update(value, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: (data) => {
        const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.map(b => (b + 256) % 256));
        return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
      },
      base64DecodeWebSafe: (s) => {
        if (/[^A-Za-z0-9\-_=]/.test(s)) throw new Error('Could not decode string.');
        return Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')).map(b => (b > 127 ? b - 256 : b));
      },
      newBlob: (bytes) => ({
        getDataAsString: () => Buffer.from(bytes.map(b => (b + 256) % 256)).toString('utf8'),
      }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ _text: text, setMimeType() { return this; }, getContent() { return this._text; } }),
    },
    Logger: { log: m => logs.push(String(m)) },
    SpreadsheetApp: { getActiveSpreadsheet: () => opts.spreadsheet },
  };
  vm.createContext(ctx);
  for (const f of opts.files || []) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  }
  return { ctx, props, cache, logs };
}

module.exports = { createGasContext, MockSheet, MockSpreadsheet };
