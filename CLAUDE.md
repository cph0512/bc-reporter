# BC Reporter — Development Guidelines

## Security Rules (AI Coding 資安規範)

All AI-generated code MUST follow these rules before merge:

- **[SECURITY-SECRETS]** 禁止硬編碼任何 API Key、Secret、Token。一律使用 `process.env` 或 Secret Manager。
- **[SECURITY-INPUT]** 所有外部輸入必須驗證與消毒 (sanitization + validation)。
- **[SECURITY-OUTPUT]** 錯誤訊息不得包含 stack trace、內部路徑、或系統結構資訊。
- **[SECURITY-LOGGING]** 日誌中禁止記錄密碼、Token、PII（個人資料）、信用卡號。
- **[SECURITY-API]** 新增 API route 必須掛載 `requireAuth` middleware，並設定 rate limiting。
- **[SECURITY-DEPS]** 新增 npm 套件前須確認無已知漏洞 (`npm audit`)。
- **[SECURITY-DATA]** 傳輸必須使用 TLS 1.2+。PII 資料處理完即刪。
- **[SECURITY-AI]** 傳送至 LLM 的資料必須將 user data 標記為不可信輸入，使用結構化格式隔離 system prompt 與 user data。

## Project Structure

- `src/index.js` — Express app entry point
- `src/middleware/` — Auth, security, rate limiting, audit log
- `src/routes/` — API route handlers
- `src/services/` — Business logic (BC client, Gemini, LINE bot, data stores)
- `config/` — Default seed data (JSON)
- `public/` — Frontend HTML/JS/CSS

## Conventions

- Node.js >= 18, Express 4.x
- Session-based auth with bcrypt password hashing
- JSON file storage (no SQL database)
- Environment variables via `.env` (never committed)

## Deployment (GCP VM)

**Production URL:** https://reports.velopulse.io
**GCP Project:** `velopulse-infra`
**VM:** `velopulse-server` (asia-east1-b, 35.229.175.146)
**Container:** `deploy-bc-reporter-1` (Docker Compose at `/home/cph/deploy/`)
**Reverse Proxy:** Caddy (auto TLS)

### Deploy Steps

```bash
# Option 1: Use deploy script
./deploy.sh

# Option 2: Manual
gcloud compute ssh velopulse-server --project velopulse-infra --zone asia-east1-b --command "
  cd /home/cph/deploy/bc-reporter && git pull origin main
"
gcloud compute ssh velopulse-server --project velopulse-infra --zone asia-east1-b --command "
  cd /home/cph/deploy && docker compose up -d --build bc-reporter
"
```

### Environment (.env.bc on VM)

Required in production:
- `SESSION_SECRET` — Session encryption key
- `SYNC_SECRET` — API sync authentication key
- `NODE_ENV=production`
- `PORT=3000`

### Other Services on Same VM

| Service | Port | Env File | Domain |
|---------|------|----------|--------|
| bc-reporter | 3000 | .env.bc | reports.velopulse.io |
| tg-service | 3001 | .env.tg | (internal) |
| form-builder | 3002 | .env.fb | velopulse.io |
| postgres | 5432 | (compose) | (internal) |
| caddy | 80/443 | Caddyfile | (reverse proxy) |

### Post-Deploy Checklist

- [ ] `curl https://reports.velopulse.io/health` returns 200
- [ ] Login page loads and login works
- [ ] CSP header includes `script-src-attr 'unsafe-inline'`
