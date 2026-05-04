---
title: Sprint 4 — Vercel Project Env Vars Update (T4.3)
date: 2026-05-03
status: Operator action — not in repo, must be done in the Vercel dashboard
---

# Why this is operator-driven

`edforge-saas-frontend` deploys via Vercel (not CDK). Its production runtime reads env vars from **Vercel project settings**, not from any `.env.local` in the repo. The `.env.local` files are local-dev only — Sprint 4's T4.2 already updated those. Vercel is a separate update.

# What to do

1. Open https://vercel.com/dashboard → `edforge-saas-frontend` project → Settings → Environment Variables.
2. For the **Production** environment, replace the following keys with the prod ap-south-1 values. Snapshot pulled 2026-05-03:

| Key | New value |
|---|---|
| `VITE_API_URL` | `https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod` |
| `VITE_COGNITO_REGION` | `ap-south-1` |
| `VITE_COGNITO_USER_POOL_ID` | `ap-south-1_spYeNvNJt` |
| `VITE_COGNITO_CLIENT_ID` | `5bqleabcb6j9aeu4uipfppgb94` |
| `VITE_COGNITO_DOMAIN` | `edforge.auth.ap-south-1.amazoncognito.com` |
| `API_BASE_URL` | `https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod` |

3. Repeat for the **Preview** environment if it has a separate config (PR previews).

4. Trigger a redeploy: open any open PR or push a no-op commit. Confirm the preview URL hits ap-south-1 and login works.

5. Verify https://edforge.app responds (you should see the app load and login redirect to `edforge.auth.ap-south-1.amazoncognito.com/login...`).

# Validation checklist

- [ ] All 6 keys updated in Vercel Production environment
- [ ] All 6 keys updated in Vercel Preview environment (if separate)
- [ ] PR preview deploys successfully against ap-south-1
- [ ] `https://edforge.app` loads + login redirect URL contains `auth.ap-south-1.amazoncognito.com` (NOT `auth.us-east-2`)
- [ ] Auth round-trip completes against the prod tenant pool

# If something's wrong

The most common failure mode is a stale `API_BASE_URL` env var still pointing at the deleted us-east-2 API Gateway. The user-visible symptom is a network error or 503 on first API call after login. Cross-reference Vercel's runtime env tab vs the table above.
