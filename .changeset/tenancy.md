---
'@dudousxd/nestjs-context': minor
---

Tenancy: the request's tenant (the customer the data belongs to) as part of the context. Off by default; nothing changes until you turn it on.

- `TenantRef { id, kind, source, slug?, role? }`. The store gains `tenant` and `tenantScope`; `tenantId` stays in sync with `tenant.id`. A plain `tenantId` reads as `{ id, kind: 'unknown', source: 'legacy' }`.
- `Context.tenant()`, `Context.setTenant(ref | null)`, `Context.withTenant(ref, fn)` (creates a store when there is none), `Context.allTenants(fn)`, `Context.tenancy()` and `Context.tenantFilter()` (modes `system`, `all`, `tenantless`, `tenant`).
- `ContextModule.forRoot({ tenancy: { enabled, kinds } })`. When enabled, `tenant` and `tenantId` always ride the default carrier (even when the `carrier` list leaves them out); a custom `serialize`/`deserialize` decides for itself and the tenant is never added behind it. Baggage carries `tenantKind`, and one boot line says so. The default carrier also carries `tenant` whenever one is set.
- `ContextAccessor` gains optional `tenant()`, `tenancy()` and `tenantFilter()`. A custom accessor bound to `CONTEXT_ACCESSOR` keeps compiling; add them (delegate to `Context`) for tenancy to reach the other libs through it. `ContextModule` now publishes the accessor on the diagnostics global slot even when `@dudousxd/nestjs-diagnostics` is not installed.
- New "Tenancy" docs page, with the local reader other libs copy.
- `ContextCarrier` has an index signature, so a carrier passes where a plain record is expected (e.g. durable's `context` option).
