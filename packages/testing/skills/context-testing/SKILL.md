---
name: context-testing
description: >
  Test code that reads @dudousxd/nestjs-context by running it inside a fake store.
  Covers @dudousxd/nestjs-context-testing's runWithContext(partial, fn) which
  scopes a fake ContextStore around fn (auto-filling a random traceId), and
  enterContext(partial) which uses enterWith so the fake store survives past the
  setup call (for code that reads context after an await). Covers PartialContextStore
  and resetting the process-global singleton with Context.resetConfig between
  tests. Load when writing vitest/jest tests that assert on Context.traceId,
  tenantId, or userRef.
metadata:
  type: core
  library: '@dudousxd/nestjs-context-testing'
  library_version: 0.2.0
  framework: nestjs
sources:
  - DavideCarvalho/nestjs-context:packages/testing/src/index.ts
  - DavideCarvalho/nestjs-context:packages/testing/test/run-with-context.spec.ts
  - DavideCarvalho/nestjs-context:packages/core/src/context.ts
---

# Setup

`runWithContext` runs `fn` inside a fake `ContextStore`. Every field except
`traceId` is optional, and `traceId` is auto-filled with a random W3C-shaped id
when omitted, so a test sets only what it asserts on.

```ts
import { describe, expect, it } from 'vitest';
import { Context } from '@dudousxd/nestjs-context';
import { runWithContext } from '@dudousxd/nestjs-context-testing';

describe('OrderService', () => {
  it('reads tenant + user from context', () => {
    runWithContext({ tenantId: 't1', userRef: { type: 'user', id: 7 } }, () => {
      expect(Context.tenantId()).toBe('t1');
      expect(Context.userRef()).toEqual({ type: 'user', id: 7 });
      expect(Context.traceId()).toMatch(/^[0-9a-f]{32}$/); // auto-filled
    });
  });
});
```

# Core Patterns

## Assert on a service that reads the context

```ts
import { runWithContext } from '@dudousxd/nestjs-context-testing';

it('stamps the trace id onto the audit record', () => {
  const record = runWithContext({ traceId: 'abc' }, () => auditService.record({ x: 1 }));
  expect(record.traceId).toBe('abc');
});
```

## enterContext for code that reads after an await

`enterContext` uses `enterWith`, so the fake store outlives the setup call —
useful when the code under test reads the context after the test's `await`.

```ts
import { Context } from '@dudousxd/nestjs-context';
import { enterContext } from '@dudousxd/nestjs-context-testing';

it('keeps context across an await', async () => {
  enterContext({ tenantId: 't1' });
  await Promise.resolve();
  expect(Context.tenantId()).toBe('t1');
});
```

## Reset the process-global config between tests

When a test exercises `ContextModule.forRoot`/`forRootAsync` (which configures
the singleton's carrier/serialize/enrichers/baggage), reset it so it does not
bleed into the next test.

```ts
import { afterEach } from 'vitest';
import { Context } from '@dudousxd/nestjs-context';

afterEach(() => {
  Context.resetConfig();
  Context.resetSetWarning(); // re-arm the one-shot set-outside-context warning
});
```

# Common Mistakes

### HIGH Asserting on Context.* outside the runWithContext callback

Wrong:

```ts
runWithContext({ tenantId: 't1' }, () => service.run());
expect(Context.tenantId()).toBe('t1'); // undefined — scope already closed
```

Correct:

```ts
runWithContext({ tenantId: 't1' }, () => {
  service.run();
  expect(Context.tenantId()).toBe('t1');
});
```

`runWithContext` uses `Context.run`, so the fake store exists only for the
duration of the callback; reads after it returns see no context. Use
`enterContext` when you must read afterward.

Source: packages/testing/src/index.ts:22

### MEDIUM Constructing a full ContextStore by hand

Wrong:

```ts
Context.run({ traceId: 'x', tenantId: 't1' }, () => service.run()); // must spell out traceId
```

Correct:

```ts
runWithContext({ tenantId: 't1' }, () => service.run()); // traceId auto-filled
```

`runWithContext` takes a `PartialContextStore` and fills `traceId` with a random
id, so tests need not invent a 32-hex trace id just to satisfy the invariant.

Source: packages/testing/src/index.ts:6

### MEDIUM Leaking singleton config across tests

Wrong:

```ts
it('a', () => { ContextModule.forRoot({ carrier: ['traceId', 'locale'] }); });
it('b', () => { /* still sees locale in the carrier from test a */ });
```

Correct:

```ts
afterEach(() => Context.resetConfig());
```

`forRoot` mutates a process-global singleton; without `resetConfig` one test's
carrier/enrichers persist and a differing second `forRoot` logs a warning.

Source: packages/core/src/context.ts:354
