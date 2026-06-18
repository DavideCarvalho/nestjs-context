import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context, ContextMiddleware, type ContextStore } from '../src/index.js';

// Augment the store with a derived field the enrichers populate.
declare module '../src/index.js' {
  interface ContextStore {
    displayName?: string;
    region?: string;
  }
}

afterEach(() => {
  Context.resetConfig();
});

describe('eager enrichers (run right after the context is entered)', () => {
  it('runEnrichers populates derived fields into the active store', () => {
    Context.configure({
      enrichers: [(store) => ({ displayName: `tenant:${store.tenantId}` })],
    });
    Context.run({ traceId: 'x', tenantId: 'acme' }, () => {
      Context.runEnrichers();
      expect(Context.get()?.displayName).toBe('tenant:acme');
    });
  });

  it('an enricher returning void may mutate the store directly', () => {
    Context.configure({
      enrichers: [
        (store) => {
          store.region = 'eu';
        },
      ],
    });
    Context.run({ traceId: 'x' }, () => {
      Context.runEnrichers();
      expect(Context.get()?.region).toBe('eu');
    });
  });

  it('passes the request through to enrichers when given', () => {
    Context.configure({
      enrichers: [(_store, req) => ({ region: String(req?.headers?.['x-region']) })],
    });
    Context.run({ traceId: 'x' }, () => {
      Context.runEnrichers({ headers: { 'x-region': 'us' } });
      expect(Context.get()?.region).toBe('us');
    });
  });

  it('runEnrichers is a no-op outside any context (does not throw)', () => {
    Context.configure({ enrichers: [() => ({ region: 'eu' })] });
    expect(() => Context.runEnrichers()).not.toThrow();
  });

  it('a throwing enricher does not break the others or the caller', () => {
    Context.configure({
      enrichers: [
        () => {
          throw new Error('boom');
        },
        () => ({ region: 'eu' }),
      ],
    });
    Context.run({ traceId: 'x' }, () => {
      expect(() => Context.runEnrichers()).not.toThrow();
      expect(Context.get()?.region).toBe('eu');
    });
  });

  it('the middleware runs eager enrichers right after entering the context', () => {
    const mw = new ContextMiddleware({
      enrichers: [(store) => ({ displayName: `t:${store.tenantId}` })],
      initialize: () => ({ tenantId: 'acme' }),
    });
    Context.run({ traceId: 'placeholder' }, () => {
      mw.use({ headers: {} }, {}, () => {});
      expect(Context.get()?.displayName).toBe('t:acme');
    });
  });

  it('no enrichers configured → runEnrichers is a harmless no-op', () => {
    Context.run({ traceId: 'x' }, () => {
      expect(() => Context.runEnrichers()).not.toThrow();
      expect(Context.get()).toEqual({ traceId: 'x' });
    });
  });
});

describe('lazy derived values (computed on first access, memoized per store)', () => {
  it('computes once and caches on the active store', () => {
    const factory = vi.fn((store: ContextStore) => `name-${store.tenantId}`);
    Context.run({ traceId: 'x', tenantId: 'acme' }, () => {
      const a = Context.lazy('displayName', factory);
      const b = Context.lazy('displayName', factory);
      expect(a).toBe('name-acme');
      expect(b).toBe('name-acme');
      // Memoized: factory ran exactly once.
      expect(factory).toHaveBeenCalledTimes(1);
      // Cached onto the store field.
      expect(Context.get()?.displayName).toBe('name-acme');
    });
  });

  it('recomputes in a different context (cache is per store)', () => {
    const factory = (store: ContextStore) => `name-${store.tenantId}`;
    const first = Context.run({ traceId: 'x', tenantId: 'a' }, () =>
      Context.lazy('displayName', factory),
    );
    const second = Context.run({ traceId: 'y', tenantId: 'b' }, () =>
      Context.lazy('displayName', factory),
    );
    expect(first).toBe('name-a');
    expect(second).toBe('name-b');
  });

  it('returns undefined outside any context (no store to cache on)', () => {
    expect(Context.lazy('displayName', () => 'x')).toBeUndefined();
  });

  it('an already-present field short-circuits the factory', () => {
    const factory = vi.fn(() => 'computed');
    Context.run({ traceId: 'x', displayName: 'preset' }, () => {
      expect(Context.lazy('displayName', factory)).toBe('preset');
      expect(factory).not.toHaveBeenCalled();
    });
  });
});
