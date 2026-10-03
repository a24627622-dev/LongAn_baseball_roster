# 本機測試

需要 Node.js（不用安裝任何套件）。在專案根目錄執行：

```
node tests/test_gas_modules.js
node tests/test_lineup_logic.js
node tests/test_scenarios.js
node tests/test_scenarios.js --repeat 5    # 跑五輪並檢查跨輪一致性
node tests/test_record_engine.js           # 比賽文字紀錄轉換引擎
node tests/test_check_data.js              # 資料檔檢查規則的測試
node tests/test_game_core.js               # 實況賽事紀錄的計算核心
node tests/check_data.js                   # 檢查 data/*.json
```

## 檔案

- `harness.js`：共用框架。把 `tools/lineup.html` 的 `<script>` 抽出來，用極簡 Vue 替身執行 `setup()`，
  後端實際執行 `gas/Code.gs` + `Auth.gs` + `Pitchers.gs`，試算表用模擬物件。
  `test_lineup_logic.js` 與 `test_scenarios.js` 共用它。
- `gas_mock.js`：Google Apps Script 執行環境模擬（試算表、指令碼屬性、快取、HMAC 等）。
- `test_gas_modules.js`（40 項）：Auth.gs、Pitchers.gs 的單元測試，以及 Backup.gs（實況賽事紀錄的雲端備份：一場一頁「賽事紀錄_比賽ID」、整頁重寫、建立時間保留、8/30 整場來回一致、E 欄改壞指出列號、異常輸入、登入保護、不碰其他分頁），以及 `Code.gs` 的 `finishGame` 帶成績（實況賽事紀錄比賽完成：成績寫入與覆蓋、ER 保留、逐局比分、不帶成績時行為不變、回讀一致、格式不對只寫名單、分頁不存在不建立）。
- `test_lineup_logic.js`（28 項）：完整流程——點名 → 先發 → 調度 → 上傳 → 回讀 → 結案，含登入流程。
- `test_record_engine.js`（39 項）：比賽文字紀錄轉換引擎（根目錄 `record-engine.js`）。
  標準答案是 2026-08-30 G4 對雨人的賽事戰報：每位打者的 AB、R、H、RBI、BB、K，兩位投手的局數、被安打、失分、四壞、三振都要一致；
  另外測原始（未補正）紀錄要抓得出問題、打點與得分規則、各種 ⚠️ 偵測、對手半局算投手成績。
  測試資料在 `fixtures/`；字典文件第 6 節的範例必須和 `fixtures/2026-08-30_G4_雨人.txt` 一字不差
- `test_game_core.js`（71 項）：實況賽事紀錄的計算核心（根目錄 `game-core.js`）。依 `docs/賽事紀錄工具_規則漏洞清單.md` 逐條寫成：
  死球只推被擠跑者、四壞多跑要選原因、犧飛／犧觸判斷、打點例外、滾地出局被擠跑者預設、全壘打、跑者不能超前、第三出局得分算不算、
  代打／代跑／換投／守位調整／DH 取消、不死三振條件、防守半局（對手棒次、投手成績、失誤記到野手）、復原、比賽結束。
  驗收：`fixtures/2026-08-30_G4_雨人.events.json`（8/30 整場改寫成事件）算出的打者、投手成績要和賽事戰報完全一致，產出的資料要通過 `checkGame`。
  雲端備份的表格列（`sheetRows`）：半局標題與得分、打席列、得分打點括號、對手 NA、跑壘、調度背號寫法、每一列帶原本那一筆。
  比賽分頁的資料（`sheetFinal`）：8/30 最終名單、投手、打者成績、逐局比分和戰報一致，代跑盜壘、空白半局、超過 5 局、DH、沒投球就換下的投手
- `test_check_data.js`（44 項）：資料檔檢查規則（根目錄 `data-check.js`）的測試，含 2026-09-21 兩次貼錯事故的重現、球員名單的背號檢查、
  比賽資料檔（`data/games/*.json`）的格式與檔名檢查、時程 `resultUrl` 格式、公告 `link`（只接受比賽與三個站內頁，錯了只警告）、比賽資料的我方背號要對得上 `data/players.json`（`checkGameRoster`，2026-10-01）。
- `check_data.js`：不是測試，是檢查 `data/schedule.json`、`data/announcements.json` 的指令；
  GitHub 自動檢查（`.github/workflows/check-data.yml`）也是跑這兩支。
- `test_scenarios.js`（26 項）：三大調度情境（A×6、B×5、C×7）、規則守門（G×3）、DH 規則引導（D×5），見下。
  各案例的規則依據與細節見 `docs/測試報告_調度三情境.md`。

## test_scenarios.js 的三個情境

| 情境 | 內容 |
|---|---|
| **A 一般九人** | 投手在打序裡需要打擊。涵蓋先發、單次換投、代打後改守備、連續換投、手動成績保留 |
| **B 全場 DH** | 投手不在打序。涵蓋先發、獨立換投、三次換投、DH 被代打、DH 被代跑後接任 |
| **C 先發 DH 中途取消** | 依 MLB Rule 5.11(a)：DH 去守備、投手轉守、代打者上場投球、投手進打序、取消前後換投、多重換人 |
| **G 規則守門** | 守位重複擋上傳、退場球員不得回場、DH 取消後投手仍選得到 |
| **D DH 規則引導** | DH 有效時投手只能打 DH 棒、DH 去守備／投手轉守後自動預填下一步、投手未進打序的提示 |

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
