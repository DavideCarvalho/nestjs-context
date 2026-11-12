import type { ContextAccessor as DiagnosticsContextAccessor } from '@dudousxd/nestjs-diagnostics';
import { contextAccessor } from './accessor.js';

/**
 * The global slot `@dudousxd/nestjs-diagnostics` keeps its context accessor in:
 * `globalThis[Symbol.for('@dudousxd/nestjs-diagnostics:accessor')]` holds
 * `{ current: accessor | null }`. Other libs read the context from it outside DI.
 */
export const DIAGNOSTICS_ACCESSOR_SLOT = Symbol.for('@dudousxd/nestjs-diagnostics:accessor');

interface AccessorHolder {
  current: unknown;
}

/**
 * Publish {@link contextAccessor} on the diagnostics global slot, and register it
 * with `@dudousxd/nestjs-diagnostics` (an OPTIONAL peer) when installed.
 *
 * The slot is written structurally first, so libs that read the context outside
 * DI (ORM hooks, workers) find it even without diagnostics installed. Diagnostics
 * adopts an existing holder when it loads, so both sides share one cell.
 *
 * With diagnostics installed, `emit()` then auto-fills the `traceId` on every
 * `aviary:*` diagnostic event. The import is dynamic on purpose: if diagnostics is
 * not installed the import rejects and we stop there.
 */
export async function wireContextIntoDiagnostics(): Promise<void> {
  const slots = globalThis as typeof globalThis & {
    [DIAGNOSTICS_ACCESSOR_SLOT]?: AccessorHolder;
  };
  const holder = slots[DIAGNOSTICS_ACCESSOR_SLOT];
  if (holder !== undefined && holder !== null && typeof holder === 'object') {
    holder.current = contextAccessor;
  } else {
    slots[DIAGNOSTICS_ACCESSOR_SLOT] = { current: contextAccessor };
  }
  try {
    const diagnostics = await import('@dudousxd/nestjs-diagnostics');
    // The two `ContextAccessor` shapes are identical for diagnostics' purposes (it
    // only ever calls `traceId()`); they differ solely in `get()`'s declared store
    // type. Cast across the package boundary; diagnostics never reads the store.
    diagnostics.setContextAccessor(contextAccessor as unknown as DiagnosticsContextAccessor);
  } catch {
    // @dudousxd/nestjs-diagnostics is not installed: the structural slot is enough.
  }
}
