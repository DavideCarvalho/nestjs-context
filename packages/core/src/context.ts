import { AsyncLocalStorage } from 'node:async_hooks';
import {
  type BaggageKeyMap,
  decodeBaggage,
  decodeUserRef,
  encodeBaggage,
  encodeUserRef,
  resolveBaggageKeys,
} from './baggage.js';
import {
  type ResolvedTenancy,
  type TenancyConfig,
  type TenantFilter,
  type TenantFilterOptions,
  type TenantInput,
  type TenantRef,
  legacyTenant,
  resolveTenancy,
  toTenantRef,
} from './tenancy.js';
import { type ParsedTraceparent, extractTraceparent, randomTraceId } from './traceparent.js';

/**
 * Stable reference to a principal — `{ type, id }`, never the full user object.
 * Keeping a ref (not the entity) is what makes the store serializable across
 * boundaries (queue, durable worker, sub-process). See DESIGN §2/§5.
 */
export interface UserRef {
  type: string;
  id: string | number;
}

/**
 * The per-request context held in the module-level AsyncLocalStorage.
 *
 * Open for extension via module augmentation — other ecosystem libs add fields:
 *
 * ```ts
 * declare module '@dudousxd/nestjs-context' {
 *   interface ContextStore {
 *     locale?: string;
 *   }
 * }
 * ```
 */
export interface ContextStore {
  traceId: string;
  requestId?: string;
  userRef?: UserRef;
  /** The active tenant's id. Always equal to `tenant.id` when a tenant is set. */
  tenantId?: string;
  /**
   * The active tenant. Write it with {@link Context.setTenant}, which also sets
   * `tenantId`. Read it with {@link Context.tenant}.
   */
  tenant?: TenantRef;
  /**
   * `'all'` inside {@link Context.allTenants}. Process-local: never carried
   * across a boundary.
   */
  tenantScope?: 'all';
  /**
   * The parsed upstream `traceparent` (span-id + trace-flags), captured at
   * request start. Lets a re-emitted `traceparent` faithfully continue the
   * distributed trace — propagating the parent span-id and the upstream
   * sampling decision — instead of fabricating a new one. Process-local only:
   * intentionally NOT part of the default cross-process carrier. See
   * {@link toTraceparent}.
   */
  traceparent?: ParsedTraceparent;
}

/**
 * Plain, serializable snapshot of the context safe to send across a process /
 * queue / durable boundary. Carries no user entity nor DB connection — just the
 * refs needed to re-hydrate on the other side. See DESIGN §5.
 */
export interface ContextCarrier {
  /** Extra fields a custom `serialize` adds; also lets a carrier pass where a plain record is expected. */
  [key: string]: unknown;
  traceId: string;
  tenantId?: string;
  /** The active tenant, when one was set with a kind (see {@link Context.setTenant}). */
  tenant?: TenantRef;
  userRef?: UserRef;
}

/**
 * Module-level singleton store. Lives outside the DI container on purpose so it
 * can be read from places Nest cannot inject into: ORM subscribers, queue
 * workers, the durable worker, plain functions. Mirrors `telescope-context.ts`
 * and `filterAls` from the sibling libs.
 */
const als = new AsyncLocalStorage<ContextStore>();

/**
 * An enricher: a function that populates derived values onto the active context.
 * Run eagerly by {@link Context.runEnrichers} (the middleware calls it right
 * after entering the context). May either return a `Partial<ContextStore>` that
 * is merged into the store, or mutate the passed `store` directly and return
 * nothing. The optional `req` is forwarded from the middleware so an enricher
 * can derive from request data. Errors thrown by one enricher are swallowed so
 * they never break the request or the other enrichers.
 */
export type ContextEnricher = (
  store: ContextStore,
  req?: unknown,
) => Partial<ContextStore> | undefined;

/**
 * Configures the cross-boundary behaviour of the singleton. Comes from
 * `ContextModule.forRoot` (DI) but lands here once at module init via
 * {@link Context.configure}, because the singleton lives outside the container.
 * See DESIGN §4.1 level 4.
 */
export interface ContextConfig {
  /** Store fields included by the default {@link Context.serialize}. */
  carrier?: (keyof ContextStore)[];
  /** Full override of {@link Context.serialize}. */
  serialize?: (store: ContextStore) => ContextCarrier;
  /** Full override of {@link Context.deserialize}'s carrier→store step. */
  deserialize?: (carrier: ContextCarrier) => ContextStore;
  /**
   * Baggage key mapping for {@link Context.toBaggage}/{@link Context.fromBaggage}
   * — the standards-compliant W3C `baggage` propagation option. Defaults to the
   * field names (`tenantId`, `userRef`); set a custom key to namespace it, or
   * `false` to never propagate that field over baggage. Independent of the
   * bespoke {@link ContextCarrier} path, which is unaffected.
   */
  baggage?: BaggageKeyMap;
  /**
   * Eager enrichers run by {@link Context.runEnrichers} (which the middleware
   * calls right after entering the context) to populate derived store fields —
   * e.g. a `displayName` derived from `tenantId`, a region from a header. For
   * values better computed on first use, prefer the lazy {@link Context.lazy}.
   */
  enrichers?: ContextEnricher[];
  /**
   * Tenancy: scope data by the active tenant across every lib that inherits it.
   * Off by default. When on, `tenant` and `tenantId` always ride the carrier.
   */
  tenancy?: TenancyConfig;
}

/**
 * Module-level config. Empty until `forRoot` calls {@link Context.configure},
 * so `serialize`/`deserialize` keep their default behaviour out of the box.
 *
 * PROCESS-GLOBAL: this is shared across every `ContextModule.forRoot` in the
 * process. In multi-app (one process hosting several Nest apps) or multi-test
 * scenarios, call {@link Context.resetConfig} between apps/tests so one app's
 * carrier/serialize/deserialize never bleeds into another. See DESIGN §4.1.
 */
let config: ContextConfig = {};

/** {@link ContextConfig.tenancy} with defaults applied. */
let tenancy: ResolvedTenancy = resolveTenancy(undefined);

const SYSTEM_FILTER: TenantFilter = Object.freeze({ mode: 'system' as const });
const ALL_FILTER: TenantFilter = Object.freeze({ mode: 'all' as const });
const TENANTLESS_FILTER: TenantFilter = Object.freeze({ mode: 'tenantless' as const });

/** Whether {@link Context.configure} has already set a non-empty config. */
let configured = false;

function configsConflict(a: ContextConfig, b: ContextConfig): boolean {
  const carrierA = JSON.stringify(a.carrier);
  const carrierB = JSON.stringify(b.carrier);
  const baggageA = JSON.stringify(a.baggage);
  const baggageB = JSON.stringify(b.baggage);
  return (
    carrierA !== carrierB ||
    baggageA !== baggageB ||
    a.serialize !== b.serialize ||
    a.deserialize !== b.deserialize ||
    JSON.stringify(a.tenancy) !== JSON.stringify(b.tenancy) ||
    // Enrichers are function arrays — compare by reference (same approach as the
    // serialize/deserialize fns): a distinct array is treated as a config change.
    a.enrichers !== b.enrichers
  );
}

/** One-shot guard so the missing-traceId warning is not spammed per request. */
let warnedMissingTraceId = false;

/** One-shot guard so the out-of-context `set` warning is not spammed. */
let warnedSetOutsideContext = false;

function warnSetOutsideContext(what: string): void {
  if (!warnedSetOutsideContext) {
    warnedSetOutsideContext = true;
    console.warn(
      `[nestjs-context] ${what} was called with no active context, so it was a no-op and the value was dropped. This usually means the code (e.g. an auth guard) ran on a path the ContextMiddleware did not cover, or outside any Context.run/enterWith scope. Ensure the context is established first. This warning fires once per process.`,
    );
  }
}

/** The stored `tenant`, when it agrees with `tenantId` (a later `tenantId` write wins). */
function storedTenant(store: ContextStore): TenantRef | undefined {
  const tenant = store.tenant;
  if (tenant === undefined || tenant === null) {
    return undefined;
  }
  return store.tenantId === undefined || store.tenantId === tenant.id ? tenant : undefined;
}

/** The active tenant of a store: the stored ref, else a legacy ref from a plain `tenantId`. */
function tenantOf(store: ContextStore): TenantRef | undefined {
  const tenant = storedTenant(store);
  if (tenant !== undefined) {
    return tenant;
  }
  const id = store.tenantId;
  return id !== undefined && id !== '' ? legacyTenant(id) : undefined;
}

/** Set (or clear, with `undefined`) both tenant fields of a store. */
function writeTenant(store: ContextStore, ref: TenantRef | undefined): void {
  if (ref === undefined) {
    // biome-ignore lint/performance/noDelete: an absent key, not an `undefined` one.
    delete store.tenant;
    // biome-ignore lint/performance/noDelete: an absent key, not an `undefined` one.
    delete store.tenantId;
    return;
  }
  store.tenant = ref;
  store.tenantId = ref.id;
}

/**
 * Bring `tenant` and `tenantId` into agreement on a store assembled by hand
 * (`initialize`, enrichers, a custom `deserialize`): a `tenant` is normalized and
 * fills a missing `tenantId`; a `tenant` that disagrees with `tenantId`, or is
 * malformed, is dropped, so `tenantId` wins.
 */
export function syncTenantFields(store: ContextStore): ContextStore {
  const raw = store.tenant as TenantInput | undefined | null;
  if (raw === undefined) {
    return store;
  }
  let ref: TenantRef | undefined;
  try {
    ref = raw === null ? undefined : toTenantRef(raw, raw.source ?? 'app');
  } catch {
    ref = undefined;
  }
  if (ref === undefined || (store.tenantId !== undefined && store.tenantId !== ref.id)) {
    // biome-ignore lint/performance/noDelete: an absent key, not an `undefined` one.
    delete store.tenant;
    return store;
  }
  store.tenant = ref;
  store.tenantId = ref.id;
  return store;
}

/** With tenancy on, put the tenant on a carrier even if the carrier config left it out. */
function addTenantToCarrier(store: ContextStore, input: ContextCarrier): ContextCarrier {
  const tenant = tenantOf(store);
  if (tenant === undefined) {
    return input;
  }
  // A copy: a custom `serialize` may return a frozen or shared object.
  const carrier: ContextCarrier = { ...input };
  if (carrier.tenantId === undefined) {
    carrier.tenantId = tenant.id;
  }
  if (
    carrier.tenant === undefined &&
    tenant.source !== 'legacy' &&
    carrier.tenantId === tenant.id
  ) {
    carrier.tenant = { ...tenant };
  }
  return carrier;
}

function ensureTraceId(store: ContextStore): ContextStore {
  // A cross-process carrier may arrive missing/empty `traceId` (e.g. produced by
  // a different runtime). The ContextStore.traceId invariant is `string`, so we
  // synthesize one rather than propagate `undefined` (which breaks telescope/
  // durable correlation). See P9 / DESIGN §5.
  if (!store.traceId) {
    if (!warnedMissingTraceId) {
      warnedMissingTraceId = true;
      console.warn(
        '[nestjs-context] Received a carrier with no traceId; generating a ' +
          'fresh one to preserve the ContextStore.traceId invariant.',
      );
    }
    store.traceId = randomTraceId();
  }
  return store;
}

function carriedTenant(carrier: ContextCarrier): TenantRef | undefined {
  if (carrier.tenant === undefined || carrier.tenant === null) {
    return undefined;
  }
  try {
    return toTenantRef({ ...carrier.tenant, source: 'carrier' });
  } catch {
    return undefined;
  }
}

function fromCarrier(carrier: ContextCarrier): ContextStore {
  if (config.deserialize) {
    // A custom `deserialize` is the app's own decision about what it trusts from a
    // carrier: the tenant is restored only if it returns one (never added behind it).
    const store = config.deserialize(carrier);
    // A carrier never grants the `allTenants` bypass.
    // biome-ignore lint/performance/noDelete: an absent key, not an `undefined` one.
    delete store.tenantScope;
    return syncTenantFields(ensureTraceId(store));
  }
  const store: ContextStore = { traceId: carrier.traceId };
  if (carrier.tenantId !== undefined) {
    store.tenantId = carrier.tenantId;
  }
  const tenant = carriedTenant(carrier);
  if (tenant !== undefined) {
    store.tenant = tenant;
  }
  if (carrier.userRef !== undefined) {
    store.userRef = carrier.userRef;
  }
  return syncTenantFields(ensureTraceId(store));
}

function defaultSerialize(store: ContextStore): ContextCarrier {
  const fields = config.carrier;
  // Fast path: the default carrier (no `config.carrier` override) is the common
  // case, so hand-roll it and skip the per-iteration `traceId` filter + loose
  // Record. Behaviour is identical to the generic loop over the former
  // default carrier `['traceId', 'tenantId', 'userRef']`.
  if (fields === undefined) {
    const c: ContextCarrier = { traceId: store.traceId };
    const tenant = storedTenant(store);
    const tenantId = store.tenantId ?? tenant?.id;
    if (tenantId !== undefined) {
      c.tenantId = tenantId;
    }
    if (tenant !== undefined) {
      c.tenant = tenant;
    }
    if (store.userRef !== undefined) {
      c.userRef = store.userRef;
    }
    return c;
  }
  // `traceId` is always present on a carrier.
  const carrier: Record<string, unknown> = { traceId: store.traceId };
  for (const field of fields) {
    // `tenantScope` is the in-process `allTenants` bypass: it never travels.
    if (field === 'traceId' || field === 'tenantScope') {
      continue;
    }
    const value = store[field];
    if (value !== undefined) {
      carrier[field] = value;
    }
  }
  const result = carrier as unknown as ContextCarrier;
  return tenancy.enabled ? addTenantToCarrier(store, result) : result;
}

export const Context = {
  /** Run `fn` with `store` as the active context for `fn` and its descendants. */
  run<T>(store: ContextStore, fn: () => T): T {
    return als.run(store, fn);
  },

  /**
   * Establish `store` as the active context for the current async execution and
   * all its descendants, WITHOUT a callback scope. Used by the middleware so the
   * context survives the middleware return and reaches the async handler,
   * guards, and interceptors. See DESIGN §3.
   */
  enterWith(store: ContextStore): void {
    als.enterWith(store);
  },

  /** The active store, or `undefined` outside any context. Never throws. */
  get(): ContextStore | undefined {
    return als.getStore();
  },

  /**
   * Mutate a field on the active store (e.g. the auth guard sets `userRef`
   * after the middleware already entered the context).
   *
   * Outside an active context this is a no-op (kept backward-compatible — it
   * never throws), but it emits a one-shot `console.warn`, because a silently
   * dropped `set` is a common footgun: e.g. an auth guard calls
   * `Context.set('userRef', …)` on a route the middleware was excluded from, so
   * the value is lost without a trace. The warning fires once per process; call
   * {@link Context.resetSetWarning} to re-arm it (primarily for tests).
   */
  set<K extends keyof ContextStore>(key: K, value: ContextStore[K]): void {
    const store = als.getStore();
    if (store) {
      if (key === 'tenant') {
        // Same as Context.setTenant: keeps `tenantId` in sync.
        const input = value as TenantInput | undefined | null;
        writeTenant(
          store,
          input === undefined || input === null
            ? undefined
            : toTenantRef(input, input.source ?? 'app'),
        );
        return;
      }
      store[key] = value;
      if (key === 'tenantId' && store.tenant !== undefined && store.tenant.id !== value) {
        // A plain `tenantId` write replaces the tenant: it now reads as a legacy ref.
        // biome-ignore lint/performance/noDelete: an absent key, not an `undefined` one.
        delete store.tenant;
      }
      return;
    }
    warnSetOutsideContext(`Context.set(${String(key)}, …)`);
  },

  /** Re-arm the one-shot out-of-context `set` warning. Primarily for tests. */
  resetSetWarning(): void {
    warnedSetOutsideContext = false;
  },

  /**
   * Snapshot the active context and return a wrapped `fn` that re-enters that
   * snapshot every time it is later invoked — even outside any context. Mirrors
   * `AsyncResource.bind` / nestjs-cls's snapshot helpers, and is the safe way to
   * carry context across boundaries AsyncLocalStorage does not follow on its
   * own: `setTimeout`/`setInterval`, `EventEmitter` listeners, and queue/job
   * callbacks registered now but run later.
   *
   * Captures whatever is active at bind time (possibly nothing — then the bound
   * fn runs with no active store). Arguments, `this`, and the return value all
   * pass through unchanged.
   *
   * ```ts
   * emitter.on('done', Context.bind(() => log(Context.traceId())));
   * setTimeout(Context.bind(handler), 1000);
   * ```
   */
  bind<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    const snapshot = als.getStore();
    if (snapshot === undefined) {
      return fn;
    }
    return function (this: unknown, ...args: A): R {
      return als.run(snapshot, () => fn.apply(this, args));
    };
  },

  traceId(): string | undefined {
    return als.getStore()?.traceId;
  },

  tenantId(): string | undefined {
    const store = als.getStore();
    if (store === undefined) {
      return undefined;
    }
    return store.tenantId ?? storedTenant(store)?.id;
  },

  /**
   * The active tenant, or `undefined` when there is none. A store that only has a
   * plain `tenantId` (from `initialize`, an enricher or an old carrier) reads as
   * `{ id, kind: 'unknown', source: 'legacy' }`.
   */
  tenant(): TenantRef | undefined {
    const store = als.getStore();
    const tenant = store === undefined ? undefined : tenantOf(store);
    // A copy: mutating what a caller got must never rewrite the active store.
    return tenant === undefined ? undefined : { ...tenant };
  },

  /**
   * Set the active tenant on the current context, after the app has resolved it
   * on the server (from a verified token claim, a membership lookup, …). Writes
   * `tenant` and `tenantId`; `null` clears both. `source` defaults to `'app'`.
   *
   * Outside an active context it is a no-op with a one-shot warning, like
   * {@link Context.set}. Throws a `TypeError` when the tenant has no `id`.
   */
  setTenant(input: TenantInput | null): void {
    const ref = input === null ? undefined : toTenantRef(input);
    const store = als.getStore();
    if (store === undefined) {
      warnSetOutsideContext('Context.setTenant(…)');
      return;
    }
    writeTenant(store, ref);
  },

  /**
   * Run `fn` with `input` as the active tenant (`null` = no tenant), in a copy of
   * the current store, or in a new store when there is none (scripts, seeders,
   * webhook handlers, tests). Also leaves any {@link Context.allTenants} scope.
   */
  withTenant<T>(input: TenantInput | null, fn: () => T): T {
    const ref = input === null ? undefined : toTenantRef(input);
    const current = als.getStore();
    const store: ContextStore = current ? { ...current } : { traceId: randomTraceId() };
    // biome-ignore lint/performance/noDelete: an absent key, not an `undefined` one.
    delete store.tenantScope;
    writeTenant(store, ref);
    return als.run(store, fn);
  },

  /**
   * Run `fn` with access to every tenant's data: `tenantFilter()` answers
   * `{ mode: 'all' }` inside it. The explicit escape hatch for admin and
   * maintenance code. Never carried across a boundary.
   */
  allTenants<T>(fn: () => T): T {
    const current = als.getStore();
    const store: ContextStore = current ? { ...current } : { traceId: randomTraceId() };
    store.tenantScope = 'all';
    return als.run(store, fn);
  },

  /** The resolved `tenancy` option: `{ enabled, kinds? }`. */
  tenancy(): ResolvedTenancy {
    const out: ResolvedTenancy = { enabled: tenancy.enabled };
    if (tenancy.kinds !== undefined) {
      out.kinds = [...tenancy.kinds];
    }
    return out;
  },

  /**
   * How a lib must scope data right now:
   * - `system`: no active context. Do not filter.
   * - `all`: inside {@link Context.allTenants}. Do not filter.
   * - `tenantless`: a context with no tenant, or with a tenant whose kind is not
   *   in `kinds` (the lib's, else the context's). Only rows with no tenant.
   * - `tenant`: only this tenant's rows; stamp writes with `tenant.id`.
   *
   * It does not check `tenancy().enabled`: the lib decides whether tenancy is on
   * for it, then asks for the filter.
   */
  tenantFilter(options?: TenantFilterOptions): TenantFilter {
    const store = als.getStore();
    if (store === undefined) {
      return SYSTEM_FILTER;
    }
    if (store.tenantScope === 'all') {
      return ALL_FILTER;
    }
    const tenant = tenantOf(store);
    const kinds = options?.kinds ?? tenancy.kinds;
    if (tenant !== undefined && (kinds === undefined || kinds.includes(tenant.kind))) {
      return { mode: 'tenant', tenant: { ...tenant } };
    }
    return TENANTLESS_FILTER;
  },

  userRef(): UserRef | undefined {
    return als.getStore()?.userRef;
  },

  /**
   * Configure the singleton's cross-boundary behaviour (which fields the
   * carrier includes, or full serialize/deserialize overrides). Called by
   * `ContextModule.forRoot`.
   *
   * The config is **process-global** and is REPLACED wholesale on each call —
   * each `forRoot`'s options are treated as the complete carrier/serialize/
   * deserialize config, never merged. This guarantees you can never end up with
   * one app's `serialize` paired with another app's `deserialize`.
   *
   * Because it is process-global, a SECOND `forRoot` with a config that differs
   * from the first emits a `console.warn`: in multi-app or multi-test scenarios
   * the last `forRoot` wins, which is rarely what you want. Call
   * {@link Context.resetConfig} between apps/tests to silence the warning and
   * start from defaults. See DESIGN §4.1 level 4.
   */
  configure(next: ContextConfig): void {
    // Treat each forRoot's options as the COMPLETE config (replace, not merge),
    // so a mixed serialize-from-A / deserialize-from-B pair is impossible. Only
    // the carrier/serialize/deserialize keys are carried over; everything else
    // is dropped on purpose.
    const replacement: ContextConfig = {};
    if (next.carrier !== undefined) {
      replacement.carrier = next.carrier;
    }
    if (next.serialize !== undefined) {
      replacement.serialize = next.serialize;
    }
    if (next.deserialize !== undefined) {
      replacement.deserialize = next.deserialize;
    }
    if (next.baggage !== undefined) {
      replacement.baggage = next.baggage;
    }
    if (next.enrichers !== undefined) {
      replacement.enrichers = next.enrichers;
    }
    if (next.tenancy !== undefined) {
      replacement.tenancy = next.tenancy;
    }

    if (configured && configsConflict(config, replacement)) {
      console.warn(
        '[nestjs-context] Context.configure() called a second time with a ' +
          'different config. The config is process-global and is replaced ' +
          'wholesale — the last forRoot wins. In multi-app or multi-test setups ' +
          'call Context.resetConfig() between apps/tests. See DESIGN §4.1.',
      );
    }

    config = replacement;
    tenancy = resolveTenancy(replacement.tenancy);
    configured = true;
  },

  /** Reset the singleton config to its defaults. Primarily for tests. */
  resetConfig(): void {
    config = {};
    tenancy = resolveTenancy(undefined);
    configured = false;
  },

  /**
   * Plain carrier for cross-boundary transport, or `undefined` outside any
   * context. Defaults to `{ traceId, tenantId, userRef }`; the `carrier` /
   * `serialize` options (via `configure`) tune which fields travel. The carrier
   * is a snapshot taken at call time — not a live view. See DESIGN §5.
   */
  serialize(): ContextCarrier | undefined {
    const store = als.getStore();
    if (!store) {
      return undefined;
    }
    if (!config.serialize) {
      return defaultSerialize(store);
    }
    // A custom `serialize` is the app's own decision about what crosses a boundary:
    // the tenant travels only if it puts it there.
    return config.serialize(store);
  },

  /** Re-hydrate a context from a carrier and run `fn` inside it. */
  deserialize<T>(carrier: ContextCarrier, fn: () => T): T {
    return als.run(fromCarrier(carrier), fn);
  },

  /**
   * Build a W3C `baggage` header value from the active context, or `undefined`
   * when there is no context or no mappable field. This is the standards-
   * compliant propagation option: instead of (or alongside) the bespoke
   * {@link ContextCarrier}, the context can ride a real `baggage` header that any
   * W3C-baggage-aware peer (OTel SDKs, gateways) understands.
   *
   * By default maps `tenantId` and `userRef` (`userRef` as a compact `type:id`
   * token); tune the keys — or disable a field — via the `baggage` config (see
   * {@link ContextConfig}). The bespoke carrier path is unaffected.
   */
  toBaggage(): string | undefined {
    const store = als.getStore();
    if (!store) {
      return undefined;
    }
    const keys = resolveBaggageKeys(config.baggage);
    const entries: Record<string, string> = {};
    const tenantId = store.tenantId ?? storedTenant(store)?.id;
    if (keys.tenantId !== false && tenantId !== undefined) {
      entries[keys.tenantId] = tenantId;
      const tenant = storedTenant(store);
      if (tenancy.enabled && keys.tenantKind !== false && tenant !== undefined) {
        entries[keys.tenantKind] = tenant.kind;
      }
    }
    if (keys.userRef !== false && store.userRef !== undefined) {
      entries[keys.userRef] = encodeUserRef(store.userRef);
    }
    const header = encodeBaggage(entries);
    return header === '' ? undefined : header;
  },

  /**
   * Re-hydrate a context from a W3C `baggage` header (the symmetric counterpart
   * of {@link toBaggage}) and run `fn` inside it. Tolerant of a malformed/absent
   * header — it simply yields a context with those fields unset.
   *
   * Baggage carries no trace-id, so the `traceId` invariant is satisfied from
   * `opts.traceparent` (a W3C `traceparent` header value, when supplied and
   * valid) else a freshly generated id — mirroring the middleware's seeding.
   */
  fromBaggage<T>(
    header: string | string[] | undefined,
    fn: () => T,
    opts?: { traceparent?: string },
  ): T {
    const keys = resolveBaggageKeys(config.baggage);
    const decoded = decodeBaggage(header);

    const traceId =
      (opts?.traceparent !== undefined
        ? extractTraceparent({ traceparent: opts.traceparent })
        : undefined) ?? randomTraceId();

    const store: ContextStore = { traceId };
    if (keys.tenantId !== false) {
      const tenantId = decoded[keys.tenantId];
      if (tenantId !== undefined) {
        store.tenantId = tenantId;
        const kind = keys.tenantKind !== false ? decoded[keys.tenantKind] : undefined;
        if (tenancy.enabled && tenantId !== '' && kind !== undefined && kind !== '') {
          store.tenant = { id: tenantId, kind, source: 'carrier' };
        }
      }
    }
    if (keys.userRef !== false) {
      const token = decoded[keys.userRef];
      if (token !== undefined) {
        const userRef = decodeUserRef(token);
        if (userRef !== undefined) {
          store.userRef = userRef;
        }
      }
    }
    return als.run(store, fn);
  },

  /**
   * Run the configured eager {@link ContextConfig.enrichers} against the active
   * store, merging each one's returned `Partial<ContextStore>` (or letting it
   * mutate the store directly). The middleware calls this right after entering
   * the context, but it can also be invoked from non-HTTP entrypoints after a
   * `Context.run`/`enterWith`.
   *
   * No-op (never throws) when there is no active context or no enrichers. A
   * throwing enricher is isolated — it neither breaks the caller nor the
   * remaining enrichers.
   */
  runEnrichers(req?: unknown): void {
    const store = als.getStore();
    if (!store) {
      return;
    }
    const enrichers = config.enrichers;
    if (enrichers === undefined || enrichers.length === 0) {
      return;
    }
    for (const enricher of enrichers) {
      try {
        const patch = enricher(store, req);
        if (patch) {
          Object.assign(store, patch);
        }
      } catch {
        // An enricher must never break the request or the other enrichers.
      }
    }
    syncTenantFields(store);
  },

  /**
   * Lazily compute a derived store field on first access and memoize it onto the
   * active store, so subsequent reads (this request) are free. The on-demand
   * counterpart to eager {@link runEnrichers} — use it for values that are
   * expensive or rarely needed.
   *
   * If the field is already present on the store, its value is returned and the
   * factory is not called. Returns `undefined` outside any context (nowhere to
   * cache). The factory runs at most once per store per key.
   *
   * ```ts
   * const name = Context.lazy('displayName', (s) => lookupName(s.userRef));
   * ```
   */
  lazy<K extends keyof ContextStore>(
    key: K,
    factory: (store: ContextStore) => NonNullable<ContextStore[K]>,
  ): ContextStore[K] | undefined {
    const store = als.getStore();
    if (!store) {
      return undefined;
    }
    const existing = store[key];
    if (existing !== undefined) {
      return existing;
    }
    const value = factory(store);
    store[key] = value;
    return value;
  },
};
