---
"@dudousxd/nestjs-context": minor
---

Ecosystem improvements for `@dudousxd/nestjs-context`.

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
