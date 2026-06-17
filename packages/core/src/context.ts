import { AsyncLocalStorage } from 'node:async_hooks';
import { randomTraceId } from './traceparent.js';

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
  tenantId?: string;
}

/**
 * Plain, serializable snapshot of the context safe to send across a process /
 * queue / durable boundary. Carries no user entity nor DB connection — just the
 * refs needed to re-hydrate on the other side. See DESIGN §5.
 */
export interface ContextCarrier {
  traceId: string;
  tenantId?: string;
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
}

/** Fields carried by default when no `carrier`/`serialize` override is set. */
const DEFAULT_CARRIER: (keyof ContextStore)[] = ['traceId', 'tenantId', 'userRef'];

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

/** Whether {@link Context.configure} has already set a non-empty config. */
let configured = false;

function configsConflict(a: ContextConfig, b: ContextConfig): boolean {
  const carrierA = JSON.stringify(a.carrier);
  const carrierB = JSON.stringify(b.carrier);
  return carrierA !== carrierB || a.serialize !== b.serialize || a.deserialize !== b.deserialize;
}

/** One-shot guard so the missing-traceId warning is not spammed per request. */
let warnedMissingTraceId = false;

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

function fromCarrier(carrier: ContextCarrier): ContextStore {
  if (config.deserialize) {
    return ensureTraceId(config.deserialize(carrier));
  }
  const store: ContextStore = { traceId: carrier.traceId };
  if (carrier.tenantId !== undefined) {
    store.tenantId = carrier.tenantId;
  }
  if (carrier.userRef !== undefined) {
    store.userRef = carrier.userRef;
  }
  return ensureTraceId(store);
}

function defaultSerialize(store: ContextStore): ContextCarrier {
  const fields = config.carrier ?? DEFAULT_CARRIER;
  // `traceId` is always present on a carrier.
  const carrier: Record<string, unknown> = { traceId: store.traceId };
  for (const field of fields) {
    if (field === 'traceId') {
      continue;
    }
    const value = store[field];
    if (value !== undefined) {
      carrier[field] = value;
    }
  }
  return carrier as unknown as ContextCarrier;
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
   * after the middleware already entered the context). No-op outside a context.
   */
  set<K extends keyof ContextStore>(key: K, value: ContextStore[K]): void {
    const store = als.getStore();
    if (store) {
      store[key] = value;
    }
  },

  traceId(): string | undefined {
    return als.getStore()?.traceId;
  },

  tenantId(): string | undefined {
    return als.getStore()?.tenantId;
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

    if (configured && configsConflict(config, replacement)) {
      console.warn(
        '[nestjs-context] Context.configure() called a second time with a ' +
          'different config. The config is process-global and is replaced ' +
          'wholesale — the last forRoot wins. In multi-app or multi-test setups ' +
          'call Context.resetConfig() between apps/tests. See DESIGN §4.1.',
      );
    }

    config = replacement;
    configured = true;
  },

  /** Reset the singleton config to its defaults. Primarily for tests. */
  resetConfig(): void {
    config = {};
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
    return config.serialize ? config.serialize(store) : defaultSerialize(store);
  },

  /** Re-hydrate a context from a carrier and run `fn` inside it. */
  deserialize<T>(carrier: ContextCarrier, fn: () => T): T {
    return als.run(fromCarrier(carrier), fn);
  },
};
