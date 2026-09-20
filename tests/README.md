# 本機測試

需要 Node.js（不用安裝任何套件）。在專案根目錄執行：

```
node tests/test_gas_modules.js
node tests/test_lineup_logic.js
```

- `test_gas_modules.js`：Auth.gs（隊務登入）與 Pitchers.gs（投手名單）單元測試
- `test_lineup_logic.js`：抽出 lineup.html 的程式邏輯，搭配實際的 gas/Code.gs + Auth.gs + Pitchers.gs 與模擬試算表，跑完整的點名→先發→調度→上傳→回讀→結案流程
- 限制：不會載入 Vue／Tailwind，畫面本身仍需在手機上實測
