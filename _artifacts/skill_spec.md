# Skill spec — nestjs-context

Autonomous compressed discovery (no maintainer interview was run; the interactive
Phases 2 & 4 of domain-discovery were skipped per the autonomous mandate).

## Scope

Two public packages, both client-facing and both covered:

- `@dudousxd/nestjs-context` (packages/core) — the module a consumer imports.
- `@dudousxd/nestjs-context-testing` (packages/testing) — the test helper.

No other packages exist in the workspace, so nothing public is left uncovered.

## Skill set (flat, all `type: core`)

| Skill | Package | What it teaches |
|-------|---------|-----------------|
| `context-setup` | core | `ContextModule.forRoot` / `forRootAsync`, global module, `ContextMiddleware`, `autoMiddleware`/`forRoutes`/`exclude`, non-HTTP entrypoints via `Context.run`/`enterWith`, basic reads |
| `reading-context` | core | `Context.get`/`set`/`traceId`/`tenantId`/`userRef`, setting `userRef` in an auth guard, the out-of-context `set` footgun, injecting `CONTEXT_ACCESSOR` with `@Optional()` |
| `cross-boundary` | core | `Context.serialize`/`deserialize` carrier, `Context.bind`, W3C `baggage` (`toBaggage`/`fromBaggage`), `traceparent` helpers, `carrier` config, process-global config |
| `custom-fields` | core | `ContextStore` module augmentation, `initialize` hook, `enrichers`, `Context.lazy` |
| `context-testing` | testing | `runWithContext`, `enterContext`, `PartialContextStore` |

Flat structure: `packages/<pkg>/skills/<skill>/SKILL.md`. Five skills, no router
skill (under the threshold), each self-contained.

## Grounding

Every snippet is grounded in `packages/*/src` and cross-checked against the test
suite (`packages/core/test/*.spec.ts`) and `DESIGN.md`. No external API was
invented. `sources` in each SKILL.md point at the real source files.

## Remaining Gaps (would normally come from a maintainer interview)

1. **No issue mining.** `gh search issues --repo DavideCarvalho/nestjs-context`
   returned nothing (no access / private / empty). Failure modes are therefore
   derived from source comments, `DESIGN.md`, and the test suite — not from real
   reported developer confusion. An interview would have surfaced the actual
   top support questions.
2. **No in-repo docs.** The README only links to an external Aviary docs site;
   there is no `docs/` directory. Production "tribal knowledge" beyond `DESIGN.md`
   could not be captured.
3. **Domain priority is inferred.** Without a maintainer, the relative importance
   of the four core domains (which skill an agent loads most often) is a best
   guess — setup and reading are assumed highest-traffic.
4. **Downstream consumer integrations are roadmap-level.** `DESIGN.md` describes
   audit/filter/telescope/durable consuming `CONTEXT_ACCESSOR`, and a diagnostics
   bridge to `@dudousxd/nestjs-diagnostics`, but those consumers live in other
   repos. Only the `CONTEXT_ACCESSOR` / carrier contract is grounded here.
5. **`VERSION` const drift.** `packages/core/src/index.ts` exports
   `VERSION = '0.1.0-alpha.0'` while `package.json` is `0.2.0`; the maintainer
   would confirm which is authoritative (skills target the package.json `0.2.0`).
