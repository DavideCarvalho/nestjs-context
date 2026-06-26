---
name: context-setup
description: >
  Wire @dudousxd/nestjs-context into a NestJS app. Covers ContextModule.forRoot
  and ContextModule.forRootAsync (useFactory/useClass/useExisting), the global
  module, the ContextMiddleware that seeds traceId/requestId from the W3C
  traceparent header via enterWith, and the autoMiddleware/forRoutes/exclude
  options. Load when setting up the module, choosing forRoot vs forRootAsync,
  reading Context.traceId/tenantId/userRef, or establishing context outside HTTP
  (GraphQL/gRPC/queue) with Context.run / Context.enterWith.
metadata:
  type: core
  library: '@dudousxd/nestjs-context'
  library_version: 0.2.0
  framework: nestjs
sources:
  - DavideCarvalho/nestjs-context:packages/core/src/module.ts
  - DavideCarvalho/nestjs-context:packages/core/src/middleware.ts
  - DavideCarvalho/nestjs-context:packages/core/src/types.ts
  - DavideCarvalho/nestjs-context:DESIGN.md
---

# Setup

`ContextModule` is a global module. Import `forRoot` once in the root module;
every other module can then read the context without importing anything.

```ts
import { Module } from '@nestjs/common';
import { ContextModule } from '@dudousxd/nestjs-context';

@Module({
  imports: [
    ContextModule.forRoot(),
  ],
})
export class AppModule {}
```

That registers the global `CONTEXT_ACCESSOR` token and, because `autoMiddleware`
defaults to `true`, applies `ContextMiddleware` to all routes (`forRoutes: ['*']`).
The middleware seeds each request's store using `enterWith` (not `run`), so the
context survives the middleware return and reaches the async handler, guards, and
interceptors.

Read the current values anywhere — no injection needed:

```ts
import { Injectable } from '@nestjs/common';
import { Context } from '@dudousxd/nestjs-context';

@Injectable()
export class OrderService {
  create() {
    const traceId = Context.traceId();   // string | undefined
    const tenant = Context.tenantId();   // string | undefined
    const who = Context.userRef();        // { type, id } | undefined
    return { traceId, tenant, who };
  }
}
```

# Core Patterns

## forRoot with population options

`traceHeader` chooses the inbound trace header (default `traceparent`); `traceId`
overrides id generation; `initialize` pre-populates store fields from the request.

```ts
import { ContextModule, randomTraceId } from '@dudousxd/nestjs-context';

ContextModule.forRoot({
  traceHeader: 'x-correlation-id',
  traceId: (req) => (req.headers['x-correlation-id'] as string) ?? randomTraceId(),
  initialize: (req) => ({ tenantId: tenantFromSubdomain(req) }),
});
```

`initialize`'s bag is merged FIRST; the resolved `traceId` and the
`x-request-id` `requestId` are set LAST and always win — a stray `traceId` in
`initialize`'s return cannot clobber them.

## forRootAsync from a ConfigService

Resolve options through DI. Supply exactly one of `useFactory` / `useClass` /
`useExisting`.

```ts
import { ContextModule } from '@dudousxd/nestjs-context';
import { ConfigModule, ConfigService } from '@nestjs/config';

ContextModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    traceHeader: config.get('TRACE_HEADER') ?? 'traceparent',
  }),
});
```

With `forRootAsync` the cross-boundary config (carrier/serialize/deserialize/
baggage/enrichers) is pushed onto the singleton in the module's `onModuleInit`,
because the options do not exist until DI resolves the factory.

## Non-HTTP entrypoint (GraphQL / gRPC / queue)

Turn the HTTP middleware off and create the context yourself with the public
primitive. Use `Context.run` for a scoped callback, or `Context.enterWith` when
the context must outlive the setup call.

```ts
import { ContextModule, Context, randomTraceId } from '@dudousxd/nestjs-context';

ContextModule.forRoot({ autoMiddleware: false });

// in your consumer / interceptor:
function onMessage(msg: { traceId?: string }, handler: () => Promise<void>) {
  return Context.run({ traceId: msg.traceId ?? randomTraceId() }, handler);
}
```

## Restrict the middleware to some routes

```ts
ContextModule.forRoot({
  forRoutes: ['api/*'],
  exclude: ['health', 'metrics'],
});
```

# Common Mistakes

### HIGH Using Context.run inside a custom middleware

Wrong:

```ts
export class MyContextMiddleware implements NestMiddleware {
  use(req: any, _res: any, next: () => void) {
    // context vanishes the moment run()'s callback returns
    Context.run({ traceId: randomTraceId() }, () => next());
  }
}
```

Correct:

```ts
export class MyContextMiddleware implements NestMiddleware {
  use(req: any, _res: any, next: () => void) {
    Context.enterWith({ traceId: randomTraceId() }); // survives the return
    next();
  }
}
```

`run`'s store is torn down when its synchronous callback returns; the async
handler/guards/interceptors that run after `next()` then see no context. The
built-in `ContextMiddleware` uses `enterWith` for exactly this reason.

Source: packages/core/src/middleware.ts; DESIGN.md §3

### MEDIUM Importing ContextModule.forRoot in a feature module

Wrong:

```ts
@Module({ imports: [ContextModule.forRoot()] })
export class OrdersModule {} // and again in BillingModule, etc.
```

Correct:

```ts
@Module({ imports: [ContextModule.forRoot()] })
export class AppModule {} // once at the root; it is global
```

`forRoot` returns a `global: true` module and pushes a process-global singleton
config; importing it per-feature re-runs `Context.configure` and triggers the
"second forRoot with a different config" warning. Import it once at the root.

Source: packages/core/src/module.ts:62; packages/core/src/context.ts:318

### MEDIUM Expecting a context on an excluded route

Wrong:

```ts
ContextModule.forRoot({ exclude: ['webhooks/*'] });
// then, in a webhook handler:
const trace = Context.traceId(); // undefined — no middleware ran here
```

Correct:

```ts
// establish it yourself where the middleware was excluded
Context.run({ traceId: randomTraceId() }, () => handleWebhook());
```

`exclude` / a narrow `forRoutes` means no middleware ran for that path, so there
is no active store and every `Context.*()` read returns `undefined`.

Source: packages/core/src/module.ts:128; packages/core/src/types.ts:59

### MEDIUM Awaiting nothing in onModuleInit assumptions

Wrong:

```ts
// reading carrier config in a constructor that runs before onModuleInit
constructor() { Context.serialize(); } // forRootAsync config not applied yet
```

Correct:

```ts
// the singleton's carrier/serialize config is applied in ContextModule.onModuleInit;
// read it from request-time code (services/handlers), not module constructors
handle() { return Context.serialize(); }
```

With `forRootAsync` the cross-boundary config lands during `onModuleInit`, after
module constructors run; depending on it earlier sees the defaults.

Source: packages/core/src/module.ts:46
