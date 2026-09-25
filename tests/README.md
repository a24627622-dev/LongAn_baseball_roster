# 本機測試

需要 Node.js（不用安裝任何套件）。在專案根目錄執行：

```
node tests/test_gas_modules.js
node tests/test_lineup_logic.js
node tests/test_scenarios.js
node tests/test_scenarios.js --repeat 5    # 跑五輪並檢查跨輪一致性
```

## 檔案

- `harness.js`：共用框架。把 `lineup.html` 的 `<script>` 抽出來，用極簡 Vue 替身執行 `setup()`，
  後端實際執行 `gas/Code.gs` + `Auth.gs` + `Pitchers.gs`，試算表用模擬物件。
  `test_lineup_logic.js` 與 `test_scenarios.js` 共用它。
- `gas_mock.js`：Google Apps Script 執行環境模擬（試算表、指令碼屬性、快取、HMAC 等）。
- `test_gas_modules.js`（19 項）：Auth.gs 與 Pitchers.gs 的單元測試。
- `test_lineup_logic.js`（28 項）：完整流程——點名 → 先發 → 調度 → 上傳 → 回讀 → 結案，含登入流程。
- `test_scenarios.js`（21 項）：三大調度情境（A×6、B×5、C×7）加規則守門（G×3），見下。
  各案例的規則依據與細節見 `docs/測試報告_調度三情境.md`。

## test_scenarios.js 的三個情境

| 情境 | 內容 |
|---|---|
| **A 一般九人** | 投手在打序裡需要打擊。涵蓋先發、單次換投、代打後改守備、連續換投、手動成績保留 |
| **B 全場 DH** | 投手不在打序。涵蓋先發、獨立換投、三次換投、DH 被代打、DH 被代跑後接任 |
| **C 先發 DH 中途取消** | 依 MLB Rule 5.11(a)：DH 去守備、投手轉守、代打者上場投球、投手進打序、取消前後換投、多重換人 |
| **G 規則守門** | 守位重複擋上傳、退場球員不得回場、DH 取消後投手仍選得到 |

每個案例除了自己的斷言，都會跑一組共同的健全性檢查（`invariants`）：

- 守位重複必須為空
- 「成績合計」剛好 2 列（打者表 1、投手表 1）
- 打者表的「成績合計」緊接在最後一筆資料列下方（防 V01.00.02 那類位移事故）
- 打者表沒有重複列
- 投手表沒有同一位投手重複出現
- 先發投手剛好 1 位

## 限制

- 不會載入 Vue／Tailwind，**畫面本身仍需在手機上實測**。
- 試算表是模擬物件，不會驗證 Google Sheets 的實際格式化行為（底色、粗體）。
