import { Context, type ContextStore, type UserRef } from './context.js';
import type { ResolvedTenancy, TenantFilter, TenantFilterOptions, TenantRef } from './tenancy.js';

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
  /** The active tenant (see `Context.tenant`). */
  tenant(): TenantRef | undefined;
  /** The resolved `tenancy` option: `{ enabled, kinds? }`. */
  tenancy(): ResolvedTenancy;
  /** How a lib must scope data right now (see `Context.tenantFilter`). */
  tenantFilter(options?: TenantFilterOptions): TenantFilter;
}

/** Default accessor: a thin facade over the singleton {@link Context}. */
export const contextAccessor: ContextAccessor = {
  traceId: () => Context.traceId(),
  tenantId: () => Context.tenantId(),
  userRef: () => Context.userRef(),
  get: () => Context.get(),
  tenant: () => Context.tenant(),
  tenancy: () => Context.tenancy(),
  tenantFilter: (options?: TenantFilterOptions) => Context.tenantFilter(options),
};
