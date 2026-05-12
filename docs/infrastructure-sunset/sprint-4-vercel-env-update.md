---
title: Sprint 4 — Vercel Project Env Vars Update (T4.3)
date: 2026-05-03
status: ✅ COMPLETED 2026-05-12 (T4.3.3 Preview environment closeout + API_BASE_URL fix)
---

> **Closeout note (2026-05-12):** Production env vars were done in the original sprint. The **Preview environment** step (T4.3.3 below) was left undone for 9 days. It surfaced during the grade-level-fix sprint when PR #45 needed a working preview URL: the old Preview env vars still pointed at the dead UAT Cognito client `f9r69qrqfgpekdjfo93a8n5mu`. While fixing it we also caught a more dangerous latent issue: `API_BASE_URL` had been emptied in **Production** env. The live Production deployment kept working because its routing manifest was baked when the var had a value, but **any rebuild would have shipped a broken bundle**. Set to the prod backend URL in both environments. Time-bomb defused.
>
> See § Closeout actions taken at the bottom of this file for the exact commands run.

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

- [x] All 6 keys updated in Vercel Production environment (2026-05-03, original sprint)
- [x] All 6 keys updated in Vercel Preview environment (2026-05-12, closeout)
- [x] PR preview deploys successfully against ap-south-1 (PR #45 preview verified login + 6 form components)
- [x] `https://edforge.app` loads + login redirect URL contains `auth.ap-south-1.amazoncognito.com` (NOT `auth.us-east-2`)
- [x] Auth round-trip completes against the prod tenant pool

# If something's wrong

The most common failure mode is a stale `API_BASE_URL` env var still pointing at the deleted us-east-2 API Gateway. The user-visible symptom is a network error or 503 on first API call after login. Cross-reference Vercel's runtime env tab vs the table above.

A second, sneakier failure mode: `API_BASE_URL` set to **empty string** (`""`). `vercel.json` has a route `/api/(.*)` → `${API_BASE_URL}/$1`. When the env var is empty, the destination becomes `/$1` which falls through to the SPA `index.html` fallback at `routes[].dest=/index.html`. The frontend receives HTML where it expected JSON, axios parses it silently, and the app stays stuck on Loading. The currently-deployed Production bundle masks this because the routing manifest is baked at build time — but the next rebuild would ship the broken behavior. **`API_BASE_URL` must always carry the real backend URL, in every environment.**

# Closeout actions taken — 2026-05-12

| When | Env | Var | Action | Operator |
|---|---|---|---|---|
| 2026-05-12T03:13Z | Preview | 7 vars (`VITE_*` + `API_BASE_URL`) | Removed stale values; added prod ap-south-1 values from production snapshot | shoaibrain |
| 2026-05-12T15:30Z | Production | `API_BASE_URL` | Was `""` (empty — latent time-bomb); set to `https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod` | shoaibrain |
| 2026-05-12T15:30Z | Preview | `API_BASE_URL` | Was unset (broken since the Preview-vars cleanup earlier the same day); added same prod backend URL | shoaibrain |
| 2026-05-12T15:32Z | — | — | Empty commit pushed to PR #45 branch (`14f568f`); Vercel preview rebuild `jfnvv8hkf` confirmed `/api/users/me` now returns JSON 200 (no longer 304/HTML SPA-fallback) | (auto on push) |
| 2026-05-12T15:40Z | Production | (rebuild) | PR #45 merged into main → Vercel auto-deployed Production `9ztknibsq` with corrected `API_BASE_URL` baked into routing manifest | (auto on merge) |

Deploy log: [docs/deploys/prod-vercel-env-fix-20260512-154000-ad1a194.log](../deploys/prod-vercel-env-fix-20260512-154000-ad1a194.log).

## uat.edforge.app alias — removed 2026-05-12T16:00Z

A separate cleanup followed the env-var work: the `uat.edforge.app` Vercel alias had been left behind by infra-sunset/3's UAT teardown. It was still pointing at a pre-sunset deployment whose bundle had the dead UAT Cognito client ID hardcoded. Anyone with a stale bookmark would have hit "User pool client f9r69qrqfgpekdjfo93a8n5mu does not exist" on attempted login.

Removed via `vercel alias rm uat.edforge.app --yes`. Subdomain now returns 404 `DEPLOYMENT_NOT_FOUND`. External DNS record at the registrar still resolves to Vercel's edge — operator will delete that at next convenient window. Better state regardless of when DNS gets cleaned up.

Deploy log: [docs/deploys/prod-vercel-uat-alias-removed-20260512-160000.log](../deploys/prod-vercel-uat-alias-removed-20260512-160000.log).

# Adjacent follow-up

A cleaner long-term answer is to refactor `packages/api-client/src/index.ts` to read `import.meta.env.VITE_API_URL` directly as the axios `baseURL`, eliminating the `vercel.json` rewrite dependency entirely. The bundle would have the backend URL inlined at build time. No edge-routing layer means no Vercel-env-var-empty footgun. Tracked as a deferred refactor; not blocking any pilot.
