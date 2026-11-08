---
name: dependency-alerts
description: How to fix vulnerable dependency alerts (Dependabot, npm audit, pip-audit, Composer audit and similar) by updating the dependency instead of adding a package-manager override, overriding only when no released update fixes it, and leaving dismissal of dev-only alerts to the user. Use when fixing a security alert or audit finding, or before adding overrides, resolutions or constraints.
---

# Dependency alerts

For each alert, find which package is vulnerable, which fixed version exists, and how the repo pulls it in (direct, or through which direct dependency). Check every copy of the package in the lockfile, since several versions can be installed side by side.

Then decide which case it is, in this order:

## 1. No fixed version exists

If no patched release of the package exists, change nothing. Report the alert to the user with the advisory and any upstream issue tracking the fix.

## 2. Dev-only on an unused code path

When the vulnerable package is only used in development (build, test or lint tooling) and the vulnerable code path isn't used:

- Update what can be updated, as in section 3, steps 1 and 2.
- Add no override for it.
- Leave dismissing the alert to the user. Don't dismiss it yourself; tell them which alert it is and why it doesn't affect the shipped code.

## 3. Everything else: update rather than override

Stop at the first step that fixes it.

1. **Direct dependency:** if the vulnerable package is a direct dependency, update it to a fixed version.
2. **Transitive dependency:** update the direct dependency that pulls it in to a release that depends on a fixed version. If the version range already allows a fixed version, refreshing the lockfile for that package is enough (for example `npm update <pkg>`, `pnpm update <pkg>`, `composer update <pkg> --with-dependencies`).
3. **Override as a last resort:** use a package-manager override (npm `overrides`, Yarn `resolutions`, `pnpm.overrides`, a pip constraints file, or for Composer a root `conflict` entry or a direct requirement) only when no released update of the direct dependency fixes it. Say in the PR which upstream release will let the override go.

After any change, run the repo's install, build and tests, and confirm every copy of the package now resolves to a fixed version in the lockfile.

## Reporting

For each alert: the package, the fixed version, what you changed (update, lockfile refresh or override) and why, and any alert left for the user to dismiss or with no fix yet.
