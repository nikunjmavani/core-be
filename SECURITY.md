# Security policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** so we can address them before public disclosure.

- **Preferred:** Use GitHub **Security** → **Report a vulnerability** on this repository (private security advisory).
- **Alternative:** Email **security@example.com** with the same details below.

Include, where possible:

- A clear description and steps to reproduce (or a proof of concept).
- The impact you believe the issue has (confidentiality, integrity, availability).
- Affected component or version (commit, tag, or release).

**Do not** file public issues, pull requests, or discuss the vulnerability in public channels until we have agreed on coordinated disclosure.

## What to expect

- We aim to acknowledge receipt within **3 business days**.
- We aim to provide status updates at least every **7 business days** until the issue is resolved or closed.
- We follow a **coordinated disclosure** process: we may reserve up to **90 days** to develop and ship a fix before public disclosure, depending on severity and third-party coordination. We will work with you on a reasonable timeline.

## Dependency vulnerability response

Dependency vulnerabilities are handled through Dependabot, CI dependency audit gates, and manual review before merge.

### Intake paths

- **Dependabot security updates:** Dependabot opens a pull request. Review and merge manually after required PR CI checks pass, including `pnpm deps:audit`.
- **Dependabot PR CI failures:** When PR CI fails on a Dependabot PR, [`.github/workflows/dependabot-ci-triage.yml`](../../.github/workflows/dependabot-ci-triage.yml) opens or updates a GitHub issue for maintainer triage (security failures use an urgent title).
- **CI audit failures:** Any pull request that introduces a vulnerable dependency is blocked by `pnpm deps:audit` and `pnpm deps:audit:prod`.
- **Private reports:** Security reports for this repository's own source code follow the private reporting and coordinated disclosure process above.

### Triage targets

Use the advisory severity, exploitability, and reachability in this codebase to set the response target:

| Severity              | Target                                                |
| --------------------- | ----------------------------------------------------- |
| Critical (CVSS 9.0+)  | Fix, merge, or mitigate within **24 hours**.          |
| High (CVSS 7.0-8.9)   | Fix, merge, or mitigate within **3 business days**.   |
| Medium (CVSS 4.0-6.9) | Fix, merge, or mitigate within **7 business days**.   |
| Low (CVSS < 4.0)      | Handle in the regular weekly dependency update batch. |

### Manual dependency fix checklist

For any dependency security update that requires manual merge:

1. Read the linked advisory and determine whether the vulnerable code path is reachable.
2. Prefer patch or minor updates when they contain the fix.
3. For transitive vulnerabilities, prefer a `pnpm.overrides` entry that pins the vulnerable package to a patched version before upgrading a direct dependency to a new major version.
4. If a direct dependency requires a major upgrade, review the changelog, update the affected call sites, and keep the fix in the same pull request.
5. Run the dependency and quality gates before merging:

   ```bash
   pnpm deps:audit
   pnpm deps:audit:prod
   pnpm validate
   pnpm test
   ```

6. Commit `package.json` and `pnpm-lock.yaml` together when dependency versions or overrides change.
7. If no fix is available, document the temporary mitigation, owner, and follow-up date in the tracking issue.

## Supported versions

Security fixes are provided for the **latest release line** on the default branch (`main`), when applicable. Older releases may not receive backports.

## Scope

This policy applies to **security vulnerabilities in the source code of this repository** as maintained here.

**Out of scope** includes, without limitation:

- Issues in third-party dependencies reported by external researchers (report to the upstream project or advisory database). Maintainers still track and remediate dependency advisories internally through Dependabot and CI audit gates.
- Social engineering or physical security.
- Deployments, configurations, or integrations outside this repository’s maintainers’ control.

## Safe harbor

We support good-faith security research that follows this policy. We will not pursue civil action or law-enforcement referral against researchers who:

- Make a good-faith effort to avoid privacy violations, destruction of data, and interruption or degradation of our service.
- Do not exploit a finding beyond what is necessary to demonstrate the issue.
- Keep findings confidential until we have had a reasonable time to fix them, per coordinated disclosure above.

If you are unsure whether conduct is in scope, contact us first (same channels as above).
