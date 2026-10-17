# Blob Storage Platform - Epic Plan

> Status: planning
> Authored: 2026-06-29
> Target tier: BASIC V1 only
> Scope: backend `edforge` plus tenant-facing frontend `edforge-saas-frontend`

## 1. Mission

EdForge already stores a few private objects in S3, but the implementation is
feature-specific rather than platform-level. The goal of this epic is to turn
that proven slice into a reusable, tenant-safe blob storage foundation for V1
without over-building a full document-management product.

The first user-visible outcomes are:

- Operators and staff can upload their own profile photos.
- School admins can upload student photos.
- School admins can attach a small set of V1-relevant student and school
  documents.
- Existing branding uploads keep working, then move onto the shared blob
  contract without a behavior change.

The foundation must preserve the current EdForge architecture:

- BASIC tier only: shared infrastructure, tenant isolation by key prefix and
  ABAC, no per-tenant buckets.
- Domain ownership stays intact: identity owns users and school branding;
  academics owns students; finance owns generated finance outputs.
- Frontend upload UX is reusable, but source-of-truth writes still go through
  the owning service.

## 2. Evidence From Current Code

### Current S3-backed branding path

The live branding implementation is the best precedent. `BrandingController`
exposes three endpoints under `/schools`: read branding, mint a presigned PUT
URL, and PATCH the branding row. The file comment also calls out the required
three-way route registration against API Gateway (`tenant-api-prod.json`)
because a missing OpenAPI route produces a `403 SigV4` instead of reaching
NestJS ([branding.controller.ts:1-15](../../server/application/microservices/identity/src/branding/branding.controller.ts#L1)).

`BrandingService` constructs S3 keys server-side from the JWT tenant and
school id, validates MIME and size, presigns a 5-minute PUT, stores only S3
keys on `School.branding`, and returns short-lived GET URLs for display
([branding.service.ts:4-16](../../server/application/microservices/identity/src/branding/branding.service.ts#L4),
[branding.service.ts:79-113](../../server/application/microservices/identity/src/branding/branding.service.ts#L79),
[branding.service.ts:127-182](../../server/application/microservices/identity/src/branding/branding.service.ts#L127),
[branding.service.ts:229-304](../../server/application/microservices/identity/src/branding/branding.service.ts#L229)).

`S3PresignerService` uses TVM-issued tenant-scoped credentials, reads bucket
names from ECS env vars, and includes the important AWS SDK v3 checksum
setting that fixed browser PUT failures (`requestChecksumCalculation:
'WHEN_REQUIRED'`) ([s3-presigner.service.ts:1-20](../../server/application/microservices/identity/src/common/services/s3-presigner.service.ts#L1),
[s3-presigner.service.ts:63-121](../../server/application/microservices/identity/src/common/services/s3-presigner.service.ts#L63)).

The BASIC tenant template grants the identity ABAC role `s3:PutObject` and
`s3:GetObject` only under the caller's tenant prefix in the deterministic
`edforge-pdf-assets-{account}-{region}` bucket, then injects
`PDF_ASSETS_BUCKET` into the identity container
([tenant-template-stack.ts:651-683](../../server/lib/tenant-template/tenant-template-stack.ts#L651)).

The bucket itself is private, encrypted, versioned, retained, and configured
for browser direct upload CORS. It is named deterministically and not exported
cross-stack, avoiding CloudFormation export replacement traps
([analytics-stack.ts:1073-1097](../../server/lib/analytics/analytics-stack.ts#L1073),
[analytics-stack.ts:1131-1196](../../server/lib/analytics/analytics-stack.ts#L1131)).

### Existing weaknesses to fix

The branding path works, but it is not a generalized blob layer:

- Types and constants are duplicated in the frontend package instead of
  exported as shared blob contracts.
- The upload flow has no upload-session metadata row, no completion endpoint,
  no server-side `HeadObject` verification after browser PUT, and no generic
  orphan cleanup story.
- The S3 presigner is named and configured around PDF assets, not tenant blob
  assets.
- Authorization is embedded in branding-specific controller/service logic.
- There is no shared frontend file-field or upload mutation for non-branding
  surfaces.

Profile avatars are partially stubbed but not implemented end to end. The
frontend shell calls `POST /users/:id/avatar/upload-url` and
`DELETE /users/:id/avatar` ([users.service.ts:499-545](../../edforge-saas-frontend/apps/shell/src/services/users.service.ts#L499)),
while the identity backend only persists an arbitrary `avatarUrl` through
`PATCH /users/:id`; no matching avatar upload routes exist in
`UsersController` ([users.controller.ts:185-317](../../server/application/microservices/identity/src/users/users.controller.ts#L185)).

Students have an unused `photoUrl` field on the academics entity, but the
shared student create/update/response schemas do not surface a student photo
contract, so responses strip it and the frontend falls back to generated
avatars ([student.entity.ts:80-84](../../server/application/microservices/academics/src/common/entities/student.entity.ts#L80),
[student.schema.ts:240-345](../../packages/shared-types/src/schemas/academics/student.schema.ts#L240)).

### Existing S3 patterns outside branding

EdForge also has private generated-output buckets:

- reporting staging/archive buckets for IEMIS CSVs;
- the `edforge-pdfs-{account}-{region}` bucket for short-lived PDF job
  outputs;
- analytics CSV export objects with short-lived signed GET URLs.

Those are generated-output patterns, not user-managed blob storage. The new
platform should share lessons from them but should not mix user-uploaded
assets into generated-output lifecycle lanes.

## 3. Requirements

### Functional

- Direct browser-to-S3 upload through presigned PUT URLs.
- Short-lived signed GET URLs for private display/download.
- Upload policy by purpose: avatar, student photo, branding logo, branding
  signature, student document, and school document. Staff credential documents
  are a V1.5 opt-in once the V1 student/school document flow is proven.
- Owner-aware authorization:
  - self or TenantAdmin for user avatar;
  - `students:edit` for student photo/document;
  - existing `branding:configure` for branding assets;
  - school settings/admin permission for school documents;
  - future finance/document policies can opt in without changing bucket shape.
- Persist object references as S3 keys or blob asset ids, not permanent public
  URLs.
- Completion flow verifies that the uploaded S3 object exists and matches the
  upload session before attaching it to a domain entity.
- Delete/remove means "detach from the domain record" first; physical object
  deletion is explicit, delayed, and policy-controlled.
- Bulk signed-url support for list pages so the UI does not mint one URL per
  component with uncontrolled fan-out.

### Non-functional

- Tenant isolation is enforced by IAM ABAC at the S3 key prefix and by service
  authorization at the owner/school boundary.
- BASIC tier remains one shared bucket per environment, not per tenant.
- Costs stay bounded through size caps, prefix/tag lifecycle rules for pending
  uploads, and no eager server-side image processing unless the sprint needs it.
- The API must survive partial S3 failures by degrading display URLs where
  appropriate rather than turning entire profile/list reads into 500s.
- Route, module-wiring, shared-types pin, and CDK diff requirements are built
  into each ticket's validation.

## 4. Non-goals For V1

- Public CDN or public-read objects.
- Per-tenant buckets, per-tenant KMS keys, or ADVANCED/PREMIUM tier storage
  topology.
- A full document-management system with version history UI, comments,
  folder ACLs, OCR, DLP, retention holds, or e-signatures.
- Antivirus scanning for all uploads. V1 keeps the allowed types narrow
  (JPEG, PNG, WebP, PDF where explicitly needed), validates magic bytes after
  upload, keeps objects private, and records the deferred AV-scan decision.
- Migrating historical branding objects out of `edforge-pdf-assets-*` before
  the new avatar/student-photo flows prove the shared layer.
- Supporting arbitrary external avatar URLs as the long-term model.
- Staff credential document uploads. Existing credential records may keep their
  URL fields for now; moving them to blob storage is a V1.5 follow-up after
  student and school documents establish the reusable path.

## 5. Architecture

### Storage topology

Create a new private BASIC-tier bucket:

```
edforge-blob-assets-{account}-{region}
```

This bucket is for user-managed tenant assets. Existing buckets keep their
current responsibilities:

- `edforge-pdf-assets-*`: existing branding/PDF-rendering assets until the
  branding migration sprint.
- `edforge-pdfs-*`: generated PDF outputs and short-lived job artifacts.
- `edforge-reports-staging-*` / `edforge-reports-archive-*`: reporting CSVs.

The new bucket should live in `shared-infra-stack`, not `analytics-stack`.
Consumers still avoid CloudFormation exports by reconstructing the deterministic
name and receiving it as `BLOB_ASSETS_BUCKET` in ECS task env.

Bucket settings:

- `RemovalPolicy.RETAIN`
- `BlockPublicAccess.BLOCK_ALL`
- `enforceSSL: true`
- S3-managed encryption for V1
- no bucket-level public access
- lifecycle rules:
  - `status=pending` tag expires after 1 day;
  - `status=orphaned` tag expires after 30 days;
  - `status=deleted` tag expires after 90 days;
  - attached objects do not expire automatically in V1.

Bucket versioning should be off for the new blob bucket. V1 uses immutable
UUID keys and a metadata pointer to the current object, which gives rollback
and audit without paying for bucket-level version history for every avatar and
student document. Branding can stay in the versioned PDF-assets bucket until
its own migration.

### Key layout

Every key starts with the tenant id so IAM can enforce the coarse boundary:

```
tenants/{tenantId}/users/{userId}/avatar/{assetId}/original.{ext}
tenants/{tenantId}/schools/{schoolId}/students/{studentId}/photo/{assetId}/original.{ext}
tenants/{tenantId}/schools/{schoolId}/students/{studentId}/documents/{documentType}/{assetId}/original.{ext}
tenants/{tenantId}/schools/{schoolId}/documents/{documentType}/{assetId}/original.{ext}
tenants/{tenantId}/schools/{schoolId}/branding/{logo|signature}/{assetId}/original.{ext}
```

Do not put untrusted filenames in keys. Store the original filename only in
metadata after truncation and sanitization.

Raw tenant-prefixed keys are internal. New avatar, student-photo, and document
response DTOs return signed display/download URLs plus stable metadata fields,
not raw S3 keys. Branding is the exception for backwards compatibility because
existing `School.branding.*S3Key` fields are already part of the live contract.

### Backend shared module

Add `server/application/libs/blob-storage/` as a reusable Nest library. It
should not own domain routes. It owns:

- policy registry and Zod-compatible constants;
- key builder;
- MIME, extension, size, and magic-byte validation;
- TVM-backed S3 client creation with the same checksum setting used by the
  current branding presigner;
- presign PUT and GET helpers;
- upload session helper types;
- `HeadObject` and small-range `GetObject` inspection;
- CloudWatch metric/log helpers.

Each service that accepts uploads hosts its own controller and stores upload
sessions in its own DDB table. That keeps domain authorization local:

- identity owns user-avatar and branding upload endpoints;
- academics owns student-photo and student-document upload endpoints;
- identity owns school-document upload endpoints because schools live in the
  identity service;
- future finance uploads/exports can opt in when needed.

This avoids turning identity into a cross-domain blob broker that would need
to understand student, staff, finance, and document-level permissions.

### Upload session lifecycle

V1 should add an explicit upload session row instead of immediately trusting a
client-supplied key.

```
requested -> presigned -> uploaded -> attached
                      \-> expired
                      \-> abandoned
attached -> detached -> deleted-or-orphaned
```

Minimum row fields:

```
{
  uploadId,
  tenantId,
  schoolId?,
  ownerService,
  ownerType,
  ownerId,
  purpose,
  bucket,
  objectKey,
  expectedContentType,
  expectedContentLength,
  originalFilename?,
  status,
  expiresAt,
  createdBy,
  createdAt,
  completedAt?,
  attachedAt?,
  detachedAt?,
  etag?,
  byteSize?,
  contentType?,
  urlExpiresAt?
}
```

Flow:

1. Client asks owning service for an upload URL.
2. Service validates authorization and policy, creates a pending upload row,
   and returns `{ uploadId, uploadUrl, objectKey, expiresInSeconds,
   requiredHeaders }`. Required headers include the signed content type and
   the initial S3 object tag, `status=pending`, so lifecycle cleanup can act
   even if the client never calls the completion endpoint.
3. Client uploads directly to S3 using plain `fetch`, not the app axios
   client.
4. Client calls a completion endpoint with `uploadId`.
5. Service does `HeadObject`, validates content type and size, optionally
   reads the first bytes for magic-byte validation, marks the upload
   `uploaded`, attaches it to the domain entity, tags the S3 object
   `status=attached`, and returns the updated DTO plus signed display URL.

### Frontend shared package

Add a stateless workspace package, `@edforge/blob-services`, following the
same pattern as `@edforge/identity-services` and `@edforge/finance-services`.

Responsibilities:

- `uploadFileToPresignedUrl(uploadUrl, file, requiredHeaders)`
- `runBlobUpload({ init, complete, file })`
- shared file validation helpers from `@aibrains/shared-types`
- React Query mutation wrapper
- a reusable file field component can live in `packages/forms` or
  `packages/ui`, but the network logic should stay in `@edforge/blob-services`.

The package is not a module-federation singleton. It is stateless; React Query
cache sharing already happens through the existing singleton setup.

### API shape

Prefer domain-specific routes for V1:

```
POST   /users/{userId}/avatar/upload-url
POST   /users/{userId}/avatar/complete
DELETE /users/{userId}/avatar

POST   /academics/students/{studentId}/photo/upload-url
POST   /academics/students/{studentId}/photo/complete
DELETE /academics/students/{studentId}/photo

POST   /academics/students/{studentId}/documents/upload-url
POST   /academics/students/{studentId}/documents/complete
GET    /academics/students/{studentId}/documents
DELETE /academics/students/{studentId}/documents/{documentId}

POST   /schools/{schoolId}/documents/upload-url
POST   /schools/{schoolId}/documents/complete
GET    /schools/{schoolId}/documents
DELETE /schools/{schoolId}/documents/{documentId}
```

Shared response types still live in `@aibrains/shared-types`, so route
ownership does not mean contract drift.

## 6. Cross-Cutting Acceptance Gates

Every implementation PR in this epic must include:

- targeted unit tests for the touched service/package;
- route drift validation when adding or changing an HTTP endpoint;
- module-wiring spec update when a Nest module consumes a new shared provider;
- `npm run lint` or the narrower repo-approved lint command for touched code;
- shared-types build when `packages/shared-types` changes;
- consumer pin/lockfile updates when `@aibrains/shared-types` minor version
  changes;
- `npm run typecheck:cdk` and `cdk diff` when infra/IAM/env vars change;
- a visual smoke for non-trivial frontend upload flows.

For frontend route work, trace from URL -> router -> page -> component before
editing. The file that looks like "the avatar page" is not sufficient evidence.

## 7. Sprint Plan

### Sprint 0 - Storage Foundation And Contracts

**Goal:** Ship the reusable storage primitives and infra without changing any
operator workflow.

**Demo:** From a local or test harness, generate a policy-valid key, create a
mock upload session, presign a PUT with the checksum-safe S3 client, complete
against mocked S3 metadata, and show the generated `cdk diff` for the new
bucket and service env/IAM wiring.

| Ticket | Atomic Work | Acceptance / Validation |
|---|---|---|
| BLOB-00-01 | Add shared blob contract schemas to `packages/shared-types`: `BlobPurpose`, `BlobOwner`, `BlobUploadInitRequest`, `BlobUploadInitResponse`, `BlobUploadCompleteRequest`, `BlobAssetRef`, `BlobDisplayUrl`, and policy constants for MIME and max bytes. | Zod tests cover valid/invalid purposes, MIME allowlists, max-byte enforcement, and forward-compatible optional fields. `cd packages/shared-types && npm run build`. |
| BLOB-00-02 | Add `BlobAssetsBucket` to `shared-infra-stack` with private access, SSL enforcement, S3-managed encryption, CORS from `CDK_PARAM_CORS_ALLOWED_ORIGINS`, lifecycle rules for pending/orphaned/deleted object tags, and no CfnOutput export. Reuse the existing non-empty CORS-origin guard pattern and ensure browser PUTs may send the signed `x-amz-tagging` header. | CDK unit test snapshots bucket settings, CORS, lifecycle, non-empty-origin failure, and lack of public access. `cd server && npm run typecheck:cdk`; `cdk diff shared-infra-stack` shows only the new bucket. |
| BLOB-00-03 | Inject deterministic `BLOB_ASSETS_BUCKET` env var into identity and academics ECS containers, and add it to `server/lib/interfaces/container-info.ts`, but do not grant write IAM yet. | CDK test asserts env var on identity and academics containers only. Typecheck proves `ContainerInfo.environment.BLOB_ASSETS_BUCKET` is valid. `cdk diff tenant-template-stack-basic` shows task-definition env changes and no S3 write grant yet. |
| BLOB-00-04 | Create `server/application/libs/blob-storage` with `BlobPolicyRegistry`, `BlobKeyBuilder`, and validation helpers. Register the library in `server/application/nest-cli.json` and add `@app/blob-storage` paths in `server/application/tsconfig.json` in the same PR. | Unit tests prove key construction never includes original filenames, always starts with `tenants/{tenantId}/`, rejects path traversal-like input, and maps content type to extension deterministically. `cd server/application && npx nest build identity` resolves the new library import. |
| BLOB-00-05 | Add `TenantScopedS3BlobClient` in the shared library using TVM credentials and `requestChecksumCalculation: 'WHEN_REQUIRED'`. Presigned PUTs must sign `ContentType`, expected length metadata, and initial object tagging (`status=pending`, `purpose=...`). | Unit tests mirror existing `S3PresignerService` checksum regression and assert `PutObjectCommand` signs `ContentType`, expected-length metadata, and `Tagging`. |
| BLOB-00-06 | Add upload-session entity helpers for DDB rows: key builders, status enum, TTL calculation, and object-tag mapping. | Pure unit tests cover status transitions and TTL/tag mapping. No service routes yet. |
| BLOB-00-07 | Add `@edforge/blob-services` frontend package with plain `fetch` S3 PUT helper and framework-neutral `runBlobUpload` function. | Vitest proves it does not use app axios, sends only signed-upload headers, surfaces non-2xx S3 status, and returns the complete endpoint result. |
| BLOB-00-08 | Add an internal docs/runbook page for local blob testing and deployment gates. | New doc lists local commands, required env vars, CORS gotchas, route registration rules, and rollback steps. Markdown-only validation via review. |
| BLOB-00-09 | Add a minimal cleanup dry-run script for pending upload sessions and `status=pending` objects. It must report what would be expired/deleted without mutating S3 or DDB. | Unit tests cover dry-run filtering by tenant, age, status tag, and no signed URL output. This runs before the first avatar sprint so abandoned browser uploads have an operational escape hatch from day one. |

### Sprint 1 - User Avatar Uploads

**Goal:** Replace the existing frontend-only avatar stubs with a real identity
service upload flow.

**Demo:** In `/settings/account`, upload a profile photo, refresh, see the
photo persist, remove it, and see DiceBear/initials fallback return.

| Ticket | Atomic Work | Acceptance / Validation |
|---|---|---|
| BLOB-01-01 | Add identity `UserAvatarUploadSession` row helpers using the shared upload-session library. | Unit tests cover PK/SK, TTL, owner fields, and `self` vs admin owner data. |
| BLOB-01-02 | Add S3 IAM grant for identity ABAC role on `edforge-blob-assets-*` under `tenants/${aws:PrincipalTag/tenant}/*`; inject `BLOB_ASSETS_BUCKET` if not already present. | CDK test asserts `s3:PutObject`, `s3:GetObject`, `s3:PutObjectTagging`, `s3:GetObjectTagging`, and `s3:HeadObject`-equivalent read behavior for identity only. `cdk diff tenant-template-stack-basic` must show the new S3 statement. |
| BLOB-01-03 | Implement `POST /users/:id/avatar/upload-url` in identity. Validate self-or-TenantAdmin, MIME/size policy, create pending session, return presigned PUT with `x-amz-tagging=status=pending&purpose=avatar`. | Controller/service specs cover self success, TenantAdmin success, cross-user 403, bad MIME 415, oversize 413, missing user 404, and required signed tagging. |
| BLOB-01-04 | Implement `POST /users/:id/avatar/complete`. HEAD the object, validate content length/type, magic-byte inspect images, update the internal user avatar key, tag object attached, orphan-tag any previous avatar object, and return `UserResponseDto` with signed `avatarUrl`. If the Cognito user has no Dynamo extension row, create the minimal extension row needed for profile fields instead of failing the upload. | Specs cover successful attach, no-object completion, wrong content type, wrong length, expired session, stale uploadId, replacing an existing avatar, and Cognito-only users with no existing DDB row. |
| BLOB-01-05 | Implement `DELETE /users/:id/avatar` as detach. Clear the internal avatar key, tag previous object `status=orphaned`, and return updated user. | Specs cover self/admin authorization, idempotent delete when no avatar exists, old object key is never logged as a URL, and no raw S3 key is returned in the DTO. |
| BLOB-01-06 | Update shared user schema and identity mappers so `avatarS3Key` is entity-internal only and response DTOs keep `avatarUrl?` as the signed display URL. Prevent clients from PATCHing arbitrary `avatarUrl` after the upload route exists. | Shared-types tests cover backwards-compatible response parsing. Identity tests cover `/users/:id`, `/users/me`, user list/profile mapper paths, and prove self-edit no longer accepts arbitrary external avatar URL unless an explicit legacy flag is kept. |
| BLOB-01-07 | Register avatar routes in `server/lib/tenant-api-prod.json`; nginx remains unchanged because `/users` prefix exists. | `npm run lint:routes` passes. Missing-route regression test if route-drift harness supports it. |
| BLOB-01-08 | Wire `@edforge/blob-services` into shell account settings. Add image resize/compression before upload for avatars: max 512 px longest side, JPEG/WebP output target under policy cap, strip EXIF by canvas re-encode. | Vitest covers upload success, MIME/size client reject, complete failure, delete, and fallback. Visual smoke: `/settings/account` upload/refresh/delete. |
| BLOB-01-09 | Add observability for avatar upload attempts, completions, failures, and deletes. | Unit tests assert structured log fields exclude presigned URLs. CloudWatch metric names documented in runbook. |

### Sprint 2 - Student Photos

**Goal:** Let school admins attach private student photos and show them on
student detail/list surfaces with generated-avatar fallback.

**Demo:** In the academics student profile, upload a student photo, refresh,
see it in profile header and list cells, remove it, and see fallback return.

| Ticket | Atomic Work | Acceptance / Validation |
|---|---|---|
| BLOB-02-01 | Add internal `photoS3Key?` support to the academics entity/mapper layer and signed `photoUrl?` to shared student response DTOs. Do not expose raw `photoS3Key` in responses. | Shared-types tests cover response shape. Academics mapper tests prove existing students without photos still serialize and raw keys are not emitted. |
| BLOB-02-02 | Add S3 IAM grant for academics ABAC role on `edforge-blob-assets-*` tenant prefix. | CDK test asserts academics grant only, including tagging permissions. `cdk diff tenant-template-stack-basic` shows the new S3 statement; an empty diff is a blocker. |
| BLOB-02-03 | Add academics upload-session helpers for student photos. | Unit tests cover key shape `tenants/{tid}/schools/{sid}/students/{studentId}/photo/...` and school/owner metadata. |
| BLOB-02-04 | Implement `POST /academics/students/:studentId/photo/upload-url`. Validate `students:edit`, load student, derive schoolId from the entity, then presign. | Controller/service specs cover success, student not found, wrong-school scope, bad MIME, oversize, no client-supplied school override, and permission denial. |
| BLOB-02-05 | Implement `POST /academics/students/:studentId/photo/complete` and `DELETE /academics/students/:studentId/photo`. | Specs cover HEAD validation, magic-byte mismatch, successful attach, idempotent detach, replacing an existing photo, old object orphan tagging, and no raw S3 key in the response. |
| BLOB-02-06 | Add bounded signed-URL batch helper for student list/profile photo projection before any list UI consumes photos. | Backend tests cover cap, tenant prefix validation, partial presign failure, no cross-tenant keys, and one bounded batch per page rather than per-row unbounded fan-out. |
| BLOB-02-07 | Add signed-photo URL projection to `getStudent`, student profile, and first page of `listStudents` using the bounded helper. | Specs prove presign failures omit `photoUrl` but keep the student response, and list projection caps fan-out. |
| BLOB-02-08 | Register routes in `tenant-api-prod.json`; nginx unchanged because `/academics` prefix exists. | `npm run lint:routes` passes. |
| BLOB-02-09 | Add frontend student-photo upload UI to the rendered student profile route after route-to-component tracing. | Vitest/RTL covers success, remove, permissions-hidden state, and fallback. Visual smoke: student profile upload/refresh/remove. |
| BLOB-02-10 | Update list/profile avatar components to prefer `photoUrl`, then generated/local DiceBear/initials. | Component tests prove no layout shift, fallback on failed image load, and no extra per-row presign requests. |

### Sprint 3 - V1 Student And School Documents

**Goal:** Provide a narrow, useful document attachment surface without building
a full DMS.

**Demo:** Attach a PDF admission document to a student, attach a school
registration/PAN document to a school, list both through their owning screens,
download each through a signed URL, and detach both.

| Ticket | Atomic Work | Acceptance / Validation |
|---|---|---|
| BLOB-03-01 | Define V1 document policies in shared-types: `student_document` and `school_document`; allow PDF/JPEG/PNG/WebP only, max 10 MB for PDFs and 5 MB for images. Add explicit V1.5 placeholders for `staff_credential_document` without enabling it. | Shared-types tests cover policy constants and reject Office/executable/unknown types. Tests prove staff credential documents are not accepted by V1 upload endpoints. |
| BLOB-03-02 | Add academics `StudentDocument` metadata entity under the student owner, with document type, display name, object key, size, content type, and audit fields. | Entity tests cover key builders, display-name truncation, and no raw presigned URL persistence. |
| BLOB-03-03 | Implement student document upload-url and complete endpoints. | Service specs cover `students:edit` authorization, pending session creation, completion validation, metadata row creation, and duplicate completion idempotency. |
| BLOB-03-04 | Implement list/download-url/delete endpoints for student documents. | Specs cover school scope, signed URL TTL, deleted document hidden from list, and physical object tagged orphaned not immediately deleted. |
| BLOB-03-05 | Register student-document routes and update route-drift tests. | `npm run lint:routes` passes. |
| BLOB-03-06 | Add identity `SchoolDocument` metadata entity under the school owner, with document type, display name, object key, size, content type, and audit fields. | Entity tests cover key builders, display-name truncation, tenant/school scoping, and no raw presigned URL persistence. |
| BLOB-03-07 | Implement school document upload-url, complete, list, download-url, and delete endpoints under `/schools/:schoolId/documents`. | Service specs cover school settings/admin authorization, pending session creation, completion validation, metadata row creation, signed URL TTL, deleted document hidden from list, and physical object tagged orphaned. |
| BLOB-03-08 | Register school-document routes and update route-drift tests. | `npm run lint:routes` passes. nginx unchanged because `/schools` prefix exists. |
| BLOB-03-09 | Add frontend student document panel on the student detail route. | RTL tests cover upload, list, download click target, delete confirmation, empty state, and error states. Visual smoke on dev shell. |
| BLOB-03-10 | Add frontend school document panel on the rendered school settings/detail route after route-to-component tracing. | RTL tests cover upload, list, download click target, delete confirmation, permission-hidden state, empty state, and error states. Visual smoke on dev shell. |
| BLOB-03-11 | Add audit events for document attach/download-url/delete across student and school documents. | Unit tests prove audit payload stores `objectKeyHash`, not signed URL, and includes owner type/id without PII-heavy filenames when not needed. |
| BLOB-03-12 | Document the V1 file-type risk decision and V1.5 scanner trigger. | Runbook states AV scanning is deferred while only private PDF/image uploads are allowed; scanner becomes required before Office docs, parent uploads, or public sharing. |

### Sprint 4 - Branding On The Shared Blob Layer

**Goal:** Keep existing branding behavior unchanged while removing bespoke
upload logic and duplicated frontend constants.

**Demo:** `/settings/branding` logo/signature upload still works; invoice and
receipt PDFs render the uploaded logo/signature; existing branding rows remain
valid.

| Ticket | Atomic Work | Acceptance / Validation |
|---|---|---|
| BLOB-04-01 | Promote branding upload policy constants and response types from local mirrors into `@aibrains/shared-types`. | Shared-types build and tests pass. Consumer package pins updated in backend/frontend PRs that consume the new exports. |
| BLOB-04-02 | Refactor identity branding upload-url path to use `BlobPolicyRegistry`, `BlobKeyBuilder`, and shared S3 client while still targeting existing `PDF_ASSETS_BUCKET`. | Existing `branding.service.spec.ts` stays green; new tests prove key shape is byte-compatible with old branding keys where required. |
| BLOB-04-03 | Add optional upload-session completion to branding without breaking current clients. First path supports old presign->PUT->PATCH, new path supports presign->PUT->complete->PATCH. | Tests prove old frontend flow still works, new flow tags completed uploads, and replacing an existing logo/signature tags the old object `status=orphaned` only after the new object is attached. |
| BLOB-04-04 | Refactor `@edforge/identity-services` branding upload hook to call `@edforge/blob-services` and import shared constants. | Existing branding frontend tests pass; no duplicated MIME/size maps remain in identity-services. |
| BLOB-04-05 | Add compatibility tests for invoice/receipt PDF branding fetch after refactor. | Finance renderer/service tests prove logo/signature URLs still flow through `IdentityClient.getBranding`. |
| BLOB-04-06 | Decide whether new branding uploads stay in `edforge-pdf-assets-*` for V1 or move to `edforge-blob-assets-*`. | Decision doc with migration/no-migration tradeoff. If moving, include read fallback for old keys and a non-destructive migration script plan. |

### Sprint 5 - Reusable Upload UX And Bulk URL Projection

**Goal:** Make blob upload and display a consistent frontend pattern across
Shell and Academics.

**Demo:** Account avatar, student photo, student documents, and branding all
use one shared upload control pattern and consistent error copy.

| Ticket | Atomic Work | Acceptance / Validation |
|---|---|---|
| BLOB-05-01 | Create reusable `BlobFileField` or `FileUploadField` in the appropriate frontend package, using icons, progress, replace/remove states, and policy-driven accept text. | Component tests cover idle/uploading/success/error/remove states and text fitting at mobile widths. |
| BLOB-05-02 | Replace account avatar upload UI with the shared field. | Existing account tests updated; visual smoke unchanged. |
| BLOB-05-03 | Replace student photo upload UI with the shared field. | Existing student profile tests updated; visual smoke unchanged. |
| BLOB-05-04 | Replace branding file fields with the shared field while preserving branding-specific labels and previews. | Branding tests remain green; no regression in no-letterhead V1 behavior. |
| BLOB-05-05 | Standardize upload error mapping in `@edforge/blob-services` and i18n keys. | Unit tests cover MIME, size, expired URL, S3 CORS/preflight-like failure, completion validation failure, and generic network failure. |

### Sprint 6 - Operations, Cleanup, And Cost Controls

**Goal:** Finish the platform layer with cleanup jobs, metrics, and operator
docs before broadening file types or surfaces.

**Demo:** Run an orphan-cleanup dry run, inspect metrics for upload sessions
and object bytes, and verify runbook rollback steps.

| Ticket | Atomic Work | Acceptance / Validation |
|---|---|---|
| BLOB-06-01 | Add scheduled cleanup Lambda or operator script for expired pending sessions and orphaned/deleted object tags. | Unit tests cover dry-run and apply modes. Integration validation against a seeded dev prefix shows expected object count changes. |
| BLOB-06-02 | Add CloudWatch metrics: upload requested/completed/failed, bytes uploaded by purpose, completion latency, presign failure count, cleanup deleted bytes. | Tests assert metric names/dimensions. Dashboard or runbook includes queries. |
| BLOB-06-03 | Add tenant/blob storage inventory script for BASIC support. | Script lists objects grouped by tenant/school/purpose without printing signed URLs. Dry-run tested against mocked S3 listing. |
| BLOB-06-04 | Add smoke tests for avatar and student-photo upload flows. | Smoke scripts can run against dev tenant with local fixture images and clean up after themselves. |
| BLOB-06-05 | Add deployment runbook section: bucket CORS, `cdk diff`, ECS env vars, S3 IAM grants, rollback, and common failures. | Reviewed docs only. Includes the AWS SDK checksum trap and S3 CORS diagnosis. |
| BLOB-06-06 | Add V1.5 backlog tickets for scanner, CDN/caching, image variants, and advanced/premium storage topology. | Backlog entries link to this epic and include explicit trigger conditions. |

## 8. Recommended PR Sequencing

Keep backend and frontend split small but not artificially fragmented:

1. Backend foundation PR: shared-types, CDK bucket/env, backend blob library.
2. Frontend foundation PR: `@edforge/blob-services`.
3. Backend identity avatar PR.
4. Frontend account avatar PR.
5. Backend academics student photo PR.
6. Frontend student photo PR.
7. Backend student documents PR.
8. Frontend student documents PR.
9. Backend school documents PR.
10. Frontend school documents PR.
11. Branding refactor backend PR.
12. Branding refactor frontend PR.
13. Operations/cleanup PR.

Each backend PR that adds routes must include `tenant-api-prod.json`. Each PR
that changes shared-types must include consumer pin/lockfile changes only when
that PR consumes the new version outside the workspace.

## 9. Deployment Notes

Infra deploy order for the first backend foundation release:

1. Local gates: shared-types build, backend affected tests, `npm run lint`,
   `npm run typecheck:cdk`.
2. `cdk diff shared-infra-stack` for the new bucket.
3. `cdk diff tenant-template-stack-basic` for env/IAM changes.
4. Deploy shared infra via the repo wrapper, not direct `npx cdk deploy`.
5. Deploy tenant template via the repo wrapper.
6. Build and roll identity/academics ECS only when service code starts using
   the env var/grants.
7. Run smoke tests in non-prod before prod.

Do not deploy straight to prod. This follows the standard EdForge deploy
ladder.

## 10. Open Decisions To Resolve During Sprint 0

| Decision | Default Recommendation | Why |
|---|---|---|
| Does `edforge-blob-assets-*` live in `shared-infra-stack` or `analytics-stack`? | `shared-infra-stack` | This is generic platform storage, not analytics/PDF-specific storage. Deterministic naming avoids exports either way. |
| Store avatar current pointer as `avatarS3Key`, `avatarBlobId`, or both? | Store `avatarS3Key` now, add `blobId` in upload-session metadata. | Lowest migration cost from existing `avatarUrl`; still lets future registry use blob ids. |
| Should branding move buckets in V1? | No immediate migration. New branding uploads can continue in `edforge-pdf-assets-*` until refactor proves shared logic. | Historical PDFs and versioned branding semantics are already tied to the existing bucket. |
| Do we generate server thumbnails in V1? | No. Resize avatar images client-side before upload; keep original object private. | Avoids Lambda/image-processing cost and complexity. Revisit when list-photo traffic justifies variants. |
| Do we need AV scanning before student documents? | Not for narrow private PDF/image V1. Add scanner before Office docs, parent uploads, or public sharing. | Balanced risk/cost: private school-admin uploads only, strict allowlist, size caps, magic-byte validation. |

## 11. Definition Of Done For The Epic

- User avatar upload/remove works end to end and survives refresh.
- Student photo upload/remove works end to end and appears in at least the
  student profile and primary list surface.
- Student document attach/list/download/delete works for PDF/image V1 types.
- School document attach/list/download/delete works for PDF/image V1 types.
- Branding uploads still work and use shared blob contracts/helpers.
- No presigned URL is persisted in DDB or audit rows.
- Every uploaded object key is tenant-prefixed and policy-generated server-side.
- Pending/orphan cleanup exists and is documented.
- Non-prod smoke evidence exists for account avatar, student photo, student
  document, school document, and branding regression.

## Appendix A. Reviewer Pass

After the first draft, a subagent was asked to review the plan as a staff
engineer:

```text
Read docs/blob-storage/epic-plan.md and inspect the repo only as needed. Do
not edit files. Focus on current-state evidence gaps, unsafe architecture
assumptions for EdForge's stack/service shape, missing atomic tickets or
tests/validation, sprint sequencing problems, and places where the plan is
overbuilt or underbuilt for V1 pilot needs. Return prioritized findings with
specific suggested improvements.
```

Material reviewer findings and applied changes:

- Pending-upload cleanup was not guaranteed because lifecycle tags must be
  written at PUT time. The plan now requires signed `x-amz-tagging` on the
  presigned PUT and adds a Sprint 0 cleanup dry-run before user-facing upload
  flows.
- Document scope was inconsistent. The plan now implements both student and
  school documents in V1, while staff credential documents are explicitly
  deferred to V1.5.
- Raw key exposure was under-specified. The plan now treats avatar/photo keys
  as entity-internal and returns signed `avatarUrl`/`photoUrl` only; branding
  remains the compatibility exception.
- Student permissions used the wrong verb. The plan now uses the live
  `students:edit` permission vocabulary.
- Bulk signed URL projection was sequenced too late. The bounded helper moved
  into Sprint 2 before student list thumbnails.
- CDK/type validation was too soft. The plan now calls out
  `ContainerInfo.environment.BLOB_ASSETS_BUCKET`, CORS guard tests, tagging
  permissions, and replace-existing-object orphan-tag tests.
