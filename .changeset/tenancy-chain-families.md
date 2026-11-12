---
'@dudousxd/nestjs-context': minor
---

Tenancy: nested tenants, tenant families, required tenants, personal tenants and labels. All additive and off until you use them.

- `TenantRef` gains `chain` (the active levels, root first, e.g. clinic → unit) and `family`. Set them with `Context.setTenant({ id, kind, chain })` and `Context.setTenant(ref, { family })`; read them with `Context.tenants()` and `Context.tenantChain(family?)`.
- `tenantFilter({ kinds })` is level-aware: it scopes by the most specific level of the chain whose kind is listed, and returns that level as `tenant` plus the `chain` down to it. New `family` and `required` filter options.
- `tenancy.required`: a tenant-scoped read or write with no tenant throws `TenantRequiredError` (403, `E_TENANT_REQUIRED`) instead of running as tenantless. New `Context.requireTenant()`.
- `tenancy.personal`: a signed-in user with no tenant counts as a `{ kind: 'user' }` tenant, and `Context.setTenant({ kind: 'user' })` takes the id from `userRef`.
- `tenancy.label(tenant)`: display labels for console tenant pickers, read with `Context.tenantLabel()` / `Context.tenantLabels()`; libs can register one with `Context.setTenantLabeler()`.
- The accessor gains `tenants`, `tenantChain`, `requireTenant`, `tenantLabel` and `tenantLabels`, and `ContextModule` also publishes a versioned read/write tenancy slot on `Symbol.for('@dudousxd/nestjs-context:tenancy')` (`version: 1`). Libs that read the existing accessor slot keep working unchanged.
