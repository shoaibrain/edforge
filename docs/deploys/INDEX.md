# Deploy Log Index

Per CLAUDE.md "Deploy log convention", every prod-touching action tee's its output here. This INDEX maps each named deploy event to the relevant log files, organized by sprint + date.

Newer entries at the top.

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
