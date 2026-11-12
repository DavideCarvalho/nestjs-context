import { Context, type ContextStore, type UserRef } from './context.js';
import type {
  PersonalTenantInput,
  ResolvedTenancy,
  SetTenantOptions,
  TenantFilter,
  TenantFilterOptions,
  TenantInput,
  TenantLabelResolver,
  TenantLevel,
  TenantRef,
} from './tenancy.js';

/**
 * The read-only view of the context that consumer libs inject via
 * {@link CONTEXT_ACCESSOR}, or read from the diagnostics global slot. Intentionally
 * a narrow surface (no `set`/`run`): consumers read, they do not drive the
 * lifecycle. Members are only ever added.
 */
export interface ContextAccessor {
  traceId(): string | undefined;
  tenantId(): string | undefined;
  userRef(): UserRef | undefined;
  get(): ContextStore | undefined;
  /**
   * The active tenant (see `Context.tenant`). Optional so an app that binds its own accessor
   * keeps compiling; readers treat a missing method as "tenancy off".
   */
  tenant?(): TenantRef | undefined;
  /** Every active tenant, primary first (see `Context.tenants`). Optional, as above. */
  tenants?(): TenantRef[];
  /** The active tenant chain, root first (see `Context.tenantChain`). Optional, as above. */
  tenantChain?(family?: string): TenantLevel[];
  /** The resolved `tenancy` option: `{ enabled, kinds?, required, personal }`. Optional, as above. */
  tenancy?(): ResolvedTenancy;
  /** How a lib must scope data right now (see `Context.tenantFilter`). Optional, as above. */
  tenantFilter?(options?: TenantFilterOptions): TenantFilter;
  /** The active tenant, or throw `TenantRequiredError` (see `Context.requireTenant`). Optional, as above. */
  requireTenant?(options?: Omit<TenantFilterOptions, 'required'>): TenantRef;
  /** The display label of a tenant (see `Context.tenantLabel`). Optional, as above. */
  tenantLabel?(tenant: TenantLevel): Promise<string>;
  /** Display labels keyed by tenant id (see `Context.tenantLabels`). Optional, as above. */
  tenantLabels?(tenants: TenantLevel[]): Promise<Record<string, string>>;
}

/** Default accessor: a thin facade over the singleton {@link Context}. */
export const contextAccessor: Required<ContextAccessor> = {
  traceId: () => Context.traceId(),
  tenantId: () => Context.tenantId(),
  userRef: () => Context.userRef(),
  get: () => Context.get(),
  tenant: () => Context.tenant(),
  tenants: () => Context.tenants(),
  tenantChain: (family?: string) => Context.tenantChain(family),
  tenancy: () => Context.tenancy(),
  tenantFilter: (options?: TenantFilterOptions) => Context.tenantFilter(options),
  requireTenant: (options?: Omit<TenantFilterOptions, 'required'>) =>
    Context.requireTenant(options),
  tenantLabel: (tenant: TenantLevel) => Context.tenantLabel(tenant),
  tenantLabels: (tenants: TenantLevel[]) => Context.tenantLabels(tenants),
};

/**
 * The tenancy contract, read and write, published on
 * `globalThis[Symbol.for('@dudousxd/nestjs-context:tenancy')]` when `ContextModule`
 * initializes. Libs read it STRUCTURALLY (never importing this package), check
 * `version === 1`, and treat a missing slot as "tenancy off". Members are only
 * ever added; a breaking change bumps `version`.
 */
export interface TenancySlot {
  readonly version: 1;
  tenancy(): ResolvedTenancy;
  tenant(): TenantRef | undefined;
  tenants(): TenantRef[];
  tenantChain(family?: string): TenantLevel[];
  tenantFilter(options?: TenantFilterOptions): TenantFilter;
  requireTenant(options?: Omit<TenantFilterOptions, 'required'>): TenantRef;
  setTenant(input: TenantInput | PersonalTenantInput | null, options?: SetTenantOptions): void;
  withTenant<T>(
    input: TenantInput | PersonalTenantInput | null,
    fn: () => T,
    options?: SetTenantOptions,
  ): T;
  allTenants<T>(fn: () => T): T;
  tenantLabel(tenant: TenantLevel): Promise<string>;
  tenantLabels(tenants: TenantLevel[]): Promise<Record<string, string>>;
  setTenantLabeler(resolver: TenantLabelResolver | undefined): void;
}

/** The global slot the {@link TenancySlot} is published on. */
export const CONTEXT_TENANCY_SLOT = Symbol.for('@dudousxd/nestjs-context:tenancy');

/** Default tenancy slot: a frozen facade over the singleton {@link Context}. */
export const tenancySlot: TenancySlot = Object.freeze({
  version: 1 as const,
  tenancy: () => Context.tenancy(),
  tenant: () => Context.tenant(),
  tenants: () => Context.tenants(),
  tenantChain: (family?: string) => Context.tenantChain(family),
  tenantFilter: (options?: TenantFilterOptions) => Context.tenantFilter(options),
  requireTenant: (options?: Omit<TenantFilterOptions, 'required'>) =>
    Context.requireTenant(options),
  setTenant: (input: TenantInput | PersonalTenantInput | null, options?: SetTenantOptions) =>
    Context.setTenant(input, options),
  withTenant: <T>(
    input: TenantInput | PersonalTenantInput | null,
    fn: () => T,
    options?: SetTenantOptions,
  ) => Context.withTenant(input, fn, options),
  allTenants: <T>(fn: () => T) => Context.allTenants(fn),
  tenantLabel: (tenant: TenantLevel) => Context.tenantLabel(tenant),
  tenantLabels: (tenants: TenantLevel[]) => Context.tenantLabels(tenants),
  setTenantLabeler: (resolver: TenantLabelResolver | undefined) =>
    Context.setTenantLabeler(resolver),
});
