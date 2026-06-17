---
"@dudousxd/nestjs-context": patch
---

perf: faster per-request context hot path — constant-compare the traceparent all-zero check, skip the redundant traceId rewrite when no `initialize()` hook is configured, and hand-roll `defaultSerialize` for the default carrier.
