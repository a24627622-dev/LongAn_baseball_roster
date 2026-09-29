# 龍安棒球隊網站 — 給 Claude 的開工指引

## 開工前

1. `git pull --rebase origin main`（使用者常在 GitHub 網頁直接改 `data/*.json`），再用 `git log` 看最近的 commit
2. **先讀 `docs/專案現況.md`**：優先序、已定案決定（第 8 節，不要重新討論）、明確不做的事、動工前要先問使用者的問題都在裡面
3. 寫程式前確認要做的事不在「明確不做」清單（`docs/專案現況.md` 第 8.1 節），也不是「使用者尚未決定」的提議（第 4 節）

## 使用者的工作方式

- 動手前先問清楚需求：問題編號、一題只問一件事、每輪約 5～8 題、每題附建議答案
- 問完先整理規格給使用者確認，確認後才開工；定案內容寫進 `docs/`
- 新發現的問題寫進 `docs/專案現況.md` 的待辦，不要當場動手（除非擋住目前的工作）
- 回覆使用繁體中文

## 測試（TDD）

這個專案採用 TDD（流程見 `.claude/skills/tdd/SKILL.md`）：先寫會失敗的測試、再寫最少的程式讓它通過、最後全部測試重跑。

### 哪些改動要走 TDD

| 要走 TDD（邏輯） | 不走 TDD（改完列出人工檢查項目） |
|---|---|
| `record-engine.js`、`data-check.js`、`gas/*.gs`、`tools/lineup.html` 的 `setup()` 邏輯，以及之後新增的共用模組 | `docs/`、CSS 與版面、`data/*.json` 的內容、畫面外觀、試算表底色與粗體 |

- 測試清單（邊界值、分類、異常輸入、狀態順序、不變條件）**放進問完需求後的規格摘要**，使用者回「開工」＝規格和測試清單一起批准。
- 修 bug：先寫重現它的測試並看它失敗，再修；測試名稱加 `【修正】` 前綴。
- 邏輯寫在 HTML 的 `:disabled`、`v-if` 裡測不到時，先搬進 `setup()` 或共用模組變成可呼叫的函式。**碰到哪裡才整理哪裡**，不一次重構舊程式。
- 期望值用手算的常數或人工確認過的來源（例如賽事戰報），不能用被測程式算出來。

### 指令與基準線

開工前全部跑一次當基準線，有失敗先停下來回報；改完再全部重跑，全綠才 commit。

```
node tests/test_gas_modules.js         # 19 項：Auth.gs、Pitchers.gs
node tests/test_lineup_logic.js        # 28 項：點名→先發→調度→上傳→回讀→結案
node tests/test_scenarios.js           # 26 項：三大調度情境、規則守門、DH 引導
node tests/test_scenarios.js --repeat 5
node tests/test_record_engine.js       # 39 項：比賽文字紀錄轉換引擎
node tests/test_check_data.js          # 34 項：資料檔檢查規則、公告連結
node tests/check_data.js               # 不是測試：檢查 data/*.json 與 data/games/*.json
```

基準（2026-09-29，V01.07.00）：19＋28＋26＋39＋34，`check_data` 沒有錯誤。測試數量有增減時，這裡、`tests/README.md`、`docs/測試報告_調度三情境.md` 一起更新。

### 測試放哪裡

- `tests/harness.js`：把 `tools/lineup.html` 的 `<script>` 抽出來用 Vue 替身執行 `setup()`，後端實際跑 `gas/*.gs`；`tests/gas_mock.js` 模擬試算表等 GAS 環境。lineup 與 GAS 的新測試加在既有檔案、沿用這兩個框架。
- `tests/test_record_engine.js` 的標準答案是 `tests/fixtures/` 的 8/30 G4 雨人紀錄；字典文件第 6 節範例必須和 fixture 一字不差。
- 各支測試的內容見 `tests/README.md`；調度情境的規則依據見 `docs/測試報告_調度三情境.md`。

### 畫面確認

**每次修改畫面後，用 Playwright 在 1280px 和 390px 各截一張圖確認，再回報**（截圖附給使用者）。

做法：`python3 -m http.server` 起本機伺服器，用全域安裝的 `playwright` 打開頁面。雲端環境連不到 `cdn.tailwindcss.com`、`unpkg.com` 時，用 `npm pack vue@3 @tailwindcss/browser@4` 下載，再以 `page.route()` 攔截替換（Tailwind 會變成 v4，細部樣式可能和正式版略有差異，回報時要註明）；GAS 讀不到時名單會是空的，也要註明。

### 不能做的事

- 不能為了讓測試變綠而直接改斷言；測試框架不能比真實 UI 寬鬆（見 `docs/測試報告_調度三情境.md` 第九節）。
- `test_scenarios.js` 每個案例都會跑的不變條件（守位不重複、成績合計剛好 2 列且位置正確、打者表不重複、投手不重複、先發投手剛好 1 位）不能拿掉或放寬。
- 測試碰不到的：瀏覽器畫面（Vue／Tailwind 沒載入）、Google 試算表的實際格式、正式 GAS。這些改完要列出人工實測項目。
- 測試只用 mock 與 fixtures，不碰正式試算表與正式 GAS；不推 `main`、不部署 GAS（由使用者決定）。

## 文件維護（每次更動都要做）

`docs/` 的四份文件以 repo 版本為準，**和程式改動放在同一個 commit 一起更新**：

| 發生了什麼 | 要更新哪裡 |
|---|---|
| 完成或新增待辦、優先序改變、使用者做了決定 | `docs/專案現況.md` 對應章節＋檔頭「最後更新」日期 |
| 改了會上線的程式（`tools/lineup.html`、`gas/*.gs`、對外頁面） | `docs/CHANGELOG.md` 新增版本段落 |
| 測試案例增減、規則依據改變 | `docs/測試報告_調度三情境.md`＋`tests/README.md` 的項數 |
| 簡碼字典有新定案 | `docs/文字記錄簡碼字典.md` |
| 開發或維護流程改變 | `DEVELOPMENT.md` |

已完成的事改寫成「已完成（日期、commit）」，不要直接刪掉。

## 部署注意

- `main` = GitHub Pages = 正式上線，push 後約一分鐘生效
- 改了 `gas/*.gs`：使用者要貼進 Apps Script 並「建立新版本」才生效。**GAS 要先部署，再 merge `main`**
- 這個 repo 是公開的：**不要 commit 密碼、金鑰、密碼提示**
- 開 PR 後，告訴使用者照 `DEVELOPMENT.md` 第 11 節測試與 Merge；PR 說明要寫「上線步驟」（要測什麼、GAS 要不要動）
