import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { Context, type ContextStore } from './context.js';
import { CONTEXT_MODULE_OPTIONS } from './tokens.js';
import { parseTraceparent, randomTraceId } from './traceparent.js';
import type { ContextModuleOptions, ContextRequest } from './types.js';

interface RequestLike extends ContextRequest {
  headers: Record<string, string | string[] | undefined>;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Establishes the per-request context at the very start of the pipeline.
 *
 * Uses `enterWith` (not `run`) so the context survives the middleware return
 * and reaches the async handler, guards, and interceptors. `userRef`/`tenantId`
 * are filled in later (e.g. by the auth guard) via `Context.set()`. See
 * DESIGN §3.
 */
@Injectable()
export class ContextMiddleware implements NestMiddleware {
  constructor(
    @Inject(CONTEXT_MODULE_OPTIONS) private readonly options: ContextModuleOptions = {},
  ) {}

  use(req: RequestLike, _res: unknown, next: (err?: unknown) => void): void {
    const headers = req.headers ?? {};
    const traceHeader = this.options.traceHeader ?? 'traceparent';
    // Parse the upstream traceparent once: its trace-id seeds ours (unless a
    // `traceId` hook overrides), and its span-id + flags are kept so we can
    // re-emit a faithful downstream traceparent. See toTraceparent / DESIGN §5.
    const upstream = parseTraceparent(headers, traceHeader);
    const traceId = this.options.traceId?.(req) ?? upstream?.traceId ?? randomTraceId();
    const requestId = firstHeader(headers['x-request-id']);

    // Precedence (see DESIGN §4.1): merge the loosely-typed `initialize()` bag
    // FIRST, then set the dedicated `traceId`/`requestId` LAST so the resolved
    // trace-id (hook → header → random) and request-id always win and can never
    // be clobbered by a stray field in `initialize()`'s return.
    const store: ContextStore = { traceId };
    const extra = this.options.initialize?.(req);
    if (extra) {
      Object.assign(store, extra);
      // Re-assert traceId only when initialize() actually merged a bag that
      // could have clobbered it; the common (no-hook) path skips the rewrite.
      store.traceId = traceId;
    }
    // Treat an empty-string `x-request-id` as absent (LOW).
    if (requestId) {
      store.requestId = requestId;
    }
    // Keep the upstream span-id/flags only when our trace-id is genuinely the
    // upstream one (no `traceId` hook re-rooted the trace) — a parent-id from a
    // different trace would be meaningless when re-emitted.
    if (upstream && upstream.traceId === traceId) {
      store.traceparent = upstream;
    }

    Context.enterWith(store);

    // Eager enrichers: derive fields from the now-assembled store (and the
    // request) right after entering the context. Applied from the middleware's
    // own options so this works whether or not the singleton was configured; a
    // throwing enricher is isolated and never breaks the request.
    const enrichers = this.options.enrichers;
    if (enrichers && enrichers.length > 0) {
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
    }

    next();
  }
}
