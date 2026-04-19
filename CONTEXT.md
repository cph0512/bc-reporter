# CONTEXT.md — bc-reporter (Velopulse 財務報表)

AI 接續協定: 收到 `resume` → 讀此檔 → 摘要 Current State + Next step → 開工。離開前更新此檔並 commit+push。

---

## 🎯 Current State
- **Status**: paused (近期完成 P&L Forecast 頁面 + Excel cell-level 匯入)
- **Branch**: `main`
- **Last session**: security — strip passwordHash from admin export endpoint
- **Working on**: P&L Forecast 模組 + Strategy role permissions 完成
- **Next step**: 待定 — 待使用者指示; 可能方向: 擴充費用比較分析 / 增加新公司 / 報表 UI 優化 / 部署到 GCP
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
- **Cell-level Excel 匯入** (commit 5490f06) — 取代整檔覆蓋
- **HTML cache 關閉** (commit 8b0a87b) — 避免 deploy 後 JS stale
- **部署**: GCP VM `/home/cph/deploy/bc-reporter` (docker compose), NOT Cloud Run

## 🚧 Pending / TODO
- [ ] 待使用者給方向; 可能候選:
  - [ ] 費用比較 UI 增強 (月/年比較已有, 可加 budget vs actual)
  - [ ] 新公司上架
  - [ ] Pipeline dashboard 優化
  - [ ] ledger 查帳 UI (API 已有)

## 🐛 Known Issues
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
### 2026-04-19 22:20 (m4pro, claude)
- 建立 CONTEXT.md 納入 Resume Protocol
- 尚未動程式碼
- 下次從: 等使用者給方向

### 2026-04-15 (近期 commits)
- `b1c9a9f` security: strip passwordHash from admin export
- `7691ac6` fix: Excel label parsing 改用 col A
- `5dcf119` feat: P&L Forecast 頁面 (市場×商業模式交叉明細)
- `5490f06` feat: cell-level Excel forecast import + strategy roles
