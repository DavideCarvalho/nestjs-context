---
"@dudousxd/nestjs-context": patch
---

Say what keeps `VERSION` in sync, and that nothing checks it

Comment only. The constant is rewritten by `scripts/sync-version.mjs` during the release; a
release that does not run it ships a build reporting the previous version, and no test here
catches that. Worth stating where the constant is declared rather than only in the script
that moves it.
