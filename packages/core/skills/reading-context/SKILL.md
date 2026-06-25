---
name: reading-context
description: >
  Read and mutate the per-request store of @dudousxd/nestjs-context. Covers
  Context.get/traceId/tenantId/userRef, Context.set to fill userRef/tenantId from
  an auth guard, the one-shot warning when Context.set runs outside an active
  context, the UserRef { type, id } shape, and how consumer libraries inject the
  read-only ContextAccessor via @Optional() @Inject(CONTEXT_ACCESSOR). Load when
  reading or writing context fields, wiring an auth guard, or building a library
  that degrades cleanly when nestjs-context is absent.
metadata:
  type: core
  library: '@dudousxd/nestjs-context'
  library_version: 0.2.0
  framework: nestjs
sources:
  - DavideCarvalho/nestjs-context:packages/core/src/context.ts
  - DavideCarvalho/nestjs-context:packages/core/src/accessor.ts
  - DavideCarvalho/nestjs-context:packages/core/src/tokens.ts
  - DavideCarvalho/nestjs-context:DESIGN.md
---

# Setup

The middleware enters the store with only `traceId` (and `requestId`). Auth-time
fields like `userRef` and `tenantId` are written later, in a guard or
interceptor, with `Context.set`.

```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Context } from '@dudousxd/nestjs-context';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user; // resolved by your auth layer
    if (user) {
      Context.set('userRef', { type: 'user', id: user.id });
      Context.set('tenantId', user.tenantId);
    }
    return true;
  }
}
```

Read it anywhere downstream:

```ts
import { Context } from '@dudousxd/nestjs-context';

const who = Context.userRef();   // { type: 'user', id: 7 } | undefined
const tenant = Context.tenantId();
const store = Context.get();      // full ContextStore | undefined
```

# Core Patterns

## Store a UserRef, never the whole user

`userRef` is `{ type: string; id: string | number }`. Keeping a ref (not the
entity) is what keeps the store serializable across the queue/durable boundary.

```ts
Context.set('userRef', { type: 'user', id: user.id });
// later, resolve the full entity from the ref if you need it:
const ref = Context.userRef();
const user = ref ? await users.findOne({ id: ref.id }) : undefined;
```

## Inject the read-only accessor in a library

Consumer libraries should not import `Context` directly; they inject the global
`CONTEXT_ACCESSOR` token with `@Optional()` so they keep working when
`nestjs-context` is not installed.

```ts
import { Inject, Injectable, Optional } from '@nestjs/common';
import { CONTEXT_ACCESSOR, type ContextAccessor } from '@dudousxd/nestjs-context';

@Injectable()
export class AuditService {
  constructor(
    @Optional() @Inject(CONTEXT_ACCESSOR) private readonly ctx?: ContextAccessor,
  ) {}

  record(change: unknown) {
    return {
      causer: this.ctx?.userRef(),
      traceId: this.ctx?.traceId(),
      change,
    };
  }
}
```

`ContextAccessor` is a narrow read-only surface — `traceId()`, `tenantId()`,
`userRef()`, `get()` — with no `set`/`run`: consumers read, they do not drive the
lifecycle.

## Read the whole store

```ts
const store = Context.get();
if (store) {
  console.log(store.traceId, store.requestId, store.tenantId);
}
```

# Common Mistakes

### HIGH Context.set on a path the middleware did not cover

Wrong:

```ts
// guard runs on a route in ContextModule.forRoot({ exclude: [...] })
Context.set('userRef', { type: 'user', id: user.id }); // silently dropped
```

Correct:

```ts
// ensure the route is inside forRoutes (not excluded), so a store exists;
// or establish one yourself first:
Context.run({ traceId: randomTraceId() }, () => {
  Context.set('userRef', { type: 'user', id: user.id });
});
```

Outside an active context `Context.set` is a no-op and the write is lost; it
emits a one-shot `console.warn` then stays silent for the rest of the process.

Source: packages/core/src/context.ts:244

### CRITICAL Storing the full user entity in the store

Wrong:

```ts
Context.set('userRef', currentUser as any); // entity with relations, password hash…
```

Correct:

```ts
Context.set('userRef', { type: 'user', id: currentUser.id });
```

The store is serialized across queue/durable boundaries; a full entity may leak
sensitive fields and is often non-serializable (cyclic relations, DB handles).
`UserRef` is deliberately just `{ type, id }`.

Source: packages/core/src/context.ts:17; DESIGN.md §2

### HIGH Plain @Inject(CONTEXT_ACCESSOR) in a consumer lib

Wrong:

```ts
constructor(@Inject(CONTEXT_ACCESSOR) private ctx: ContextAccessor) {}
// throws "Nest can't resolve dependencies" when nestjs-context is not imported
```

Correct:

```ts
constructor(
  @Optional() @Inject(CONTEXT_ACCESSOR) private ctx?: ContextAccessor,
) {}
```

The token is provided only by `ContextModule`; without `@Optional()` a consumer
library hard-fails in any app that hasn't installed/imported `nestjs-context`.

Source: packages/core/src/tokens.ts; DESIGN.md §6

### MEDIUM Mutating the object returned by Context.get()

Wrong:

```ts
const store = Context.get();
store!.tenantId = 't1'; // works, but bypasses the set-outside-context guard
```

Correct:

```ts
Context.set('tenantId', 't1'); // no-op + warning when there is no context
```

`Context.get()` hands back the live store reference, so a direct write outside a
context throws a `TypeError` on `undefined` instead of the friendly no-op `set`
gives; prefer `set` for writes.

Source: packages/core/src/context.ts:229
