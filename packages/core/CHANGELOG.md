# @dudousxd/nestjs-context

## 0.2.1

### Patch Changes

- [`eba468f`](https://github.com/DavideCarvalho/nestjs-context/commit/eba468fd399aea462170dda214c9d7ad2ab991a5) - perf: faster per-request context hot path — constant-compare the traceparent all-zero check, skip the redundant traceId rewrite when no `initialize()` hook is configured, and hand-roll `defaultSerialize` for the default carrier.

## 0.2.0

### Minor Changes

- [#2](https://github.com/DavideCarvalho/nestjs-context/pull/2) [`f1c4f5c`](https://github.com/DavideCarvalho/nestjs-context/commit/f1c4f5c20df05b156da2bc9da63caa46aa6cfebf) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Auto-wire `traceId` into `@dudousxd/nestjs-diagnostics` when it is installed. On
  module init `ContextModule` soft-detects diagnostics (a new OPTIONAL peer — no
  static import, a failed dynamic import is a silent no-op) and registers this
  context's accessor via `setContextAccessor`. As a result every `aviary:*`
  diagnostic event — authz decisions, inertia renders, durable, notifications, and
  any future emitter — carries the current request's `traceId` automatically, with
  zero configuration. Apps that don't use diagnostics are unaffected.

## 0.1.0

### Minor Changes

- [`a2d5869`](https://github.com/DavideCarvalho/nestjs-context/commit/a2d5869455e83f45fb23eed649513813465be151) - Initial release: shared AsyncLocalStorage context (`Context` singleton + `ContextStore`), W3C traceparent helpers, `ContextMiddleware`, global `ContextModule.forRoot()` with the `CONTEXT_ACCESSOR` token, and the `@dudousxd/nestjs-context-testing` helper (`runWithContext`).
