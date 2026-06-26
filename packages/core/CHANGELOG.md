# @dudousxd/nestjs-context

## 1.0.2

### Patch Changes

- [#8](https://github.com/DavideCarvalho/nestjs-context/pull/8) [`680aa63`](https://github.com/DavideCarvalho/nestjs-context/commit/680aa63731982560cccb12a7ab5b19a355cdb051) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Ship TanStack Intent agent skills (SKILL.md) inside the package.

- [#8](https://github.com/DavideCarvalho/nestjs-context/pull/8) [`013b074`](https://github.com/DavideCarvalho/nestjs-context/commit/013b07484643867e0183759cc08f393ecbb97ea8) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - fix: sync the exported `VERSION` const with package.json at release time. The plain `tsc` build does no version injection and `changeset version` only bumps package.json, so the hard-coded `VERSION` in `src/index.ts` could ship stale (it was `0.1.0-alpha.0` while the package was `0.2.0`). Corrected the literal and added `scripts/sync-version.mjs`, chained into `version-packages` to re-sync on every bump, with a `--check` guard in `release` that fails the publish on drift.

## 1.0.1

### Patch Changes

- [`693b19b`](https://github.com/DavideCarvalho/nestjs-context/commit/693b19b30920d3f3c28329ab879a49650ef53a79) - Register `context:accessor` as a typed capability in the ecosystem protocol's `CapabilityRegistry` (type-only augmentation) and add a conformance test (`assertCapabilityNaming`) that locks the canonical token naming. `@dudousxd/nestjs-diagnostics` stays an OPTIONAL peer — no runtime dependency added; context still works standalone.

## 1.0.0

### Minor Changes

- [#5](https://github.com/DavideCarvalho/nestjs-context/pull/5) [`d7d038c`](https://github.com/DavideCarvalho/nestjs-context/commit/d7d038c339eb4fdbdf01c0dd4b10a8b9df4a6fe9) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Ecosystem improvements for `@dudousxd/nestjs-context`.

  - **Faithful `toTraceparent`**: now preserves the upstream parent-id and sampling
    flags when an inbound `traceparent` header is present, instead of synthesizing a
    fresh one. Outgoing headers correctly continue the caller's trace.
  - **Guarded `Context.set`**: emits a development-mode warning when called outside
    of an active context (where the write would otherwise be silently lost), making
    misuse easy to catch during development.
  - **`Context.bind()` snapshot helper**: captures the current context and returns a
    wrapped function that restores it on invocation, so context propagates correctly
    across `setTimeout`, `EventEmitter` callbacks, queue/worker boundaries, and other
    places where the async chain would otherwise break.
  - **W3C / OpenTelemetry baggage interop**: serialize and deserialize context
    fields (e.g. `tenant`, `userRef`) to and from the standard `baggage` header,
    enabling propagation across service boundaries with OTel-compatible tooling.
  - **Enrichers + `Context.lazy()`**: register enrichers to augment the context and
    resolve values lazily on first access.
  - **`ContextModule.forRootAsync`**: async configuration of the module, allowing
    options to be built from injected dependencies (e.g. `ConfigService`).
  - **Packaging hygiene**: declared `sideEffects` and `exports` maps for correct
    tree-shaking and module resolution.

  Note: this release also adds a `LICENSE` file (MIT).

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
