import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wireContextIntoDiagnostics } from '../src/diagnostics-bridge.js';
import {
  CONTEXT_ACCESSOR,
  Context,
  type ContextAccessor,
  ContextMiddleware,
  ContextModule,
  type ContextStore,
  contextAccessor,
} from '../src/index.js';
import { canSeeRow, readTenancy, rowTenantId } from './fixtures/tenancy-reader.js';

const SLOT = Symbol.for('@dudousxd/nestjs-diagnostics:accessor');
const slots = globalThis as unknown as Record<symbol, { current: unknown } | undefined>;

const acme = { id: 'org_1', kind: 'organization' } as const;

function inStore<T>(store: Partial<ContextStore>, fn: () => T): T {
  return Context.run({ traceId: 't', ...store }, fn);
}

beforeEach(() => {
  Context.resetConfig();
  Context.resetSetWarning();
});
afterEach(() => {
  Context.resetConfig();
  vi.restoreAllMocks();
});

describe('Context.setTenant / tenant()', () => {
  it('writes tenant and tenantId together, with source app', () => {
    inStore({}, () => {
      Context.setTenant({ ...acme, slug: 'acme', role: 'admin' });
      expect(Context.tenant()).toEqual({
        id: 'org_1',
        kind: 'organization',
        source: 'app',
        slug: 'acme',
        role: 'admin',
      });
      expect(Context.tenantId()).toBe('org_1');
      expect(Context.get()?.tenantId).toBe('org_1');
    });
  });

  it('stringifies a numeric id', () => {
    inStore({}, () => {
      Context.setTenant({ id: 42, kind: 'clinic' });
      expect(Context.tenantId()).toBe('42');
    });
  });

  it('null clears both fields', () => {
    inStore({}, () => {
      Context.setTenant(acme);
      Context.setTenant(null);
      expect(Context.tenant()).toBeUndefined();
      expect(Context.tenantId()).toBeUndefined();
      expect(Context.get()).not.toHaveProperty('tenantId');
    });
  });

  it('rejects a tenant without an id', () => {
    inStore({}, () => {
      expect(() => Context.setTenant({ id: '', kind: 'organization' })).toThrow(TypeError);
    });
  });

  it('is a warned no-op outside a context', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Context.setTenant(acme);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(Context.tenant()).toBeUndefined();
  });

  it('reads a plain tenantId as a legacy tenant', () => {
    inStore({ tenantId: 't1' }, () => {
      expect(Context.tenant()).toEqual({ id: 't1', kind: 'unknown', source: 'legacy' });
    });
  });

  it('a later plain tenantId write replaces the tenant', () => {
    inStore({}, () => {
      Context.setTenant(acme);
      Context.set('tenantId', 'other');
      expect(Context.tenant()).toEqual({ id: 'other', kind: 'unknown', source: 'legacy' });
      Context.set('tenantId', undefined);
      expect(Context.tenant()).toBeUndefined();
    });
  });

  it('Context.set("tenant") keeps tenantId in sync', () => {
    inStore({}, () => {
      Context.set('tenant', { id: 'org_2', kind: 'organization', source: 'app' });
      expect(Context.tenantId()).toBe('org_2');
      Context.set('tenant', undefined);
      expect(Context.tenantId()).toBeUndefined();
    });
  });

  it('a tenant from initialize fills tenantId through the middleware', () => {
    const mw = new ContextMiddleware({
      initialize: () => ({ tenant: { id: 'org_3', kind: 'organization', source: 'app' } }),
    });
    let seen: string | undefined;
    mw.use({ headers: {} }, {}, () => {
      seen = Context.get()?.tenantId;
    });
    expect(seen).toBe('org_3');
  });
});

describe('Context.withTenant / allTenants', () => {
  it('withTenant creates a store when there is none', () => {
    expect(Context.get()).toBeUndefined();
    const result = Context.withTenant(acme, () => {
      expect(Context.traceId()).toMatch(/^[0-9a-f]{32}$/);
      return Context.tenant()?.id;
    });
    expect(result).toBe('org_1');
    expect(Context.get()).toBeUndefined();
  });

  it('withTenant does not change the outer store', () => {
    inStore({ userRef: { type: 'user', id: 1 } }, () => {
      Context.withTenant(acme, () => {
        expect(Context.userRef()).toEqual({ type: 'user', id: 1 });
        expect(Context.tenantId()).toBe('org_1');
      });
      expect(Context.tenant()).toBeUndefined();
    });
  });

  it('withTenant(null) runs with no tenant', () => {
    inStore({ tenantId: 't1' }, () => {
      Context.withTenant(null, () => expect(Context.tenant()).toBeUndefined());
    });
  });

  it('allTenants switches the filter to all, and withTenant inside narrows again', () => {
    inStore({}, () => {
      Context.allTenants(() => {
        expect(Context.tenantFilter()).toEqual({ mode: 'all' });
        Context.withTenant(acme, () => {
          expect(Context.tenantFilter()).toMatchObject({ mode: 'tenant' });
        });
      });
      expect(Context.tenantFilter()).toEqual({ mode: 'tenantless' });
    });
  });

  it('allTenants creates a store when there is none', () => {
    Context.allTenants(() => expect(Context.tenantFilter()).toEqual({ mode: 'all' }));
  });
});

describe('Context.tenantFilter', () => {
  it('answers the four modes', () => {
    expect(Context.tenantFilter()).toEqual({ mode: 'system' });
    inStore({}, () => expect(Context.tenantFilter()).toEqual({ mode: 'tenantless' }));
    Context.allTenants(() => expect(Context.tenantFilter()).toEqual({ mode: 'all' }));
    Context.withTenant(acme, () =>
      expect(Context.tenantFilter()).toEqual({
        mode: 'tenant',
        tenant: { ...acme, source: 'app' },
      }),
    );
  });

  it('a tenant of a kind outside kinds counts as tenantless', () => {
    Context.configure({ tenancy: { enabled: true, kinds: ['clinic'] } });
    Context.withTenant(acme, () => {
      expect(Context.tenantFilter()).toEqual({ mode: 'tenantless' });
      expect(Context.tenantFilter({ kinds: ['organization'] })).toMatchObject({ mode: 'tenant' });
    });
    inStore({ tenantId: 'legacy' }, () => {
      expect(Context.tenantFilter()).toEqual({ mode: 'tenantless' });
    });
  });

  it('a legacy tenantId is honoured when kinds is unset', () => {
    inStore({ tenantId: 'legacy' }, () => {
      expect(Context.tenantFilter()).toEqual({
        mode: 'tenant',
        tenant: { id: 'legacy', kind: 'unknown', source: 'legacy' },
      });
    });
  });
});

describe('Context.tenancy', () => {
  it('is off by default', () => {
    expect(Context.tenancy()).toEqual({ enabled: false });
  });

  it('reflects the configured option', () => {
    Context.configure({ tenancy: { enabled: true, kinds: ['organization'] } });
    expect(Context.tenancy()).toEqual({ enabled: true, kinds: ['organization'] });
  });

  it('forRoot pushes it onto the singleton', () => {
    ContextModule.forRoot({ tenancy: { enabled: true } });
    expect(Context.tenancy().enabled).toBe(true);
  });
});

describe('carrier', () => {
  it('tenancy off: a store without a tenant serializes exactly as before', () => {
    inStore({ tenantId: 't1', userRef: { type: 'user', id: 7 } }, () => {
      expect(Context.serialize()).toEqual({
        traceId: 't',
        tenantId: 't1',
        userRef: { type: 'user', id: 7 },
      });
    });
  });

  it('the default carrier round-trips the tenant as source carrier', () => {
    const carrier = Context.withTenant(acme, () => Context.serialize());
    expect(carrier?.tenant).toEqual({ ...acme, source: 'app' });
    Context.deserialize(carrier!, () => {
      expect(Context.tenant()).toEqual({ ...acme, source: 'carrier' });
      expect(Context.tenantId()).toBe('org_1');
    });
  });

  it('tenancy on: tenant and tenantId are added even when carrier leaves them out', () => {
    Context.configure({ carrier: ['traceId', 'userRef'], tenancy: { enabled: true } });
    const carrier = Context.withTenant(acme, () => Context.serialize());
    expect(carrier).toEqual({
      traceId: expect.any(String),
      tenantId: 'org_1',
      tenant: { ...acme, source: 'app' },
    });
  });

  it('tenancy off: a carrier list without the tenant drops it', () => {
    Context.configure({ carrier: ['traceId', 'userRef'] });
    const carrier = Context.withTenant(acme, () => Context.serialize());
    expect(carrier).not.toHaveProperty('tenant');
    expect(carrier).not.toHaveProperty('tenantId');
  });

  it('tenancy on: a custom serialize/deserialize still carries the tenant', () => {
    Context.configure({
      serialize: (s) => ({ traceId: s.traceId }),
      deserialize: (c) => ({ traceId: c.traceId }),
      tenancy: { enabled: true },
    });
    const carrier = Context.withTenant(acme, () => Context.serialize());
    expect(carrier?.tenantId).toBe('org_1');
    Context.deserialize(carrier!, () => expect(Context.tenant()?.kind).toBe('organization'));
  });

  it('never carries the allTenants bypass', () => {
    Context.configure({ carrier: ['traceId', 'tenantScope'] });
    const carrier = Context.allTenants(() => Context.serialize());
    expect(carrier).not.toHaveProperty('tenantScope');
    Context.deserialize({ traceId: 't', tenantScope: 'all' } as never, () =>
      expect(Context.tenantFilter()).toEqual({ mode: 'tenantless' }),
    );
  });

  it('an old carrier with only tenantId restores a legacy tenant', () => {
    Context.deserialize({ traceId: 't', tenantId: 't1' }, () =>
      expect(Context.tenant()).toEqual({ id: 't1', kind: 'unknown', source: 'legacy' }),
    );
  });
});

describe('baggage', () => {
  it('tenancy on: carries tenantKind next to tenantId and restores the tenant', () => {
    Context.configure({ tenancy: { enabled: true } });
    const header = Context.withTenant(acme, () => Context.toBaggage());
    expect(header).toContain('tenantId=org_1');
    expect(header).toContain('tenantKind=organization');
    Context.fromBaggage(header, () =>
      expect(Context.tenant()).toEqual({ ...acme, source: 'carrier' }),
    );
  });

  it('tenancy off: no tenantKind, and the header reads as before', () => {
    const header = Context.withTenant(acme, () => Context.toBaggage());
    expect(header).toBe('tenantId=org_1');
  });

  it('honours a custom or disabled tenantKind key', () => {
    Context.configure({ tenancy: { enabled: true }, baggage: { tenantKind: false } });
    expect(Context.withTenant(acme, () => Context.toBaggage())).toBe('tenantId=org_1');
  });
});

describe('accessor', () => {
  it('exposes tenant(), tenancy() and tenantFilter()', () => {
    Context.configure({ tenancy: { enabled: true } });
    Context.withTenant(acme, () => {
      expect(contextAccessor.tenant()?.id).toBe('org_1');
      expect(contextAccessor.tenancy()).toEqual({ enabled: true });
      expect(contextAccessor.tenantFilter({ kinds: ['clinic'] })).toEqual({ mode: 'tenantless' });
    });
  });

  it('is what CONTEXT_ACCESSOR resolves to', async () => {
    const ref = await Test.createTestingModule({
      imports: [ContextModule.forRoot({ autoMiddleware: false })],
    }).compile();
    const accessor = ref.get<ContextAccessor>(CONTEXT_ACCESSOR);
    expect(typeof accessor.tenantFilter).toBe('function');
    await ref.close();
  });

  it('is published on the diagnostics global slot', async () => {
    await wireContextIntoDiagnostics();
    expect(slots[SLOT]?.current).toBe(contextAccessor);
  });

  it('logs one boot line when tenancy is on, none when off', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const off = await Test.createTestingModule({
      imports: [ContextModule.forRoot({ autoMiddleware: false })],
    }).compile();
    await off.init();
    expect(log.mock.calls.filter(([m]) => String(m).includes('Tenancy'))).toHaveLength(0);
    await off.close();

    Context.resetConfig();
    const on = await Test.createTestingModule({
      imports: [
        ContextModule.forRoot({
          autoMiddleware: false,
          carrier: ['traceId'],
          tenancy: { enabled: true },
        }),
      ],
    }).compile();
    await on.init();
    const lines = log.mock.calls.filter(([m]) => String(m).includes('Tenancy'));
    expect(lines).toHaveLength(1);
    expect(String(lines[0]?.[0])).toContain('even though `carrier` does not list them');
    await on.close();
  });
});

describe('the local reader snippet', () => {
  let saved: { current: unknown } | undefined;
  beforeEach(() => {
    saved = slots[SLOT];
  });
  afterEach(() => {
    slots[SLOT] = saved;
  });

  it('answers { enabled: false } with the slot missing or old', () => {
    slots[SLOT] = undefined;
    expect(readTenancy()).toEqual({ enabled: false });
    slots[SLOT] = { current: { traceId: () => undefined, tenantId: () => undefined } };
    expect(readTenancy()).toEqual({ enabled: false });
    expect(readTenancy('inherit', { traceId: () => 'x' })).toEqual({ enabled: false });
  });

  it('inherits the context switch, which is off by default', async () => {
    await wireContextIntoDiagnostics();
    expect(readTenancy().enabled).toBe(false);
    Context.configure({ tenancy: { enabled: true } });
    expect(readTenancy().enabled).toBe(true);
    expect(readTenancy(false).enabled).toBe(false);
    expect(readTenancy({ enabled: false }).enabled).toBe(false);
  });

  it('an explicit enabled: true wins over the context switch', () => {
    expect(readTenancy({ enabled: true }, contextAccessor).enabled).toBe(true);
  });

  it('applies the matching rule, 404-style: rows of other tenants are simply invisible', () => {
    Context.configure({ tenancy: { enabled: true } });
    const t = () => readTenancy('inherit', contextAccessor);
    const shared = () => readTenancy({ nullRows: 'shared' }, contextAccessor);

    // system: no store, sees everything
    expect([canSeeRow(t(), 'org_1'), canSeeRow(t(), 'org_2'), canSeeRow(t(), null)]).toEqual([
      true,
      true,
      true,
    ]);
    Context.withTenant(acme, () => {
      expect([canSeeRow(t(), 'org_1'), canSeeRow(t(), 'org_2'), canSeeRow(t(), null)]).toEqual([
        true,
        false,
        false,
      ]);
      expect(canSeeRow(shared(), null)).toBe(true);
      expect(canSeeRow(shared(), 'org_2')).toBe(false);
      expect(rowTenantId(t())).toBe('org_1');
    });
    inStore({}, () => {
      expect([canSeeRow(t(), 'org_1'), canSeeRow(t(), null)]).toEqual([false, true]);
      expect(rowTenantId(t())).toBeNull();
    });
    Context.allTenants(() => {
      expect([canSeeRow(t(), 'org_1'), canSeeRow(t(), null)]).toEqual([true, true]);
    });
  });

  it('honours the lib kinds over the context kinds', () => {
    Context.configure({ tenancy: { enabled: true, kinds: ['organization'] } });
    Context.withTenant({ id: 'c1', kind: 'clinic' }, () => {
      const inherit = readTenancy('inherit', contextAccessor);
      const own = readTenancy({ kinds: ['clinic'] }, contextAccessor);
      expect(inherit.enabled && inherit.filter()).toEqual({ mode: 'tenantless' });
      expect(own.enabled && own.filter()).toMatchObject({ mode: 'tenant' });
    });
  });

  it('is copied verbatim into the Tenancy docs page', () => {
    const snippet = readFileSync(new URL('./fixtures/tenancy-reader.ts', import.meta.url), 'utf8');
    const docs = readFileSync(
      new URL('../../../website/content/docs/tenancy.mdx', import.meta.url),
      'utf8',
    );
    expect(docs).toContain(snippet.trim());
  });
});
