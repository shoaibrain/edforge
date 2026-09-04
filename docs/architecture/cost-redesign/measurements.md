# Cost redesign — measurements

Numbers observed on the deployed system, recorded per sprint so the estimates
in `TARGET_ARCHITECTURE.md` can be checked against reality. Every figure here
comes from a CloudWatch `REPORT` line or a CloudFormation event; nothing is
extrapolated.

## Sprint 1 — service Lambdas beside ECS (2026-09-04)

Deployed by `scripts/deploy.sh tenant-template-stack-basic prod --exclusively`
with `CDK_PARAM_LAMBDA_SERVICES=true`. CloudFormation update 83 s; ECS
services untouched (same task definitions and deployment timestamps before
and after). Functions: `nodejs22.x`, x86_64, 1,769 MB, 29 s, outside the VPC.

### Package sizes

| Service | Bundle (minified, on disk) | Deployment package (zipped) | Layers |
|---|---|---|---|
| identity | 7.6 MiB | 2.0 MiB | — |
| academics | 7.2 MiB | 1.9 MiB | — |
| finance | 8.1 MiB | 2.2 MiB | sharp (linux-x64, 17 MiB unzipped) |

### Cold and warm invocations (`GET /health/live`, direct invoke)

| Service | Init Duration (module load) | First-request Duration (Nest bootstrap + request) | Cold total | Warm Duration | Max memory |
|---|---|---|---|---|---|
| identity | 1,833 ms | 269 ms | ≈ 2.10 s | 4.1 ms | 301 MB |
| academics | 1,763 ms | 238 ms | ≈ 2.00 s | 5.8 ms | 310 MB |
| finance | 1,631 ms | 287 ms | ≈ 1.92 s | 4.8 ms | 333 MB |

- **Estimate check.** `TARGET_ARCHITECTURE.md` §1.3 estimated 1.6–2.3 s cold
  from the 0.54–0.68 s local bootstrap. Measured cold totals 1.92–2.10 s sit
  inside the band. The split is worth knowing: ~85% of the cold start is
  loading the bundle (decorators executing at module scope), not
  `NestFactory.create`.
- **Memory.** Peak 301–333 MB against 1,769 MB allocated. The allocation is
  for the vCPU, not the memory; halving it would halve CPU and roughly double
  the cold start. Revisit only if warm latency stays this low under real
  traffic (C8).
- **Warm.** 4–6 ms handler duration; wall time from a laptop in another
  region was 300–460 ms, i.e. network dominated.
- **Billed cold start.** 1.9–2.1 s billed on the first invocation of each
  environment (Init Duration is billed on `nodejs22.x`).
- **Guarded route without a token:** 401 in 6 ms from the passport guard, no
  JWKS fetch.

Authenticated cases (`GET /users/me`, students, invoices) are recorded here
when run with an operator-minted ID token.
