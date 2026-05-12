# CONTEXT.md — bc-reporter (Velopulse 財務報表)

AI 接續協定: 收到 `resume` → 讀此檔 → 摘要 Current State + Next step → 開工。離開前更新此檔並 commit+push。

---

## 🎯 Current State
- **Status**: deployed (查帳應收/應付日期與科目篩選已恢復)
- **Branch**: `main`
- **Last session**: deploy — 查帳下拉恢復後，再修正 `應收帳款`/`應付帳款` 可選日期與科目，commit `1fd7488`
- **Working on**: reports.velopulse.io 查帳功能已補回 `應收帳款`、`應付帳款`、`客戶付款日記帳`、`供應商付款日記帳`、`品項分類帳`；應收/應付改走總帳分錄明細並自動預選應收/應付科目
- **Next step**: 使用者重整正式站，進 `查帳` 選 `應收帳款` 或 `應付帳款`，確認日期欄位與科目篩選可用；後續回到 `public/ui-prototype.html` 的 Sales & Opportunities UI review
- **Blockers**: 無

## 🗂 Project Overview
- **Purpose**: Velopulse 集團財務報表 + 費用比較 + 業務管線 + 查帳 (reports.velopulse.io)
- **Stack**: Node.js + Express (api/) + Vanilla JS (public/) + Excel 匯入
- **Key paths**:
  - `api/` — 後端 API (income-statement, balance-sheet, ebitda, expense-comparison, ledger/*, pipeline/*)
  - `public/` — 前端 (dashboard, reports, strategy module)
  - `src/` — 共用邏輯
  - `config/` — 公司設定 (pinchen/bbtruck/shine/thexin)
  - `scripts/` — 工具腳本 (Excel 匯入等)
  - `Dockerfile` + `deploy.sh` — GCP VM 部署
- **Entry points**:
  - Dev: `npm start` (或見 package.json scripts)
  - Deploy: `./deploy.sh` → GCP VM docker compose
  - API: https://reports.velopulse.io (cookie auth admin/admin123)

## 🔑 Key Decisions
- **Cookie 認證** admin/admin123 (cookie 存 `/Users/cph/bots/Cphteleline_bot/velopulse_cookie.txt`, 過期自動重登)
- **多公司隔離** — pinchen / bbtruck / shine / thexin (companyId 參數)
- **權限系統獨立** — financial / sales / purchasing / pipeline / reports 各自控制
- **費用報帳** — 以 `config/expenses.json` / DATA_DIR JSON store 保存；附件先沿用 data URL 模式，每張單最多 12 個附件、單檔 8MB
- **部門主檔** — 以 `config/departments.json` / DATA_DIR JSON store 保存；admin 可新增/編輯/刪除/停用部門，使用者可指派 `department`，費用單申請部門預設帶入登入者部門並改走公司別下拉選單
- **附件辨識** — `src/services/expenseScanner.js` 預設走 Qwen/OpenAI-compatible vision API (`EXPENSE_SCAN_*` 或沿用 `LINE_DIRECT_API_*`)；Gemini 只在 `EXPENSE_SCAN_PROVIDER=gemini` 時使用。Web 先支援圖片 OCR，辨識結果只帶入草稿，需人工核對後再送出
- **UI 整併 prototype** — `public/ui-prototype.html` 採「工作台首頁 + 左側分群導覽」：營運總覽 / Sales & Opportunities / 分析查詢 / 策略與管理；報表與查帳收斂為「財務查詢中心」；新增「全功能地圖」逐項列出目前所有功能與權限/流程；Sales & Opportunities 改成業務工作台，先顯示 pipeline/contacts/sales expenses 三個核心入口與今日優先事項，再往下顯示 stage summary、商機列表與右側詳情 drawer；SALESPA01 Bot 不進一般業務工作區，只在系統設定顯示整合狀態
- **Cell-level Excel 匯入** (commit 5490f06) — 取代整檔覆蓋
- **HTML cache 關閉** (commit 8b0a87b) — 避免 deploy 後 JS stale
- **部署**: GCP VM `/home/cph/deploy/bc-reporter` (docker compose), NOT Cloud Run

## 🚧 Pending / TODO
- [ ] 使用者 review `public/ui-prototype.html` 的「Sales & Opportunities」新版工作台：核心入口卡、今日優先事項、stage summary、商機列表與詳情 drawer
- [ ] 使用者重整並 review `public/ui-prototype.html` 的「全功能地圖」，確認功能盤點是否完整
- [ ] 若採用 prototype 方向：先拆正式前端導覽殼層，再逐步搬 dashboard / operations / finance-query / strategy 子模組
- [ ] 到帳號管理開通使用者 `expense` 權限；主管帳號需設定 `managedSalespeople`
- [ ] 確認 production 有 `EXPENSE_SCAN_API_URL` / `EXPENSE_SCAN_API_KEY` / `EXPENSE_SCAN_MODEL`（可沿用 SALESPA01 bot 的 `LINE_DIRECT_API_*`），讓附件 OCR 可正式使用
- [ ] 確認既有 SALESPA01 bot 串接狀態：目前 repo 已有 `lineBot.js` / `botAuth.js` / `bot-auth.html`，若要擴充照片 OCR → 費用草稿，應列為 bot 後端能力，不放一般業務 UI
- [ ] 若要正式會計紙本格式，可再加 Excel/PDF 匯出，對齊「品辰科技 - 請款單 v20251202.xlsx」

## 🐛 Known Issues
- **近期修復**: 查帳下拉恢復應收/應付與付款日記帳/品項分類帳；應收/應付報表改走總帳分錄明細，保留日期與科目篩選，並自動預選對應應收/應付科目
- **近期修復**: Business Central customers API 改讀 `balanceDue` 並正規化為 `balance`
- **近期修復**: MoM/QoQ/YoY 比較期間改為月末保持月末；月報 4/1~4/30 的上期不再少抓 3/31
- **限制**: 費用報帳附件目前存 JSON data URL，適合收據/發票等小檔；若日後大量 PDF/照片，建議改成本機/物件儲存
- **近期修復**: Excel label parsing 用 col A (item name) 不用 col B (unit) — commit 7691ac6
- **近期修復**: strategy module merge conflict (twStockView nested in hidden modal) — commit 995b3e2
- **Security 已修**: admin export 剝離 passwordHash — commit b1c9a9f

## 📎 External Refs
- Prod: https://reports.velopulse.io
- API 範例:
  - `/api/income-statement?year=2026&month=2&companyId=pinchen`
  - `/api/balance-sheet`, `/api/ebitda`, `/api/ebitda/ytd`
  - `/api/dashboard`, `/api/sales-dashboard`
  - `/api/expense-comparison` (科目 510100-631038)
  - `/api/ledger/*` (GL entries, trial balance, journals, customers, vendors, customer/vendor payment journals, item ledger)
  - `/api/pipeline/leads` (含 DELETE), `/api/pipeline/activities`, `/api/pipeline/dashboard`
  - `/api/contacts`
- 相關 repo: `hr-velopulse` (HR 系統, 結構類似但分開)

## 🖥 Environment
- **Dev**: m4pro `~/bc-reporter` (本機 clone, 雙位置: ~/bc-reporter 和 ~/Downloads/bc-reporter/)
- **Prod**: GCP VM velopulse-server (35.229.175.146) docker compose port 3000
- **Cookie path**: `/Users/cph/bots/Cphteleline_bot/velopulse_cookie.txt`
- **重新登入**: `curl -s -X POST "https://reports.velopulse.io/auth/login" -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}' -c <cookie_path>`

## 公司列表 (companyId)
- `pinchen` — 品辰科技物流
- `bbtruck` — BBTRUCK 全球合併
- `shine` — Shine Solution Inc.
- `thexin` — 泰欣通運

## 📜 Session Log
### 2026-05-12 11:35 (m4pro, codex)
- 回應使用者「應收/應付帳款報表功能不見」：確認後端仍有部分 ledger API，但前端查帳下拉只剩總帳分錄、試算表、日記帳
- 改了 `public/index.html`, `src/routes/reports.js`, `src/services/bcClient.js`
- 查帳下拉補回 `應收帳款`、`應付帳款`、`客戶付款日記帳`、`供應商付款日記帳`、`品項分類帳`；新增 `/api/ledger/customers` 與 `/api/ledger/vendors`
- 修正 Business Central customer balance 欄位：由 `balance` 改讀 `balanceDue`，並正規化回 `balance`
- 收到使用者指出「不能選日期/科目」後修正：`應收帳款`/`應付帳款` 不再只顯示目前餘額清單，改用總帳分錄明細，保留日期範圍與科目篩選；預設自動帶 `應收帳款` / `應付帳款` posting accounts
- Commit/push/deploy: `c3a2dbb fix: restore ledger report options`、`cfeb053 fix: load customer receivables balance`、`1fd7488 fix: keep ledger filters for receivables payables`，已跑 `./deploy.sh`
- 驗證：`node --check` 後端檔通過、`public/index.html` script compile 通過；正式站 health OK，HTML 含 `applyLedgerPresetAccounts`；pinchen 2026-04 應收科目 GL query 回 106 筆、應付科目 GL query 回 62 筆
- 下次從: 使用者重整正式站進 `查帳` 選 `應收帳款` / `應付帳款`，確認日期與科目篩選可用；若仍缺某個舊報表名稱，依舊名稱補回對應入口

### 2026-05-11 11:18 (m4pro, codex)
- 回應使用者指出月報 MoM 上期欄位少一天：`2026-04-01 ~ 2026-04-30` 原本對到 `2026-03-01 ~ 2026-03-30`
- 修正 `src/services/reportEngine.js` 的 `getComparisonRange()`，改成字串日期計算並保留月底語意；月底日期位移到上一期時會抓目標月份月底
- Commit/push: `629f147 fix: align comparison period month end`，已跑 `./deploy.sh` 部署到 GCP VM
- 驗證：`node --check src/services/reportEngine.js` 通過；手動測試確認 MoM `2026-04-01 ~ 2026-04-30` => `2026-03-01 ~ 2026-03-31`，QoQ `2026-04-01 ~ 2026-06-30` => `2026-01-01 ~ 2026-03-31`；正式站 `/api/income-statement?...compare=mom&companyId=pinchen` 回 `comparePeriod.endDate=2026-03-31`
- 下次從: 使用者重整正式站報表畫面確認表頭；後續可回到 Sales & Opportunities prototype review

### 2026-05-11 10:51 (m4pro, codex)
- 依使用者「繼續幫我優化 UI」繼續整理 prototype，聚焦 Sales & Opportunities 的資訊層級
- 將原本三張平鋪功能卡改成業務工作台：`PIPELINE`、`CONTACTS`、`SALES EXPENSES` 三張核心入口卡 + `今日優先事項` 右側面板
- 新增 pipeline stage summary：新商機、需求確認、報價中、等待決策、已完成，讓主管先看 funnel 狀態再進列表
- 調整文案：頁面標題改成 `Sales pipeline、名片與業務費用集中管理`，業務費用明確只放業務本人/主管簽核需要看的狀態，財務付款與系統設定留後台
- 改了 `public/ui-prototype.html`, `CONTEXT.md`
- 驗證：`public/ui-prototype.html` script compile 通過；搜尋確認新文案與 class 存在、`LINE Bot` 不在 prototype；app browser 的 browser-use 工具今日擋住 `file://` 直接開啟，因此未做瀏覽器視覺截圖
- 下次從: 使用者實際看 app browser file 畫面後，決定 Sales & Opportunities 是否還要把業務費用拆出去或保留為 sales expense 子入口

### 2026-05-09 11:55 (m4pro, codex)
- 回應使用者質疑「LINE Bot 綁定跟一般業務無關，而且應已和 SALESPA01 bot 串接」：確認 repo 內已有 `src/services/lineBot.js`, `src/routes/botAuth.js`, `public/bot-auth.html`
- 修正 prototype 分類：從 Sales & Opportunities 移除 `LINE Bot` tab、`LINE Bot 綁定` 卡片與作業盤點列
- 將 bot 相關資訊改放到系統設定：全功能地圖改為 `整合狀態`，系統設定 mini-card 改為 `SALESPA01 Bot 整合`
- 改了 `public/ui-prototype.html`, `CONTEXT.md`
- 下次從: app browser reload 後確認 Sales & Opportunities 只剩商機、名片與費用簽核，不再出現一般業務不需要的 bot 綁定入口

### 2026-05-09 11:52 (m4pro, codex)
- 依使用者命名修正：原型中的作業模組不再叫「費用與商機」，改為 `Sales & Opportunities`
- 同步調整左側導覽分組為 `Sales Ops`、模組 icon 為 `S`、頁面 eyebrow 為 `SALES & OPPORTUNITIES`，並把頁面標題改成「業務、商機、名片與費用簽核集中管理」
- 改了 `public/ui-prototype.html`, `CONTEXT.md`
- 驗證：搜尋確認 `public/ui-prototype.html` 已沒有舊模組名稱；下次從 app browser reload 後確認左側導覽顯示
- 下次從: 使用者確認 Sales & Opportunities 內的商機列表與費用簽核是否還要拆成子入口
