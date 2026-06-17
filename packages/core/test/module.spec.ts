import { describe, expect, it, vi } from 'vitest';
import {
  CONTEXT_ACCESSOR,
  CONTEXT_MODULE_OPTIONS,
  Context,
  ContextMiddleware,
  ContextModule,
  contextAccessor,
} from '../src/index.js';

describe('ContextModule.forRoot', () => {
  it('is a global dynamic module exporting the accessor + options', () => {
    const mod = ContextModule.forRoot({ traceHeader: 'x-trace' });
    expect(mod.module).toBe(ContextModule);
    expect(mod.global).toBe(true);
    expect(mod.exports).toContain(CONTEXT_ACCESSOR);
    expect(mod.exports).toContain(CONTEXT_MODULE_OPTIONS);

    const accessorProvider = (mod.providers ?? []).find(
      (p) => typeof p === 'object' && 'provide' in p && p.provide === CONTEXT_ACCESSOR,
    );
    expect(accessorProvider).toBeDefined();
  });

  it('registers the middleware for all routes via configure()', () => {
    const apply = vi.fn().mockReturnThis();
    const forRoutes = vi.fn();
    const consumer = { apply } as never;
    apply.mockReturnValue({ forRoutes });

    new ContextModule().configure(consumer);
    expect(apply).toHaveBeenCalledWith(ContextMiddleware);
    expect(forRoutes).toHaveBeenCalledWith('*');
  });
});

describe('ContextMiddleware', () => {
  it('enters a context with the incoming traceparent and request id', () => {
    const mw = new ContextMiddleware({});
    const next = vi.fn();
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

    Context.run({ traceId: 'placeholder' }, () => {
      mw.use({ headers: { traceparent, 'x-request-id': 'req-42' } }, {}, () => {
        expect(Context.traceId()).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
        expect(Context.get()?.requestId).toBe('req-42');
        next();
      });
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it('generates a trace id when no traceparent is present', () => {
    const mw = new ContextMiddleware({});
    Context.run({ traceId: 'placeholder' }, () => {
      mw.use({ headers: {} }, {}, () => {});
      expect(Context.traceId()).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  it('honours a custom trace header from options', () => {
    const mw = new ContextMiddleware({ traceHeader: 'x-trace' });
    const traceparent = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-00f067aa0ba902b7-01';
    Context.run({ traceId: 'placeholder' }, () => {
      mw.use({ headers: { 'x-trace': traceparent } }, {}, () => {});
      expect(Context.traceId()).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    });
  });
});

describe('contextAccessor', () => {
  it('reflects the active context', () => {
    Context.run({ traceId: 'acc', tenantId: 'tn', userRef: { type: 'user', id: 1 } }, () => {
      expect(contextAccessor.traceId()).toBe('acc');
      expect(contextAccessor.tenantId()).toBe('tn');
      expect(contextAccessor.userRef()).toEqual({ type: 'user', id: 1 });
      expect(contextAccessor.get()?.traceId).toBe('acc');
    });
  });
});
