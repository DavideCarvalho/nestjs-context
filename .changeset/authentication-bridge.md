---
"@dudousxd/nestjs-context": minor
---

Bridge to the official `@nestjs/authentication` (optional peer, `>=0.1.5`). Read the user from its `AuthenticationContext`; nestjs-context only carries a reference to it across processes.

- `ContextAuthenticationInterceptor` (registered by `ContextModule`) sets `userRef` from `AuthenticationContext.user`, mapped by the new `userRefFrom` option (default `{ type: 'user', id: user.id }`). Import `ContextModule` after `AuthenticationModule` so it runs inside the official interceptor. If it's imported first, it warns once.
- `ContextRunner.run(carrier, fn)` (injectable) = `Context.deserialize` + `AuthenticationContext.run(await rehydrateUser(carrier.userRef), fn)`, using the new `rehydrateUser` option. The carrier never holds the user or the session.
