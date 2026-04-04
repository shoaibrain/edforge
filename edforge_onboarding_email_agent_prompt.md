# EdForge — Tenant Onboarding Email Improvement
## Agent Prompt: Audit, Design & Implement

---

## CONTEXT

The current tenant onboarding email sent via Cognito reads:

```
Subject: Welcome to EdForge - Your Account is Ready

Welcome to EdForge! Your account has been created.
Login to your EdForge account at https://edforge.app with:
Username: shoaib.rain@outlook.com
Temporary Password: Bp1&WEgy
Please change your password after your first login.
If you have any questions, please contact your administrator.
```

This is inadequate for a professional enterprise SaaS product. It has no personalization,
no onboarding guidance, no next steps, no branding, and no trust signals.

The authoritative new email design is in:
`edforge-saas-frontend/edforge_onboarding_email.html`

This is a production-grade HTML email template that must be implemented
into the actual provisioning system.

**Do not change any other behavior in the provisioning pipeline.**
**Do not change AdminWeb form fields or any other settings logic.**
**Scope: email template only.**

---

## PHASE 1 — AUDIT (Read-Only First)

### Step 1 — Locate every place the current email is defined

Read and document:

```
server/lib/tenant-template/identity-provider.ts
  → Find the emailMessage and emailSubject fields in the Cognito User Pool
    InviteMessageTemplate or VerificationMessage configuration.
  → Record exact lines where subject and body are defined.
  → Record what template variables Cognito supports: {username}, {####}, etc.

server/lib/provision-scripts/provision-tenant.sh
  → Find the `aws cognito-idp admin-create-user` command.
  → Record all flags used: --desired-delivery-mediums, --message-action,
    --temporary-password, --user-attributes, etc.
  → Does it pass --message-template or rely on the User Pool's default template?

server/lib/bootstrap-template/tenant-seeder-lambda.ts
  → Is there any SES send call here?
  → Is there any post-provisioning email triggered separately from Cognito?

server/application/microservices/identity/src/
  → Search for any SES, nodemailer, or email-sending logic.
  → Search for any template rendering (Handlebars, Mustache, EJS, etc.)
  → Record every file that contains email-sending logic.
```

### Step 2 — Understand Cognito template variable constraints

Cognito's built-in invite message template supports only two variables:
- `{username}` — the username/email of the new user
- `{####}` — the temporary password (Cognito-generated)

It does NOT support: organization name, admin first name, plan tier, created date,
platform URL (except as a hardcoded string), or any custom variables.

Document: Does the current implementation use raw Cognito invite template, or is
there a custom post-provisioning email sent separately via SES or another service?
This determines whether rich personalization is possible without architecture changes.

### Step 3 — Write audit findings to `docs/email-audit.md`

Cover:
- Exact files and lines where current email content is defined
- Whether the system uses Cognito built-in template or custom SES email
- What variables are available in the current system
- What would need to change to support: admin first name, org name, plan tier, created date

---

## PHASE 2 — IMPLEMENTATION

Based on audit findings, implement one of two paths:

---

### PATH A — If the system uses Cognito built-in invite template only

**Constraints:**
- Only `{username}` and `{####}` are available as variables
- Cognito invite messages have a character limit (2048 chars for email body in CDK)
- HTML email is supported in Cognito invite templates

**What to do:**

**Task A.1 — Update email subject**
File: `server/lib/tenant-template/identity-provider.ts`
Change: `emailSubject` in `InviteMessageTemplate`
From: `Welcome to EdForge - Your Account is Ready`
To:   `Welcome to EdForge — Your Account is Ready`
(em dash, not hyphen — matches brand voice)

**Task A.2 — Update email body to styled HTML**
File: `server/lib/tenant-template/identity-provider.ts`

Replace the `emailMessage` field with a condensed HTML version of the new template.
Because Cognito only supports `{username}` and `{####}`, the template must:
- Use `{username}` where the email/username appears
- Use `{####}` where the temporary password appears
- Hardcode the platform URL as `https://edforge.app`
- Use "Hi there" instead of "Hi {{ADMIN_FIRST_NAME}}" (name not available)
- Include the 5-step getting started section
- Include credentials (username + temp password) clearly formatted
- Include security warning about temporary password expiry
- Include support email and documentation link
- Must be valid HTML that renders in Gmail, Outlook, Apple Mail

Use inline CSS only — no external stylesheets (email clients strip them).
Use table-based layout for Outlook compatibility where needed.

Color palette to use (inline):
- Background: #f0f2f7
- Card background: #ffffff
- Header background: #0f1117
- Primary accent: #1D9E75 (teal)
- Secondary accent: #378ADD (blue)
- Text primary: #1e2436
- Text muted: #7a8099
- Border: #e4e7f0

**Task A.3 — Validate character count**
Cognito CDK `emailMessage` has a 2048 character limit when defined in the stack.
If the HTML exceeds this, extract to an SES template instead (see Path B).

**Task A.4 — Update SMS template**
File: `server/lib/tenant-template/identity-provider.ts`
Change the `smsMessage` to:
`Welcome to EdForge! Login at edforge.app with username: {username} and temp password: {####}. Change your password immediately on first login.`

---

### PATH B — If the system uses custom SES email OR if Cognito template is too limited

**What to do:**

**Task B.1 — Create SES email template**
If not already using SES for transactional email, add an SES template resource to the
CDK stack:

File: `server/lib/tenant-template/ses-templates.ts` (create if not exists)

```typescript
// SES Template for tenant admin onboarding
new ses.CfnTemplate(this, 'TenantOnboardingEmailTemplate', {
  template: {
    templateName: 'EdForgeTenantOnboarding',
    subjectPart: 'Welcome to EdForge — Your Account is Ready, {{adminFirstName}}',
    htmlPart: fs.readFileSync(
      path.join(__dirname, '../email-templates/tenant-onboarding.html'), 'utf8'
    ),
    textPart: fs.readFileSync(
      path.join(__dirname, '../email-templates/tenant-onboarding.txt'), 'utf8'
    ),
  },
});
```

**Task B.2 — Create email template files**

Create: `server/lib/email-templates/tenant-onboarding.html`
Content: The HTML from `edforge-saas-frontend/edforge_onboarding_email.html`
but with SES template variables replacing the placeholders:

| Placeholder in design | SES variable |
|-----------------------|--------------|
| `{{ADMIN_FIRST_NAME}}` | `{{adminFirstName}}` |
| `{{ADMIN_EMAIL}}` | `{{adminEmail}}` |
| `{{TEMP_PASSWORD}}` | `{{tempPassword}}` |
| `{{ORGANIZATION_NAME}}` | `{{organizationName}}` |
| `{{PLAN_TIER}}` | `{{planTier}}` |
| `{{CREATED_DATE}}` | `{{createdDate}}` |

Create: `server/lib/email-templates/tenant-onboarding.txt`
Plain text fallback version — all same information, no HTML:

```
Welcome to EdForge, {{adminFirstName}}.

Your EdForge account for {{organizationName}} has been provisioned and is ready to use.

LOGIN CREDENTIALS
─────────────────
Username:           {{adminEmail}}
Temporary Password: {{tempPassword}}
Platform URL:       https://edforge.app

IMPORTANT: This temporary password expires after first use. You will be required to
set a new password on your first login. Do not share this email with anyone.

ACCOUNT DETAILS
───────────────
Organization: {{organizationName}}
Your Role:    Tenant Administrator
Plan:         {{planTier}}
Created:      {{createdDate}}

GETTING STARTED
───────────────
1. Log in at edforge.app and change your password
2. Go to Settings → Workspace to confirm your currency, timezone, and calendar settings
3. Go to Settings → Organization to set up your academic year and terms
4. Create your first school
5. Invite staff from People → Staff Directory

SUPPORT
───────
Email:         support@edforge.app
Documentation: docs.edforge.app
Help Center:   edforge.app/support

If you did not request this account, contact security@edforge.app immediately.

© 2026 EdForge. All rights reserved.
```

**Task B.3 — Send via SES in provision-tenant.sh OR TenantSeederLambda**

Option 1 (preferred): Send from TenantSeederLambda after seeding is complete.
This gives access to all tenant metadata (name, tier, email, createdAt).

In `server/lib/bootstrap-template/tenant-seeder-lambda.ts`:
```typescript
// After successful tenant seeding:
await sesClient.send(new SendTemplatedEmailCommand({
  Source: 'EdForge <no-reply@edforge.app>',
  Destination: { ToAddresses: [tenantAdminEmail] },
  Template: 'EdForgeTenantOnboarding',
  TemplateData: JSON.stringify({
    adminFirstName: adminName.split(' ')[0] || adminName,
    adminEmail: tenantAdminEmail,
    tempPassword: tempPassword,         // Passed from provision-tenant.sh via env or SSM
    organizationName: tenantName,
    planTier: tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase(),
    createdDate: new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    }),
  }),
}));
```

**Task B.4 — Disable Cognito built-in invite email to avoid duplicate**
In `server/lib/tenant-template/identity-provider.ts`:
Set `suppressUserInvitation: true` OR configure the User Pool to not send the invite
email automatically when `admin-create-user` is called.
Specifically: do NOT set `--desired-delivery-mediums EMAIL` in the `admin-create-user`
CLI call in `provision-tenant.sh` if SES is handling the email.

**Validation for Path B:**
- Create a test tenant via AdminWeb
- Confirm only ONE email is received (not both Cognito default + SES)
- Confirm email renders correctly in: Gmail (web), Outlook (web), Apple Mail
- Confirm all template variables are substituted (no `{{variableName}}` visible)
- Confirm temp password in email matches Cognito-generated temp password
- Confirm plain text fallback is attached

---

## CONSTRAINTS — APPLY THROUGHOUT

- **Do not change the provisioning pipeline behavior** — only the email content and delivery
- **Do not change AdminWeb form fields** — out of scope
- **Do not change workspace settings defaults** — out of scope
- **Do not change Cognito User Pool auth configuration** — only the message template
- The email template HTML must be **email-client safe**: inline CSS only, table layouts
  for complex structure, no JavaScript, no external fonts loaded via @import
- Plain text fallback is **required** — do not send HTML-only
- The "From" address must be a verified SES sender identity (`no-reply@edforge.app`)
- SES must be in the same region as the tenant infrastructure OR use SES in us-east-1
  as the global sending region — verify this against existing infrastructure

---

## DELIVERABLES

1. `docs/email-audit.md` — Phase 1 findings: where email is defined, what variables
   are available, which path (A or B) is appropriate
2. Implementation committed to the correct files per the chosen path
3. `docs/email-implementation-notes.md` — Brief record of: which path was taken,
   what files were changed, how to test, known limitations
