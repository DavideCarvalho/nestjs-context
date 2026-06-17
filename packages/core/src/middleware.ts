import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { Context, type ContextStore } from './context.js';
import { CONTEXT_MODULE_OPTIONS } from './tokens.js';
import { extractTraceparent, randomTraceId } from './traceparent.js';
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
    const traceId =
      this.options.traceId?.(req) ?? extractTraceparent(headers, traceHeader) ?? randomTraceId();
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

    Context.enterWith(store);
    next();
  }
}
