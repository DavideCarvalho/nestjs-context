import type { ContextAccessor as DiagnosticsContextAccessor } from '@dudousxd/nestjs-diagnostics';
import { contextAccessor } from './accessor.js';

/**
 * Soft, one-way bridge into `@dudousxd/nestjs-diagnostics` (an OPTIONAL peer).
 *
 * When that package is installed, we register this module's {@link contextAccessor}
 * as its trace source, so `emit()` auto-fills the `traceId` on every `aviary:*`
 * diagnostic event — for authz, inertia, durable, notifications, and any future
 * emitter — with zero action from the app.
 *
 * The import is dynamic on purpose: diagnostics stays fully optional. If it is not
 * installed the import rejects and we no-op (events simply carry no `traceId`).
 * There is no static import in either direction — diagnostics mirrors our accessor
 * shape structurally rather than importing us — so the two packages stay decoupled.
 */
export async function wireContextIntoDiagnostics(): Promise<void> {
  try {
    const diagnostics = await import('@dudousxd/nestjs-diagnostics');
    // The two `ContextAccessor` shapes are identical for diagnostics' purposes (it
    // only ever calls `traceId()`); they differ solely in `get()`'s declared store
    // type — our `ContextStore` is a concrete interface, diagnostics' is the looser
    // `Record<string, unknown>`. Cast across the package boundary; diagnostics never
    // reads the store.
    diagnostics.setContextAccessor(contextAccessor as unknown as DiagnosticsContextAccessor);
  } catch {
    // @dudousxd/nestjs-diagnostics is not installed — nothing to wire.
  }
}
