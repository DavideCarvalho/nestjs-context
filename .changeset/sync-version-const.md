---
"@dudousxd/nestjs-context": patch
---

fix: sync the exported `VERSION` const with package.json at release time. The plain `tsc` build does no version injection and `changeset version` only bumps package.json, so the hard-coded `VERSION` in `src/index.ts` could ship stale (it was `0.1.0-alpha.0` while the package was `0.2.0`). Corrected the literal and added `scripts/sync-version.mjs`, chained into `version-packages` to re-sync on every bump, with a `--check` guard in `release` that fails the publish on drift.
