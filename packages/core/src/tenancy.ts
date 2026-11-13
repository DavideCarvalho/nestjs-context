import { ForbiddenException } from '@nestjs/common';

/**
 * Where a {@link TenantRef} came from.
 *
 * - `app`: set by application code (`Context.setTenant`, `Context.withTenant`, or a
 *   `tenant` returned from `initialize`/an enricher).
 * - `carrier`: restored from a queue/durable/process carrier or a `baggage` header.
 * - `personal`: the signed-in user as a `kind: 'user'` tenant (`tenancy.personal`).
 * - `legacy`: only a plain `tenantId` was written, so no kind is known.
 */
export type TenantSource = 'app' | 'carrier' | 'personal' | 'legacy';

/** One level of a tenant hierarchy, e.g. a clinic, or a unit inside it. */
export interface TenantLevel {
  /** Stable key. Libs stamp and compare rows by this id. */
  id: string;
  /** What this level is: `'organization'`, `'user'`, `'clinic'`, `'unit'`, … */
  kind: 'organization' | 'user' | (string & {});
  /** Display only, never a key. */
  slug?: string;
  /** The caller's role inside this level. Display/authz input only. */
  role?: string;
}

/**
 * The active tenant: the customer (organization, user workspace, clinic, …) the
 * data of this request belongs to. When tenants nest, it is the most specific
 * level, and `chain` holds the whole active path.
 */
export interface TenantRef extends TenantLevel {
  /** Where this ref came from. */
  source: TenantSource;
  /**
   * The active path when tenants nest, root first and this tenant last
   * (e.g. `[clinic, unit]`). Absent for a flat tenant.
   */
  chain?: TenantLevel[];
  /**
   * The tenant family, when a request carries more than one (e.g. a patient's
   * `account` next to the `clinic`). Unset on the primary tenant unless the app
   * names it.
   */
  family?: string;
}

/** What `Context.setTenant` / `Context.withTenant` accept. `source` defaults to `'app'`. */
export type TenantInput = Omit<TenantRef, 'id' | 'source' | 'chain'> & {
  id: string | number;
  source?: TenantSource;
  /** Levels above this tenant, root first. This tenant may be the last item or left out. */
  chain?: Array<Omit<TenantLevel, 'id'> & { id: string | number }>;
};

/**
 * The signed-in user as their own tenant. Accepted by `Context.setTenant` /
 * `Context.withTenant` only with `tenancy.personal` on; the id comes from the
 * context's `userRef`.
 */
export interface PersonalTenantInput {
  kind: 'user';
  id?: undefined;
  slug?: string;
  role?: string;
}

/** Options for `Context.setTenant` / `Context.withTenant`. */
export interface SetTenantOptions {
  /**
   * Write a tenant of this family next to the primary tenant, instead of the
   * primary tenant (the one `tenantId` mirrors).
   */
  family?: string;
}

/**
 * Resolves the display label of a tenant, for console "Organization" pickers and
 * reports. Return `undefined` to fall back to the tenant's `slug`, then its id.
 */
export type TenantLabelResolver = (
  tenant: TenantLevel,
) => string | undefined | Promise<string | undefined>;

/** The `tenancy` option of `ContextModule.forRoot`. */
export interface TenancyConfig {
  /**
   * The single switch. `true` makes every lib whose own `tenancy` option is
   * `'inherit'` (the default) scope its data by the active tenant, and always puts
   * the tenant on the cross-process carrier.
   * @default false
   */
  enabled?: boolean;
  /**
   * Allow-list of tenant kinds libs honour. With nested tenants, the filter scopes
   * by the most specific level of the chain whose kind is listed. A tenant with no
   * listed level counts as no tenant.
   */
  kinds?: string[];
  /**
   * Make a missing tenant an error: a tenant-scoped read or write with no tenant
   * throws `TenantRequiredError` (403) instead of running as `tenantless`.
   * @default false
   */
  required?: boolean;
  /**
   * Personal workspaces: a signed-in user (`userRef`) with no tenant counts as a
   * `{ id: userRef.id, kind: 'user' }` tenant, and `Context.setTenant({ kind: 'user' })`
   * sets it explicitly.
   * @default false
   */
  personal?: boolean;
  /** Display labels for tenants, used by consoles. See {@link TenantLabelResolver}. */
  label?: TenantLabelResolver;
}

/** {@link TenancyConfig} with defaults applied, as `Context.tenancy()` returns it. */
export interface ResolvedTenancy {
  enabled: boolean;
  kinds?: string[];
  required: boolean;
  personal: boolean;
}

/** How a lib must scope a read or a write right now. */
export type TenantFilter =
  /** No active context (boot, lib-internal workers, scripts): do not filter. */
  | { mode: 'system' }
  /** Inside `Context.allTenants()`: every row, with or without a tenant. */
  | { mode: 'all' }
  /** A context with no (matching) tenant: only rows with no tenant. */
  | { mode: 'tenantless' }
  /**
   * A context with a tenant: only that tenant's rows. Writes are stamped with
   * `tenant.id`. `tenant` is the level that matched `kinds`; `chain` is the path
   * down to it, root first.
   */
  | { mode: 'tenant'; tenant: TenantRef; chain: TenantLevel[] };

/** Options a lib passes to `tenantFilter()`. */
export interface TenantFilterOptions {
  /** The lib's own kind allow-list. Falls back to `tenancy.kinds` of the context config. */
  kinds?: string[];
  /** Only consider the tenant of this family. */
  family?: string;
  /**
   * Throw `TenantRequiredError` instead of answering `tenantless`. Falls back to
   * `tenancy.required` (when tenancy is enabled).
   */
  required?: boolean;
}

/**
 * Thrown when a tenant is required (`tenancy.required`, `Context.requireTenant()`)
 * and the current context has none. A `403 Forbidden` for Nest's exception filter.
 */
export class TenantRequiredError extends ForbiddenException {
  readonly code = 'E_TENANT_REQUIRED';

  constructor(
    message = 'This action needs an active tenant (organization). Select one and retry.',
  ) {
    // The code travels in the HTTP body too, so clients can tell this 403 apart.
    super({ statusCode: 403, error: 'Forbidden', code: 'E_TENANT_REQUIRED', message });
    this.name = 'TenantRequiredError';
  }
}

export function resolveTenancy(config: TenancyConfig | undefined): ResolvedTenancy {
  const resolved: ResolvedTenancy = {
    enabled: config?.enabled === true,
    required: config?.required === true,
    personal: config?.personal === true,
  };
  if (config?.kinds !== undefined) {
    resolved.kinds = [...config.kinds];
  }
  return resolved;
}

function toLevel(input: Omit<TenantLevel, 'id'> & { id: string | number }): TenantLevel {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('[nestjs-context] A tenant must be an object with an `id` and a `kind`.');
  }
  const id = input.id === undefined || input.id === null ? '' : String(input.id);
  if (id === '') {
    throw new TypeError('[nestjs-context] A tenant needs a non-empty `id`.');
  }
  if (typeof input.kind !== 'string' || input.kind === '') {
    throw new TypeError('[nestjs-context] A tenant needs a non-empty string `kind`.');
  }
  for (const key of ['slug', 'role'] as const) {
    if (input[key] !== undefined && typeof input[key] !== 'string') {
      throw new TypeError(`[nestjs-context] A tenant's \`${key}\` must be a string.`);
    }
  }
  const level: TenantLevel = { id, kind: input.kind };
  if (input.slug !== undefined) level.slug = input.slug;
  if (input.role !== undefined) level.role = input.role;
  return level;
}

/** Validate and normalize a {@link TenantInput} into a stored {@link TenantRef}. */
export function toTenantRef(input: TenantInput, fallbackSource: TenantSource = 'app'): TenantRef {
  const level = toLevel(input);
  const ref: TenantRef = { ...level, source: input.source ?? fallbackSource };
  if (input.family !== undefined) {
    if (typeof input.family !== 'string' || input.family === '') {
      throw new TypeError("[nestjs-context] A tenant's `family` must be a non-empty string.");
    }
    ref.family = input.family;
  }
  if (input.chain !== undefined && input.chain !== null) {
    if (!Array.isArray(input.chain)) {
      throw new TypeError("[nestjs-context] A tenant's `chain` must be an array of levels.");
    }
    const chain = input.chain.map(toLevel);
    const last = chain[chain.length - 1];
    if (last === undefined || last.id !== level.id || last.kind !== level.kind) {
      chain.push(level);
    } else {
      // The tenant's own fields win over a stale copy at the end of the chain.
      chain[chain.length - 1] = level;
    }
    if (chain.length > 1) {
      ref.chain = chain;
    }
  }
  return ref;
}

/** A tenant known only by a plain `tenantId`. */
export function legacyTenant(id: string): TenantRef {
  return { id, kind: 'unknown', source: 'legacy' };
}

/** A copy of a level with only the level fields. */
function levelOf(ref: TenantLevel): TenantLevel {
  const level: TenantLevel = { id: ref.id, kind: ref.kind };
  if (ref.slug !== undefined) level.slug = ref.slug;
  if (ref.role !== undefined) level.role = ref.role;
  return level;
}

/** A deep copy of a ref, so callers can never rewrite the active store. */
export function copyTenant(ref: TenantRef): TenantRef {
  const copy: TenantRef = { ...ref };
  if (ref.chain !== undefined) copy.chain = ref.chain.map(levelOf);
  return copy;
}

/** The active path of a ref, root first (a flat tenant is a chain of one). */
export function chainOf(ref: TenantRef): TenantLevel[] {
  return ref.chain !== undefined && ref.chain.length > 0 ? ref.chain.map(levelOf) : [levelOf(ref)];
}

/**
 * Pick the tenant a lib scopes by, from the request's primary tenant and its
 * other families. With `family`, only that family's tenant counts. Without
 * `kinds`, the primary tenant is the answer (other families only count when a
 * lib names them by `kinds` or `family`). With `kinds`, each candidate's chain is
 * walked from the most specific level up to the root, primary first, and the
 * first level whose kind is listed wins, returned as a ref of its own with the
 * chain cut at that level.
 */
export function matchTenant(
  primary: TenantRef | undefined,
  families: readonly TenantRef[],
  kinds: string[] | undefined,
  family: string | undefined,
): { tenant: TenantRef; chain: TenantLevel[] } | undefined {
  const all = primary === undefined ? [...families] : [primary, ...families];
  const candidates =
    family !== undefined
      ? all.filter((ref) => ref.family === family)
      : kinds === undefined
        ? primary === undefined
          ? []
          : [primary]
        : all;
  for (const ref of candidates) {
    const chain = chainOf(ref);
    if (kinds === undefined) {
      return { tenant: copyTenant(ref), chain };
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const level = chain[i] as TenantLevel;
      if (!kinds.includes(level.kind)) continue;
      if (i === chain.length - 1) {
        return { tenant: copyTenant(ref), chain };
      }
      const cut = chain.slice(0, i + 1);
      const tenant: TenantRef = { ...level, source: ref.source };
      if (ref.family !== undefined) tenant.family = ref.family;
      if (cut.length > 1) tenant.chain = cut.map(levelOf);
      return { tenant, chain: cut };
    }
  }
  return undefined;
}
