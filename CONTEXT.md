# CONTEXT.md — bc-reporter (Velopulse 財務報表)

AI 接續協定: 收到 `resume` → 讀此檔 → 摘要 Current State + Next step → 開工。離開前更新此檔並 commit+push。

---

## 🎯 Current State
- **Status**: in-progress (本機已完成費用簽收單 + Qwen 附件 OCR/手機拍照 + 三角色本機模擬 + 部門 CRUD/使用者部門指派; 待部署)
- **Branch**: `main`
- **Last session**: feature — department CRUD in admin
- **Working on**: reports.velopulse.io 新增費用簽收單，支援附件、OCR 帶入草稿、手機拍照、業務送出、主管簽核、財務核准/付款
- **Next step**: 部署到 GCP VM，並在帳號管理替需要的人開 `expense` 儀表板權限
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
- **費用簽收單** — 以 `config/expenses.json` / DATA_DIR JSON store 保存；附件先沿用 data URL 模式，每張單最多 12 個附件、單檔 8MB
- **部門主檔** — 以 `config/departments.json` / DATA_DIR JSON store 保存；admin 可新增/編輯/刪除/停用部門，使用者可指派 `department`，費用單申請部門預設帶入登入者部門並改走公司別下拉選單
- **附件辨識** — `src/services/expenseScanner.js` 預設走 Qwen/OpenAI-compatible vision API (`EXPENSE_SCAN_*` 或沿用 `LINE_DIRECT_API_*`)；Gemini 只在 `EXPENSE_SCAN_PROVIDER=gemini` 時使用。Web 先支援圖片 OCR，辨識結果只帶入草稿，需人工核對後再送出
- **Cell-level Excel 匯入** (commit 5490f06) — 取代整檔覆蓋
- **HTML cache 關閉** (commit 8b0a87b) — 避免 deploy 後 JS stale
- **部署**: GCP VM `/home/cph/deploy/bc-reporter` (docker compose), NOT Cloud Run

## 🚧 Pending / TODO
- [ ] 部署費用簽收單功能到 GCP VM / reports.velopulse.io
- [ ] 到帳號管理開通使用者 `expense` 權限；主管帳號需設定 `managedSalespeople`
- [ ] 確認 production 有 `EXPENSE_SCAN_API_URL` / `EXPENSE_SCAN_API_KEY` / `EXPENSE_SCAN_MODEL`（可沿用 SALESPA01 bot 的 `LINE_DIRECT_API_*`），讓附件 OCR 可正式使用
- [ ] 第二階段再接 SALESPA01 bot：收到照片 → OCR → 建立費用草稿 → 回覆審核連結
- [ ] 若要正式會計紙本格式，可再加 Excel/PDF 匯出，對齊「品辰科技 - 請款單 v20251202.xlsx」

## 🐛 Known Issues
- **限制**: 費用簽收附件目前存 JSON data URL，適合收據/發票等小檔；若日後大量 PDF/照片，建議改成本機/物件儲存
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
  - `/api/ledger/*` (GL entries, trial balance, journals)
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
### 2026-05-09 10:27 (m4pro, codex)
- 帳號管理新增「部門管理」卡片：可依公司查看部門、新增、編輯名稱/啟用狀態、刪除
- 改了 `src/services/departmentStore.js`, `src/routes/admin.js`, `public/admin.html`, `CONTEXT.md`
- 刪除保護：仍有使用者指派到該部門時會阻擋；部門改名會同步更新使用者 `department`
- 驗證：Node syntax、HTML script compile、localhost API 新增→改名→刪除測試部門成功、刪除已指派的 `業務部` 被擋下
- 下次從: 用瀏覽器操作部門管理 UI 做視覺確認，或部署到 GCP

### 2026-05-09 10:12 (m4pro, codex)
- 帳號管理新增使用者部門指派：使用者列表顯示「部門」，新增/編輯帳號可用下拉選所屬部門
- 改了 `src/services/userStore.js`, `src/routes/admin.js`, `public/admin.html`, `public/index.html`
- 費用單新增時預設帶入登入者 `department`；三個本機 demo 帳號補上部門：業務/主管=業務部、財務=財務部
- 驗證：Node syntax、HTML script compile、`/api/admin/departments`、`/api/admin/users` 回傳部門、`/auth/me` 回傳業務部
- 下次從: 若需要部門主檔新增/停用 UI，再補 admin 部門維護；否則部署到 GCP

### 2026-05-09 10:03 (m4pro, codex)
- 新增公司別部門主檔與費用單申請部門下拉選單
- 改了 `config/departments.json`, `src/services/departmentStore.js`, `src/routes/expenses.js`, `src/routes/admin.js`, `public/index.html`
- 同步修正主管/財務權限分離：財務按鈕改以 `strategyRole=finance_editor` 判斷，主管只做核准/退回
- 驗證：Node syntax、HTML script compile、費用帳號可讀 `/api/expenses/config?companyId=pinchen` 部門清單、三角色 API 視角檢查
- 下次從: 若需要部門新增/停用畫面，補 admin 部門維護 UI；否則部署到 GCP

### 2026-05-09 09:58 (m4pro, codex)
- 為本機測試站建立三角色模擬：業務部申請人、業務部主管批准人、財務部處理人
- 改了 `public/login.html`: localhost 顯示三個測試角色快捷登入按鈕
- 種了本機 `/tmp/bc-exp-test-20260508` demo users: `sales.expense`, `manager.expense`, `finance.expense`，密碼 `demo123`；demo claims: `draft`, `submitted`, `manager_approved`
- 驗證：login/index HTML script compile、登入頁可看到快捷鈕、三個角色 API 視角正確
- 下次從: 使用瀏覽器逐角色檢查操作體驗，或部署到 GCP 前移除/避免 demo login 顯示於正式網域

### 2026-05-09 09:37 (m4pro, codex)
- 排查使用者回報「辨識很慢 / Failed to fetch / 送出簽核後去哪裡」
- 改了 `public/index.html`: OCR 前端先壓縮手機照片再送 Qwen、顯示 AI 耗時、Failed to fetch 改成可讀錯誤、費用明細刪除鍵移到左側 sticky 操作欄
- 改了 `src/services/expenseScanner.js`: 回傳 provider/model/durationMs，失敗也帶 durationMs
- 驗證：HTML script compile、Node syntax、localhost API smoke test 建立→送出簽核 status=submitted；測試單已刪除
- 下次從: 使用實際收據驗證 OCR 品質，或部署到 GCP 並設定正式 `EXPENSE_SCAN_*`
