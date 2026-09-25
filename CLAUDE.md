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

## 測試

改完 `lineup.html` 或 `gas/*.gs`，三支都要重跑，全綠才 commit：

```
node tests/test_gas_modules.js
node tests/test_lineup_logic.js
node tests/test_scenarios.js
node tests/test_scenarios.js --repeat 5
```

不能為了讓測試變綠而直接改斷言；測試框架不能比真實 UI 寬鬆（見 `docs/測試報告_調度三情境.md` 第九節）。

## 文件維護（每次更動都要做）

`docs/` 的四份文件以 repo 版本為準，**和程式改動放在同一個 commit 一起更新**：

| 發生了什麼 | 要更新哪裡 |
|---|---|
| 完成或新增待辦、優先序改變、使用者做了決定 | `docs/專案現況.md` 對應章節＋檔頭「最後更新」日期 |
| 改了會上線的程式（`lineup.html`、`gas/*.gs`、對外頁面） | `docs/CHANGELOG.md` 新增版本段落 |
| 測試案例增減、規則依據改變 | `docs/測試報告_調度三情境.md`＋`tests/README.md` 的項數 |
| 簡碼字典有新定案 | `docs/文字記錄簡碼字典.md` |
| 開發或維護流程改變 | `DEVELOPMENT.md` |

已完成的事改寫成「已完成（日期、commit）」，不要直接刪掉。

## 部署注意

- `main` = GitHub Pages = 正式上線，push 後約一分鐘生效
- 改了 `gas/*.gs`：使用者要貼進 Apps Script 並「建立新版本」才生效。**GAS 要先部署，再 merge `main`**
- 這個 repo 是公開的：**不要 commit 密碼、金鑰、密碼提示**
