---
name: dependency-alerts
description: How to fix vulnerable dependency alerts (Dependabot, npm audit, pip-audit, Composer audit and similar) - update the dependency instead of adding a package-manager override, override only when no released update fixes it, and leave dismissing dev-only alerts to the owner. Use when fixing a security alert or audit finding, or before adding overrides, resolutions or constraints.
---

# Dependency alerts

For each alert, find which package is vulnerable, which fixed version exists, and how the repo pulls it in (direct, or through which direct dependency). Then work down this list and stop at the first step that fixes it.

## 1. Update rather than override

1. **Direct dependency:** if the vulnerable package is a direct dependency, update it to a fixed version.
2. **Transitive dependency:** update the direct dependency that pulls it in to a release that depends on a fixed version. If the version range already allows a fixed version, refreshing the lockfile for that package is enough (for example `npm update <pkg>`, `pnpm update <pkg>`, `composer update <pkg> --with-dependencies`).
3. **Override as a last resort:** use a package-manager override (`overrides`, `resolutions`, `pnpm.overrides`, a constraints file or similar) only when no released update of the direct dependency fixes it. Add a comment or PR note saying which upstream release will let the override go.

After any change, run the repo's install, build and tests, and confirm the alert's package now resolves to a fixed version in the lockfile.

## 2. Dev-only alerts on unused code paths

When the vulnerable package is only used in development (build, test or lint tooling) and the vulnerable code path isn't used:

- Update what can be updated, as in section 1.
- Add no override for it.
- Leave dismissing the alert to the owner. Don't dismiss it yourself; tell them which alert it is and why it doesn't affect the shipped code.

## Reporting

For each alert: the package, the fixed version, what you changed (update, lockfile refresh or override) and why, and any alert left for the owner to dismiss.
