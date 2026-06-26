---
name: cross-boundary
description: >
  Carry @dudousxd/nestjs-context across boundaries AsyncLocalStorage does not
  follow: queues, durable workers, sub-processes, setTimeout, and EventEmitter
  callbacks. Covers Context.serialize/deserialize with the plain ContextCarrier,
  Context.bind for snapshot-and-re-enter, the carrier config option, W3C baggage
  via Context.toBaggage/fromBaggage with BaggageKeyMap, and the traceparent
  helpers parseTraceparent/extractTraceparent/toTraceparent/randomTraceId. Also
  covers the process-global config and Context.resetConfig. Load when propagating
  context to a BullMQ job, durable workflow, timer, or another service.
metadata:
  type: core
  library: '@dudousxd/nestjs-context'
  library_version: 0.2.0
  framework: nestjs
sources:
  - DavideCarvalho/nestjs-context:packages/core/src/context.ts
  - DavideCarvalho/nestjs-context:packages/core/src/traceparent.ts
  - DavideCarvalho/nestjs-context:packages/core/src/baggage.ts
  - DavideCarvalho/nestjs-context:DESIGN.md
---

# Setup

AsyncLocalStorage does not cross a process/queue boundary on its own. Serialize
the context to a plain carrier on the producing side and re-hydrate it on the
consuming side.

```ts
import { Context } from '@dudousxd/nestjs-context';

// producer (where you enqueue) — snapshot the active context:
await queue.add('send-email', {
  to: 'a@b.com',
  __ctx: Context.serialize(), // { traceId, tenantId?, userRef? } | undefined
});

// consumer (the worker) — run the handler inside the re-hydrated context:
worker.process(async (job) => {
  await Context.deserialize(job.data.__ctx, async () => {
    // Context.traceId() / tenantId() / userRef() all work here
    await handle(job.data);
  });
});
```

The carrier carries no user entity and no DB connection — just the refs needed to
re-hydrate. By default it is `{ traceId, tenantId, userRef }`.

# Core Patterns

## Context.bind for timers and EventEmitter callbacks

ALS does not follow a callback registered now and run later (`setTimeout`,
`setInterval`, `emitter.on`, job callbacks). `Context.bind` snapshots the active
context and re-enters it on every later invocation.

```ts
import { Context } from '@dudousxd/nestjs-context';

setTimeout(Context.bind(() => {
  console.log(Context.traceId()); // the trace id from bind-time, not undefined
}), 1000);

emitter.on('done', Context.bind(() => audit(Context.userRef())));
```

`bind` passes through arguments, `this`, and the return value. If nothing is
active at bind time it returns the function unchanged (runs with no context).

## Include a custom field in the carrier

The default carrier is only `traceId`/`tenantId`/`userRef`. To make a
module-augmented field survive the boundary, list it in `carrier`.

```ts
ContextModule.forRoot({
  carrier: ['traceId', 'tenantId', 'userRef', 'locale'],
});
```

Or take full control with `serialize` / `deserialize` overrides (set both
together so a producer and consumer never mismatch).

## W3C baggage propagation across services

For a standards-compliant header any OTel-aware peer understands, use
`toBaggage`/`fromBaggage` instead of the bespoke carrier.

```ts
import { Context } from '@dudousxd/nestjs-context';

// outbound HTTP call — attach a real `baggage` header:
const headers: Record<string, string> = {};
const baggage = Context.toBaggage(); // "tenantId=t1,userRef=user%3A7" | undefined
if (baggage) headers.baggage = baggage;

// inbound — re-hydrate; traceId comes from the traceparent header or a fresh id:
Context.fromBaggage(req.headers.baggage, () => handle(req), {
  traceparent: req.headers.traceparent as string,
});
```

Map fields to namespaced keys (or disable one) via the `baggage` option:

```ts
ContextModule.forRoot({ baggage: { tenantId: 'acme.tenant', userRef: false } });
```

## Re-emit a faithful downstream traceparent

`toTraceparent` continues the upstream trace when the request captured one
(propagating the parent span-id and sampling flag), instead of minting a new one.

```ts
import { Context, toTraceparent } from '@dudousxd/nestjs-context';

const traceId = Context.traceId();
const upstream = Context.get()?.traceparent; // ParsedTraceparent | undefined
if (traceId) {
  outboundHeaders.traceparent = toTraceparent(traceId, upstream);
}
```

# Common Mistakes

### HIGH Reading context inside a setTimeout/EventEmitter callback

Wrong:

```ts
setTimeout(() => {
  audit(Context.traceId()); // undefined — ALS did not follow the timer
}, 1000);
```

Correct:

```ts
setTimeout(Context.bind(() => audit(Context.traceId())), 1000);
```

A callback registered now but invoked later runs outside the original async
chain, so the store is gone; `Context.bind` re-enters the snapshot on each call.

Source: packages/core/src/context.ts:280

### MEDIUM Custom field missing from the carrier

Wrong:

```ts
ContextModule.forRoot({}); // default carrier
await queue.add('job', { __ctx: Context.serialize() }); // locale is NOT included
```

Correct:

```ts
ContextModule.forRoot({ carrier: ['traceId', 'tenantId', 'userRef', 'locale'] });
```

`serialize()` only copies the carrier fields; an augmented field defaults out and
silently arrives `undefined` on the worker side.

Source: packages/core/src/context.ts:182; packages/core/src/types.ts:65

### HIGH Re-running fn after deserialize instead of inside it

Wrong:

```ts
Context.deserialize(job.data.__ctx, () => {});
await handle(job.data); // runs OUTSIDE the re-hydrated context
```

Correct:

```ts
await Context.deserialize(job.data.__ctx, () => handle(job.data));
```

`deserialize` only establishes the context for the duration of its `fn`; work
done after it returns sees no context.

Source: packages/core/src/context.ts:374

### MEDIUM Treating the carrier as a live view

Wrong:

```ts
const carrier = Context.serialize();
Context.set('tenantId', 't2');
// carrier.tenantId is still the old value — it was a snapshot
```

Correct:

```ts
// serialize at the moment you cross the boundary (e.g. right before queue.add)
await queue.add('job', { __ctx: Context.serialize() });
```

`serialize()` returns a snapshot taken at call time; later `set` calls do not
update an already-produced carrier. For long-running durable workflows the
carrier is the user/tenant from when it was dispatched, not the current one.

Source: packages/core/src/context.ts:365; DESIGN.md §5

### MEDIUM Forgetting resetConfig between apps/tests

Wrong:

```ts
// test A configures a custom carrier; test B inherits it
ContextModule.forRoot({ carrier: ['traceId', 'locale'] });
// ...next test sees locale in the carrier and the second-forRoot warning
```

Correct:

```ts
import { Context } from '@dudousxd/nestjs-context';
afterEach(() => Context.resetConfig());
```

The carrier/serialize/baggage config is a process-global singleton replaced
wholesale on each `forRoot`; without `resetConfig` one app/test bleeds into the
next and a differing second `forRoot` logs a warning.

Source: packages/core/src/context.ts:318
