# Security Policy

Thank you for taking the time to report a security issue responsibly.
EdForge is open source software that holds student data in production
deployments; we treat security reports seriously.

This policy applies to the **code and infrastructure templates in this
repository**. It does not cover third-party hosted instances of EdForge run
by other operators; for those, contact the operator directly.

---

## Reporting a vulnerability

**Do not file public GitHub Issues or Discussions for security
vulnerabilities.** Public disclosure before a fix is available puts every
EdForge operator at risk.

Use one of the following private channels, in order of preference:

1. **GitHub Security Advisories (preferred).** Open a draft advisory at
   <https://github.com/shoaibrain/edforge/security/advisories/new>. This
   creates a private thread visible only to the repository maintainers and
   anyone they collaborate with on the fix. It is the canonical channel.
2. **Email the maintainer.** If you cannot use GitHub Security Advisories
   (for example, you don't have a GitHub account or the issue requires
   reaching us outside of GitHub), contact the project owner via the email
   address on the [maintainer's GitHub profile](https://github.com/shoaibrain).

Please **do not** disclose the vulnerability publicly until we have
acknowledged it, agreed on a remediation, and shipped a fix (or 90 days
have elapsed since the initial report, whichever comes first).

---

## What to include in a report

A useful report typically contains:

- A short description of the issue and your understanding of the impact.
- The repository commit SHA (or release tag) the issue was observed on.
- A minimal reproduction: code snippet, request payload, deployment
  configuration, or step-by-step instructions.
- Any proof-of-concept artifacts (sanitized — do not include real
  third-party data).
- The CVSS vector you believe applies, if you have one. (We will compute
  our own; yours is useful as a starting point.)
- Whether the issue is already disclosed elsewhere (CVE, blog post, other
  vendor advisory) and any deadlines that apply to coordinated
  disclosure.

If you do not have all of this, send what you have. A vague signal is
still better than no signal.

---

## What to expect from us

EdForge is maintained by a small team. We do **not** offer a contractual
service-level agreement on security response. We do commit to the
following operational defaults:

- **Acknowledgement** within **14 calendar days** of receiving a report.
  This is an acknowledgement of receipt, not a triage outcome.
- **Initial triage** (severity assessment, reproducibility check, scope of
  impact) within **30 calendar days** of receiving a report.
- A **remediation plan or explanation** within **90 calendar days** of
  initial triage for high- and critical-severity issues. Lower-severity
  issues may be batched into a future release.
- **Credit** in the published advisory when a fix ships, unless you ask
  to remain anonymous.

If a report is **out of scope** (see below) or **not reproducible**, we
will say so promptly and close the report.

---

## Versions and scope

- The security policy applies to the **`main` branch** of this
  repository. EdForge does not yet ship versioned releases; once we tag
  `v1.0-oss` (and later versions), the policy will cover the latest
  released tag in addition to `main`.
- The **published npm packages** under the `@aibrains/` and `@edforge/`
  scopes are covered by this policy. Report issues against either the
  registry artifact or the source in this repository.
- The **infrastructure templates** (CDK stacks, NestJS service code,
  Docker images, NGINX config) are in scope.
- **Operator-side configuration** (your AWS account, your Cognito user
  pool, your environment variables, your network rules) is **not** in
  scope. We can help you reason about hardening, but we cannot accept
  reports against your specific deployment.

---

## Out of scope

The following are **not** treated as security vulnerabilities under this
policy. Reports about them will be politely declined.

- **Missing security headers** on locally-deployed assets where those
  headers would be supplied by the CloudFront / ALB / API Gateway layer
  in a real deployment.
- **Denial-of-service via expensive but legitimate operations** (e.g., a
  very large valid CSV import). These are capacity-planning concerns,
  not vulnerabilities.
- **Reports requiring physical access to a developer machine** or admin
  AWS credentials.
- **Social-engineering / phishing scenarios** that target operators or
  contributors rather than the software itself.
- **Vulnerabilities in upstream dependencies** that we have not yet
  patched and that are tracked in the public Dependabot advisory feed.
  Send those as bug reports, not security reports — unless you have a
  novel exploitation vector specific to EdForge's usage.
- **Theoretical issues** with no plausible attacker model.

If you are unsure whether an issue is in scope, send it via the channels
above and we will tell you.

---

## After a fix is published

Once a fix ships:

- We will publish a GitHub Security Advisory describing the issue, the
  affected versions, the fix, and the reporter (with consent).
- For **critical and high** severity, we will notify known operators
  through whatever channel we have for them.
- For **medium and low** severity, the advisory and release notes are
  the notification.

Thank you for helping keep EdForge and its operators safe.
