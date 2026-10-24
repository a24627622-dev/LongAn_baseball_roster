// 假的 GitHub（只模擬 gas/GitHub.gs 用到的 API），給 GAS 測試與本機開發伺服器用。
// 檔案存在記憶體：path → 文字內容。每次成功的修改記在 commits（message、改了哪些 path、是否強制覆蓋）。
//   opts.token：正確的金鑰（不對就回 401）
//   opts.status：所有請求都回這個狀態碼（模擬 GitHub 掛掉、金鑰被刪）
//   opts.conflicts：前幾次更新 main 時回 422（模擬剛好有人同時在改）；opts.onConflict(gh) 在那之前先做「別人的修改」
const REPO = 'a24627622-dev/LongAn_baseball_roster';
const BASE = 'https://api.github.com/repos/' + REPO;

function createFakeGitHub(initialFiles, opts = {}) {
  let n = 0;
  const trees = { t0: Object.assign({}, initialFiles) };
  const objs = { c0: { tree: 't0', parents: [], message: 'init' } };
  let head = 'c0';
  let conflicts = opts.conflicts || 0;
  const commits = [];
  const requests = [];

  const files = () => trees[objs[head].tree];
  // 直接改 main（模擬別人在 GitHub 網頁上改）
  function externalCommit(path, content, message = '別人的修改') {
    const t = 't' + (++n);
    trees[t] = Object.assign({}, files(), { [path]: content });
    const c = 'c' + (++n);
    objs[c] = { tree: t, parents: [head], message };
    head = c;
  }

  function handler(url, params) {
    const method = String(params.method || 'get').toUpperCase();
    const body = params.payload ? JSON.parse(params.payload) : null;
    requests.push({ method, url, body });
    if (opts.status) return { code: opts.status, body: { message: 'Bad credentials' } };
    const auth = (params.headers || {}).Authorization;
    if (auth !== 'Bearer ' + opts.token) return { code: 401, body: { message: 'Bad credentials' } };
    if (url.indexOf(BASE) !== 0) return { code: 404, body: { message: 'Not Found' } };
    const u = url.slice(BASE.length).split('?')[0];

    if (method === 'GET' && u.indexOf('/contents/') === 0) {
      const path = u.slice('/contents/'.length).split('/').map(decodeURIComponent).join('/');
      const f = files();
      return path in f ? { code: 200, body: f[path] } : { code: 404, body: { message: 'Not Found' } };
    }
    if (method === 'GET' && u === '/git/ref/heads/main') return { code: 200, body: { object: { sha: head } } };
    if (method === 'GET' && u.indexOf('/git/commits/') === 0) {
      const c = objs[u.slice('/git/commits/'.length)];
      return c ? { code: 200, body: { tree: { sha: c.tree } } } : { code: 404, body: { message: 'Not Found' } };
    }
    if (method === 'POST' && u === '/git/trees') {
      const base = trees[body.base_tree];
      if (!base) return { code: 422, body: { message: 'base_tree not found' } };
      const next = Object.assign({}, base);
      for (const e of body.tree) {
        if (e.sha === null) {
          if (!(e.path in next)) return { code: 422, body: { message: 'GitRPC::BadObjectState' } };
          delete next[e.path];
        } else next[e.path] = e.content;
      }
      const t = 't' + (++n);
      trees[t] = next;
      return { code: 201, body: { sha: t } };
    }
    if (method === 'POST' && u === '/git/commits') {
      const c = 'c' + (++n);
      objs[c] = { tree: body.tree, parents: body.parents, message: body.message };
      return { code: 201, body: { sha: c } };
    }
    if (method === 'PATCH' && u === '/git/refs/heads/main') {
      if (conflicts > 0) {
        conflicts--;
        if (opts.onConflict) opts.onConflict({ externalCommit });
        return { code: 422, body: { message: 'Update is not a fast forward' } };
      }
      const c = objs[body.sha];
      if (!c || c.parents[0] !== head) return { code: 422, body: { message: 'Update is not a fast forward' } };
      const before = files();
      const after = trees[c.tree];
      const paths = Object.keys(Object.assign({}, before, after)).filter((p) => before[p] !== after[p]).sort();
      head = body.sha;
      commits.push({ message: c.message, paths, force: body.force });
      return { code: 200, body: { object: { sha: head } } };
    }
    return { code: 404, body: { message: 'Not Found' } };
  }

  return { handler, files, commits, requests, externalCommit };
}

module.exports = { createFakeGitHub, REPO };
