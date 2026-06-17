---
'@dudousxd/nestjs-context': minor
---

Auto-wire `traceId` into `@dudousxd/nestjs-diagnostics` when it is installed. On
module init `ContextModule` soft-detects diagnostics (a new OPTIONAL peer — no
static import, a failed dynamic import is a silent no-op) and registers this
context's accessor via `setContextAccessor`. As a result every `aviary:*`
diagnostic event — authz decisions, inertia renders, durable, notifications, and
any future emitter — carries the current request's `traceId` automatically, with
zero configuration. Apps that don't use diagnostics are unaffected.
