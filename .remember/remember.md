# Handoff

## State
Branch `claude/practical-bell` deployed to GCP (velopulse-server, asia-east1-b, `~/deploy/`).
查帳 (Ledger) tab live with GL entries, trial balance, journals. `ledger` dashboard permission added to admin UI.
科目名稱 lookup fix deployed (accounts cache → displayName map). Sticky header overlap fixed. Chips collapse > 8.

## Next
1. User wants **科目餘額明細** but NOT AR subledger / aging — clarify exactly what they want before building anything.
2. PR #3 on GitHub (`claude/practical-bell` → `main`) still not merged.
3. GCP deploy = `sudo docker compose build bc-reporter && sudo docker compose up -d --force-recreate bc-reporter` (build required, static files are in image).

## Context
- GCP git worktree is on `claude/practical-bell`; Dockerfile must be borrowed from main each time: `git checkout main -- Dockerfile`.
- `--force-recreate` alone does NOT update static files — must `build` first.
- BC client secret: see local `.env` or GCP `~/deploy/.env.bc` (expires 2028-02-29).
