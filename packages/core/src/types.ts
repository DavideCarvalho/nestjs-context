import type { Type } from '@nestjs/common';
import type { BaggageKeyMap } from './baggage.js';
import type { ContextCarrier, ContextEnricher, ContextStore } from './context.js';

// (cross-process serialize config lives on the singleton — see ContextConfig in context.ts)

/**
 * The request object passed to the population hooks. Kept structural and loose
 * (`headers` plus an index signature) so the hooks work with Express, Fastify,
 * or any other carrier without the lib depending on a concrete request type.
 */
export interface ContextRequest {
  headers?: Record<string, string | string[] | undefined>;
  [key: string]: unknown;
}

export interface ContextModuleOptions {
  /**
   * Header to read the incoming trace id from. Defaults to the W3C
   * `traceparent`. When absent or malformed, a fresh trace id is generated.
   */
  traceHeader?: string;

  // — population (DESIGN §4.1 level 2) —

  /**
   * Override how the trace id is produced for a request. When provided, its
   * return value wins over the `traceHeader`/random default.
   */
  traceId?: (req: ContextRequest) => string;

  /**
   * Extra fields merged into the initial store at request start. Lets the app
   * pre-populate custom (module-augmented) fields, `tenantId`, etc. `userRef`
   * still typically enters later via `Context.set()` in the auth guard.
   */
  initialize?: (req: ContextRequest) => Partial<ContextStore>;

  /**
   * Eager enrichers run by the middleware right after it enters the context (and
   * after `initialize`), to populate DERIVED store fields — e.g. a `displayName`
   * from `tenantId`. Unlike `initialize`, each enricher sees the assembled store
   * and may either return a `Partial<ContextStore>` to merge or mutate the store
   * in place. For values better computed on demand, prefer `Context.lazy`.
   * `forRoot` also pushes these onto the singleton so non-HTTP entrypoints can
   * call `Context.runEnrichers()` themselves.
   */
  enrichers?: ContextEnricher[];

  // — entrypoint (DESIGN §4.1 level 3) —

  /**
   * Whether to register the HTTP middleware automatically. Defaults to `true`.
   * Set `false` for non-HTTP entrypoints (GraphQL/gRPC/queue) where you create
   * the context yourself via `Context.run`/`Context.enterWith`.
   */
  autoMiddleware?: boolean;

  /** Routes the middleware applies to. Defaults to `['*']`. */
  forRoutes?: unknown[];

  /** Routes excluded from the middleware. */
  exclude?: unknown[];

  // — cross-process (DESIGN §4.1 level 4) —

  /**
   * Which store fields `Context.serialize()` includes in the carrier. Defaults
   * to `['traceId', 'tenantId', 'userRef']`. Add custom (module-augmented)
   * fields here so they survive the queue/durable boundary.
   */
  carrier?: (keyof ContextStore)[];

  /** Full override of how the store is serialized to a carrier. */
  serialize?: (store: ContextStore) => ContextCarrier;

  /** Full override of how a carrier is re-hydrated into a store. */
  deserialize?: (carrier: ContextCarrier) => ContextStore;

  /**
   * Baggage key mapping for `Context.toBaggage()`/`Context.fromBaggage()` — the
   * standards-compliant W3C `baggage` propagation option. Defaults to the field
   * names (`tenantId`, `userRef`); set a custom key to namespace it, or `false`
   * to never propagate that field over baggage. Independent of the bespoke
   * carrier above.
   */
  baggage?: BaggageKeyMap;
}

/**
 * Implement this to supply {@link ContextModuleOptions} from a DI provider —
 * the `useClass` / `useExisting` arm of {@link ContextModule.forRootAsync}.
 */
export interface ContextModuleOptionsFactory {
  createContextOptions(): Promise<ContextModuleOptions> | ContextModuleOptions;
}

/**
 * Options for {@link ContextModule.forRootAsync}: resolve {@link ContextModuleOptions}
 * lazily through DI (e.g. from a `ConfigService`). Mirrors the ecosystem
 * convention (`nestjs-filter`, `nestjs-authz`) — supply exactly one of
 * `useFactory` / `useClass` / `useExisting`.
 */
export interface ContextModuleAsyncOptions {
  /** Modules whose exported providers the factory may `inject`. */
  imports?: unknown[];
  /** Factory returning the resolved options; its args come from `inject`. */
  useFactory?: (...args: unknown[]) => Promise<ContextModuleOptions> | ContextModuleOptions;
  /** Providers to inject (in order) into `useFactory`. */
  inject?: unknown[];
  /** A class implementing {@link ContextModuleOptionsFactory}, instantiated by Nest. */
  useClass?: Type<ContextModuleOptionsFactory>;
  /** An existing provider implementing {@link ContextModuleOptionsFactory}. */
  useExisting?: Type<ContextModuleOptionsFactory>;
}
