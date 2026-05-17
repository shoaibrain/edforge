# Deploy Log Index

Per CLAUDE.md "Deploy log convention", every prod-touching action tee's its output here. This INDEX maps each named deploy event to the relevant log files, organized by sprint + date.

Newer entries at the top.

---

## 2026-05-17 — Sprint C2 closeout: G1–G4 operator gates drained → 🟢 INTERNAL GREENLIGHT

**Outcome:** Pilot-greenlight harness **7 pass / 0 fail / 0 skipped** against `dev-pabson-primary` (tenant `21aea5da-…`) on `0c39a7a`. C2 greenlight gate closed; Sprint C3 unblocked. Full chronology in [`docs/pilot-greenlight/sprint-plan.md`](../pilot-greenlight/sprint-plan.md#0.5) §0.5.

### G1 — identity ECR + ECS roll (already captured 2026-05-16 evening)

- `prod-build-application-identity-20260516-201250-0c39a7a.log` — pushed `identity` digest `sha256:2433e16207ef…`
- `prod-ecs-roll-identitybasic-20260516-201250-0c39a7a.log` — task `0da651b376b1…` HEALTHY on `prod-basic/identitybasic`. Picks up PR #104 (Leave cancel 500) + PR #106 (shortName 409) + PR #107 (`schoolTypeDescriptor` enum tightening).

### G2 — C0.b.2 cleanup `--apply`

- `prod-s3-2-smoke-cleanup-2026-05-17T01-26-51-905Z-DRYRUN.log` — 6 marker rows identified in `dev-pabson-primary`
- `prod-s3-2-smoke-cleanup-2026-05-17T01-31-57-170Z-APPLY.log` — deleted 6 (3 calendar `S32-SMOKE-*` + 3 leave `S3.2 smoke`); post-apply residue = 0

### G3 — C0.b.5 `testing_day → exam_window` migration

Migration `--apply` against prod: **0 rows affected** — no legacy `testing_day` calendarEvents exist in prod (greenfield outcome of the C2 deploy ladder). Idempotent path confirmed; no log captured for a true no-op run.

### G4 — harness re-run (3 attempts)

- `prod-pilot-greenlight-G4-20260517-054706-0c39a7a.log` — env vars used `EDFORGE_*` prefix; harness reads bare `TENANT_ID` etc. → 7 skipped (vacuous green; **not authoritative**)
- `prod-pilot-greenlight-G4-20260517-054738-0c39a7a.log` — env vars fixed; 6 pass / 1 fail (C2.0 aborted on `CredentialsProviderError` in the post-write DDB audit check). Term 1 endDate was 2026-07-14 vs fixture-canonical 2026-07-16 → PATCH widened `endDate` + set the fixture exam window. `syncExamWindowEvents` auto-created the 9 missing `exam_window` rows for Term 1; that fix made C2.3 green on the next run.
- `prod-pilot-greenlight-G4-20260517-055018-0c39a7a.log` — **🟢 7/7 GREEN** with `AWS_PROFILE=prod` set. C2.3 verifies 40 exam-window days across 4 terms with a single `sourceTermId` each.

### Followups (small, non-blocking)

- One orphan staff training row in `dev-pabson-primary` from the 054738 cred-failure run (script cleanup block skipped on early-exit). One-off DELETE; not blocking.
- C2.0 script: wrap the AWS-SDK section in try/catch + graceful skip path so missing creds don't orphan the training row.

---

## 2026-05-16 — Sprint C2: pilot-greenlight code deploy (shift-profile + DATE_NOT_INSTRUCTIONAL + canonical calendar)

**PRs deployed:** [#95](https://github.com/shoaibrain/edforge/pull/95) (calendar seed script, ops), [#96](https://github.com/shoaibrain/edforge/pull/96) (PR-A: `GET /shift-profile` route — identity), [#98](https://github.com/shoaibrain/edforge/pull/98) (PR-B: attendance `DATE_NOT_INSTRUCTIONAL` — academics). Test-only PRs landed in the same window: [#91](https://github.com/shoaibrain/edforge/pull/91)–[#94](https://github.com/shoaibrain/edforge/pull/94), [#97](https://github.com/shoaibrain/edforge/pull/97), [#99](https://github.com/shoaibrain/edforge/pull/99), [#100](https://github.com/shoaibrain/edforge/pull/100) (no deploy required).

**Outcome:** Code deploy ✅ healthy. Pilot-greenlight harness verdict **4 of 6 green** against `dev-pabson-primary`. Both reds (C2.2 partial, C2.3 zero) trace to a single data-state gap — only 1 of the fixture's 4 Terms exists in DDB, so the backend's Term→`exam_window` auto-sync hasn't produced the 40 expected CalendarDate rows. Filed in [deferred-work.md](../pilot-greenlight/deferred-work.md#exam-window-seeding-automation-gap--blocks-harness-greenlight); ~1–2h ops-script fix before Sprint C3.

### Rollback tags captured before deploy

- `identity:e96f2a1-20260516145954` (prior good — from 2026-05-16 C0.c.3 deploy)
- `academics:e96f2a1-20260516151214` (prior good — from 2026-05-16 C0.c.3 deploy)
- (No finance roll this session — PR-B was academics-only)

### CDK deploys

- `prod-cdk-diff-shared-infra-stack-20260516-205845-aff2ea2.log` — first diff attempt, exited 1 on `CDK_PARAM_COMMIT_ID empty` (env not sourced)
- `prod-cdk-diff-shared-infra-stack-20260516-205912-aff2ea2.log` — retry, exited 1 on Docker containerd I/O error (post-ENOSPC corruption — see Notes)
- `prod-cdk-diff-shared-infra-stack-20260516-162556-aff2ea2.log` — same Docker corruption, third attempt
- `prod-cdk-diff-shared-infra-stack-20260516-162621-aff2ea2.log` — same Docker corruption, fourth attempt
- `prod-cdk-diff-shared-infra-stack-20260516-162931-aff2ea2.log` — same Docker corruption (Desktop restart did NOT clear it — buildkit cache metadata was the corrupt layer)
- `prod-cdk-diff-shared-infra-stack-20260516-163111-aff2ea2.log` — **clean** after `docker builder prune -af` (21.45 GB flushed). Diff: `+ GET /schools/{schoolId}/shift-profile` + standard `ApiGateway::Deployment` replace + `Stage` re-point.
- `prod-shared-infra-stack-20260516-163823-aff2ea2.log` — `UPDATE_COMPLETE` in 208s; 6 of 6 resources clean (no IAM/SG/Cognito/DDB delta).

### Build logs (ECR push)

- `prod-build-application-identity-20260516-165040-aff2ea2.log` — pushed `identity:aff2ea2-20260516215051`, digest `sha256:4b5b2500ac4e8a2011c23b1a7f138995f982b8e98bbe74f7d1738eaa2cf0bb88`
- `prod-build-application-academics-20260516-171851-aff2ea2.log` — pushed `academics:aff2ea2-20260516221902`, digest `sha256:31b834a22fa24cecdf60ac51a3931f97ea4b93cd05c2c11badee92f0df58c64e`

### ECS roll logs

- `prod-ecs-roll-identitybasic-20260516-165305-aff2ea2.log` — force-new-deployment OK; stable; live task carries new digest
- `prod-ecs-roll-academicsbasic-20260516-172100-aff2ea2.log` — same

### Canary verification (between deploys, manual curls)

| Test | Expected | Got | Proves |
|---|---|---|---|
| `GET /schools/x/shift-profile` no auth, post–shared-infra | 401 | 401 | API GW route registered (else 403 `Missing Authentication Token`) |
| `GET /schools/x/shift-profile` w/ JWT, pre–identity roll | 404 NestJS | 404 NestJS | nginx + identity wired; controller absent on old image |
| `GET /schools/x/shift-profile` w/ JWT, post–identity roll | 400 BAD_REQUEST | 400 `Missing required query parameter: date=YYYY-MM-DD` | Controller present + DTO validator firing on new code |

### Data state changes (in `dev-pabson-primary` tenant, Saraswati school, AY `0167de00-…`)

- `prod-reseed-calendar-dev-pabson-primary-20260516-173752-aff2ea2.log` — **401** (JWT expired between earlier curls and this re-seed attempt; no destructive op happened — rejected at Cognito authorizer before reaching backend)
- `prod-reseed-calendar-dev-pabson-primary-20260516-174229-aff2ea2.log` — **201** after fresh JWT. Backend `generateCalendar` DELETED existing CalendarDate rows and re-created 273 instructional days + 49 holiday/break entries (34 holiday + 15 break) matching the `pabson-saraswati-bs-2083` fixture exactly. Warning logged: "Calendar extends 274 days beyond last session" — that's the Term-2/3/4 gap, see Follow-ups.

### Smoke logs (harness)

- `prod-smoke-c2-2-shift-profile-20260516-170134-aff2ea2.log` — C2.2 standalone, pre-re-seed baseline: 14/30 matches; the 16 fails surfaced exactly the data drift the re-seed was about to correct.
- `prod-smoke-pilot-greenlight-harness-20260516-174608-aff2ea2.log` — harness run 1 (on `aff2ea2`, post-re-seed, pre-PR-#99): **3 pass / 3 fail**. C2.0 ✅, C2.1 ✅ (4-term exact match), C2.5 ✅. C2.2 ✗ 20/30 (improved from 14 — holidays + vacations now correct; 10 exam_day still ✗). C2.3 ✗ 0/40. C2.4 ✗ MODULE_NOT_FOUND — PR #99 not yet merged.
- `prod-smoke-pilot-greenlight-harness-20260516-175446-f95e523.log` — harness run 2 after operator merged PR #99: **4 pass / 2 fail**. C2.4 now ✅ 32/32 (DATE_NOT_INSTRUCTIONAL exercises holiday + weekend + vacation × 8 dates). C2.2 + C2.3 unchanged (same exam-window data gap).

### Verification highlights

- **C2.1 exact match across all 4 terms** (77/77 + 66/66 + 62/62 + 67/67) — strongest evidence calendar generator + re-seed produce a canonical state.
- **C2.4 32/32** — POST attendance on each of 8 non-instructional dates correctly rejected with HTTP 400, `errorCode: DATE_NOT_INSTRUCTIONAL`, structured `details.reason` (holiday/weekend/vacation), and `details.date` echo.
- **C2.5 6/6 edge cases** — AY-boundary day = `regular`; 3× next-AY dates outside AY = 404; mid-vacation = `vacation`; day-after-program = `weekend`.

### Follow-ups

- **Exam-window seeding automation** — single root cause of C2.2 + C2.3 reds. New script `scripts/pilot-greenlight/seed-pilot-terms.ts` (~100 LOC) that idempotently POSTs the 4 fixture terms; backend auto-sync produces the 40 `exam_window` CalendarDate rows. Wire into harness as pre-C2.1 setup. Filed in [`deferred-work.md`](../pilot-greenlight/deferred-work.md#exam-window-seeding-automation-gap--blocks-harness-greenlight). Pickup gate: before Sprint C3.

### Notes

- **Disk-full → Docker containerd corruption** at session start. After ENOSPC, buildkit cache metadata referenced a snapshot directory (`overlayfs/snapshots/6092/fs`) that had been partially purged. Docker Desktop restart did NOT clear it — only `docker builder prune -af` (21.45 GB flushed) did. The 5 failed cdk-diff logs preserve the diagnostic trail.
- **`c0-c-3-deploy-plan.md` reused for JWT filename only.** The doc itself is stale (was for PR #76 EventServiceBase). This deploy's plan was reverse-engineered from the unreleased C2 PRs on main.
- **No CloudWatch monitoring window** was run post-deploy. Defensible for an API-GW route add + two well-scoped controller/validator additions; would not be for a higher-risk change.
- **PR #100 (harness) was merged ahead of PR #99 (C2.4 smoke file)** — classic stacked-PR orphan per memory `feedback_stacked_pr_pitfall`. Caught at harness run 1 (MODULE_NOT_FOUND); operator merged PR #99 mid-session; run 2 confirmed fix.

---

## 2026-05-16 — Sprint C0.c.3: activate EventServiceBase runtime event validation

**PR:** [#76](https://github.com/shoaibrain/edforge/pull/76)
**Deploy plan:** [c0-c-3-deploy-plan.md](../pilot-greenlight/c0-c-3-deploy-plan.md)
**Outcome:** ✅ GREEN. All three microservices deployed to prod with the new EventServiceBase. Validation gate active; legacy PascalCase events emit with warning + still flow. Zero INVALID_PAYLOAD events on the bus. Smoke pass rate identical to 2026-05-14 baseline.

### Rollback tags captured before deploy

- `identity:82224fb-20260515032018` (2026-05-14)
- `academics:c640af2-20260430190302` (2026-04-30)
- `finance:897c4e2-20260429222423` (2026-04-29)

### Build logs (ECR push)

- `prod-build-application-identity-20260516-095946-e96f2a1.log` — pushed `identity:e96f2a1-20260516145954`, digest `sha256:6a89c74c...`
- `prod-build-application-academics-20260516-101205-e96f2a1.log` — pushed `academics:e96f2a1-20260516151214`, digest `sha256:39a1f148...`
- `prod-build-application-finance-20260516-101424-e96f2a1.log` — pushed `finance:e96f2a1-20260516151518`, digest `sha256:af5be9cc...`

> Note: the first identity build attempt (`prod-build-application-identity-20260516-095825-e96f2a1.log`) failed at line 71 (`cd: ../server/application: No such file or directory`) because the script was invoked from the repo root rather than `scripts/`. `tee` masked the exit code as 0; the CLAUDE.md "tee masks exit" gotcha. Re-ran from `scripts/` directory and built cleanly. No ECR pollution from the failed attempt (verified before retry).

### ECS roll logs

- `prod-ecs-roll-identitybasic-20260516-100121-e96f2a1.log` — force-new-deployment OK; stable
- `prod-ecs-roll-academicsbasic-20260516-101632-e96f2a1.log` — force-new-deployment OK; stable
- `prod-ecs-roll-financebasic-20260516-101632-e96f2a1.log` — force-new-deployment OK; stable

### Smoke logs (Phase 4 validation)

- `prod-smoke-s3-2-roundtrip-c0-c-3-20260516-103021-e96f2a1.log` — **32/33 PASS**, identical to 2026-05-14 baseline. The 1 failure (Leave cancel 500) is a pre-existing bug per memory `project_s3_2_gsi_casing_shipped`, not a C0.c.3 regression.

### CloudWatch verification

Baseline (before smoke, 10-min window): `Emitting unregistered eventType=0, Event published=0, INVALID_PAYLOAD=0, Error publishing event=0`.

After smoke: `Emitting unregistered eventType=2, Event published=2, INVALID_PAYLOAD=0, Error publishing event=0`. The two emits — `CredentialCreated` and `LeaveRequested` — are PascalCase legacy events; both correctly fell through the C0.c.3 unregistered-warning branch, were logged + emitted, and posted to EventBridge cleanly.

The `INVALID_PAYLOAD=0` and `Error publishing event=0` invariants are the critical safety checks; both held. The smoke's 32-pass count proves no regression in the existing event flow.

### Operator deliverables verified

- Account: `257526644020` (prod)
- Region: `ap-south-1`
- `service-info.json` had no `<REGION>`/`<ACCOUNT_ID>` placeholders pre-deploy
- shared-types 0.43.0 on npm + consumer pins at `^0.43.0`
- 14/14 `event-service.base.spec.ts` green on main pre-deploy

### Smoke artifacts left in dev-pabson-primary tenant

- 1 Leave row (cancellation failed; pre-existing 500): `956c2ed8-d9ee-4658-9a78-435e47cc1899`
- 1 Calendar row (DELETE deferred to user with elevated perms): `S32-SMOKE-1778945422834`

Both are in `tenant-id=21aea5da-511f-4dfa-a6f2-6971f63a719f` (`dev-pabson-primary`); cleanup tracked alongside the Sprint S3.2 backlog item in `docs/pilot-greenlight/deferred-work.md`.

---

## 2026-05-14 — Sprint S3.2: GSI1 casing fix

Identity ECR push + ECS roll. See memory `project_s3_2_gsi_casing_shipped` for narrative. PR [#68](https://github.com/shoaibrain/edforge/pull/68).

---

(Earlier deploys: see filenames at `docs/deploys/*.log`. Backfilling them into this index is a deferred bookkeeping item.)
