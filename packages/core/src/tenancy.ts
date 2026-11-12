/**
 * Where a {@link TenantRef} came from.
 *
 * - `app`: set by application code (`Context.setTenant`, `Context.withTenant`, or a
 *   `tenant` returned from `initialize`/an enricher).
 * - `carrier`: restored from a queue/durable/process carrier or a `baggage` header.
 * - `legacy`: only a plain `tenantId` was written, so no kind is known.
 */
export type TenantSource = 'app' | 'carrier' | 'legacy';

/**
 * The active tenant: the customer (organization, user workspace, clinic, …) the
 * data of this request belongs to.
 */
export interface TenantRef {
  /** Stable key. Libs stamp and compare rows by this id. */
  id: string;
  /** What the tenant is. `'unknown'` when only a plain `tenantId` was written. */
  kind: 'organization' | 'user' | (string & {});
  /** Where this ref came from. */
  source: TenantSource;
  /** Display only, never a key. */
  slug?: string;
  /** The caller's role inside this tenant. Display/authz input only. */
  role?: string;
}

/** What `Context.setTenant` / `Context.withTenant` accept. `source` defaults to `'app'`. */
export type TenantInput = Omit<TenantRef, 'id' | 'source'> & {
  id: string | number;
  source?: TenantSource;
};

/** The `tenancy` option of `ContextModule.forRoot`. */
export interface TenancyConfig {
  /**
   * The single switch. `true` makes every lib whose own `tenancy` option is
   * `'inherit'` (the default) scope its data by the active tenant, and always puts
   * the tenant on the cross-process carrier.
   * @default false
   */
  enabled?: boolean;
  /** Allow-list of tenant kinds libs honour. A tenant of another kind counts as no tenant. */
  kinds?: string[];
}

/** {@link TenancyConfig} with defaults applied, as `Context.tenancy()` returns it. */
export interface ResolvedTenancy {
  enabled: boolean;
  kinds?: string[];
}

/** How a lib must scope a read or a write right now. */
export type TenantFilter =
  /** No active context (boot, lib-internal workers, scripts): do not filter. */
  | { mode: 'system' }
  /** Inside `Context.allTenants()`: every row, with or without a tenant. */
  | { mode: 'all' }
  /** A context with no tenant (or one of a kind outside `kinds`): only rows with no tenant. */
  | { mode: 'tenantless' }
  /** A context with a tenant: only that tenant's rows. Writes are stamped with `tenant.id`. */
  | { mode: 'tenant'; tenant: TenantRef };

/** Options a lib passes to `tenantFilter()`. */
export interface TenantFilterOptions {
  /** The lib's own kind allow-list. Falls back to `tenancy.kinds` of the context config. */
  kinds?: string[];
}

export function resolveTenancy(config: TenancyConfig | undefined): ResolvedTenancy {
  const resolved: ResolvedTenancy = { enabled: config?.enabled === true };
  if (config?.kinds !== undefined) {
    resolved.kinds = [...config.kinds];
  }
  return resolved;
}

/** Validate and normalize a {@link TenantInput} into a stored {@link TenantRef}. */
export function toTenantRef(input: TenantInput, fallbackSource: TenantSource = 'app'): TenantRef {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('[nestjs-context] A tenant must be an object with an `id` and a `kind`.');
  }
  const id = input.id === undefined || input.id === null ? '' : String(input.id);
  if (id === '') {
    throw new TypeError('[nestjs-context] A tenant needs a non-empty `id`.');
  }
  const ref: TenantRef = {
    id,
    kind: input.kind || 'unknown',
    source: input.source ?? fallbackSource,
  };
  if (input.slug !== undefined) ref.slug = input.slug;
  if (input.role !== undefined) ref.role = input.role;
  return ref;
}

/** A tenant known only by a plain `tenantId`. */
export function legacyTenant(id: string): TenantRef {
  return { id, kind: 'unknown', source: 'legacy' };
}
