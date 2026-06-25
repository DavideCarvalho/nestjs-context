---
name: custom-fields
description: >
  Extend the @dudousxd/nestjs-context store with your own typed fields and
  populate them. Covers ContextStore module augmentation (declare module to add
  locale/impersonatorId/etc.), the forRoot initialize hook that merges fields at
  request start, eager enrichers (ContextEnricher) run by the middleware after
  entering the context plus Context.runEnrichers for non-HTTP entrypoints, and
  Context.lazy for memoized on-first-access derived values. Load when adding a
  custom field, deciding between initialize/enrichers/lazy, or typing a new store
  property so Context.get()/set() stay type-safe.
metadata:
  type: core
  library: '@dudousxd/nestjs-context'
  library_version: 0.2.0
  framework: nestjs
sources:
  - DavideCarvalho/nestjs-context:packages/core/src/context.ts
  - DavideCarvalho/nestjs-context:packages/core/src/middleware.ts
  - DavideCarvalho/nestjs-context:packages/core/src/types.ts
  - DavideCarvalho/nestjs-context:DESIGN.md
---

# Setup

`ContextStore` is open for extension. Add your fields with TypeScript module
augmentation so `Context.get()`, `Context.set()`, and `Context.lazy()` stay
typed.

```ts
// context-augmentation.ts — imported once anywhere in the app
declare module '@dudousxd/nestjs-context' {
  interface ContextStore {
    locale?: string;
    impersonatorId?: string;
  }
}
export {};
```

Now the field is type-checked everywhere:

```ts
import { Context } from '@dudousxd/nestjs-context';

Context.set('locale', 'pt-BR'); // typed; unknown keys are a compile error
const locale = Context.get()?.locale;
```

# Core Patterns

## Populate fields at request start with initialize

`initialize(req)` returns a `Partial<ContextStore>` merged into the store when the
middleware enters the context.

```ts
import { ContextModule } from '@dudousxd/nestjs-context';

ContextModule.forRoot({
  initialize: (req) => ({
    locale: parseAcceptLanguage(req.headers['accept-language'] as string),
    tenantId: tenantFromSubdomain(req),
  }),
});
```

`initialize`'s bag is merged FIRST; the resolved `traceId` and `requestId` are
set LAST and always win, so a stray `traceId` in the returned bag cannot clobber
them.

## Derive fields with enrichers

An enricher sees the assembled store (and the request) and either returns a
`Partial<ContextStore>` to merge or mutates the store in place. The middleware
runs all enrichers right after entering the context.

```ts
import { ContextModule, type ContextEnricher } from '@dudousxd/nestjs-context';

const regionFromTenant: ContextEnricher = (store) => {
  if (store.tenantId) return { region: regionFor(store.tenantId) };
  return undefined;
};

ContextModule.forRoot({ enrichers: [regionFromTenant] });
```

A throwing enricher is isolated — it never breaks the request or the other
enrichers. For non-HTTP entrypoints call `Context.runEnrichers(req)` yourself
after `Context.run`/`enterWith`.

## Compute expensive fields lazily with Context.lazy

`Context.lazy` runs the factory at most once per request per key and memoizes the
result onto the store. Use it for values that are expensive or rarely needed.

```ts
import { Context } from '@dudousxd/nestjs-context';

const displayName = Context.lazy('displayName', (store) =>
  lookupDisplayName(store.userRef), // runs once; later reads are free
);
```

# Common Mistakes

### HIGH Setting a custom field without augmenting ContextStore

Wrong:

```ts
Context.set('locale', 'pt-BR');
// TS2345: Argument of type '"locale"' is not assignable to parameter of type 'keyof ContextStore'
```

Correct:

```ts
declare module '@dudousxd/nestjs-context' {
  interface ContextStore { locale?: string }
}
Context.set('locale', 'pt-BR');
```

`set`/`lazy` are keyed by `keyof ContextStore`; without augmentation the key is
not part of the type and the call fails to compile (or needs an unsafe cast).

Source: packages/core/src/context.ts:244

### MEDIUM Custom field not surviving the queue/durable boundary

Wrong:

```ts
declare module '@dudousxd/nestjs-context' { interface ContextStore { locale?: string } }
ContextModule.forRoot({ initialize: (req) => ({ locale: 'pt-BR' }) });
// locale is set per-request but dropped by Context.serialize()
```

Correct:

```ts
ContextModule.forRoot({
  initialize: (req) => ({ locale: 'pt-BR' }),
  carrier: ['traceId', 'tenantId', 'userRef', 'locale'],
});
```

Augmenting the type does not change the default carrier; add the field to
`carrier` (see the cross-boundary skill) or it serializes out.

Source: packages/core/src/context.ts:182; packages/core/src/types.ts:65

### MEDIUM Doing expensive work in initialize for a rarely-read field

Wrong:

```ts
ContextModule.forRoot({
  initialize: (req) => ({ displayName: syncLookupName(req) }), // runs every request
});
```

Correct:

```ts
const displayName = Context.lazy('displayName', (s) => lookupDisplayName(s.userRef));
```

`initialize` and eager enrichers run on every request even when the field is
never read; `Context.lazy` defers the cost to first access and memoizes it.

Source: packages/core/src/context.ts:493

### MEDIUM Returning a traceId from initialize expecting it to apply

Wrong:

```ts
ContextModule.forRoot({
  initialize: (req) => ({ traceId: req.headers['x-trace'] as string }),
});
// the returned traceId is overwritten by the resolved traceId
```

Correct:

```ts
ContextModule.forRoot({
  traceId: (req) => (req.headers['x-trace'] as string) ?? randomTraceId(),
});
```

The middleware merges `initialize` first, then re-asserts the dedicated
`traceId`/`requestId`; use the `traceId` hook to influence the trace id.

Source: packages/core/src/middleware.ts:43
