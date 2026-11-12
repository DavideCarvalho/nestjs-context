import { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { wireContextIntoDiagnostics } from '../src/diagnostics-bridge.js';
import {
  CONTEXT_TENANCY_SLOT,
  Context,
  type ContextStore,
  type TenancySlot,
  TenantRequiredError,
  contextAccessor,
  tenancySlot,
} from '../src/index.js';
import { canSeeRow, readTenancy, rowTenantId, tenantLabels } from './fixtures/tenancy-reader.js';

const clinic = { id: 'c1', kind: 'clinic', slug: 'sunny' } as const;
const unit = { id: 'u1', kind: 'unit' } as const;
const account = { id: 'a1', kind: 'account' } as const;
const nested = { ...unit, chain: [clinic] };

function inStore<T>(store: Partial<ContextStore>, fn: () => T): T {
  return Context.run({ traceId: 't', ...store }, fn);
}

beforeEach(() => {
  Context.resetConfig();
  Context.resetSetWarning();
});
afterEach(() => {
  Context.resetConfig();
});

describe('chain', () => {
  it('stores the chain root first, with the tenant itself last', () => {
    Context.withTenant(nested, () => {
      expect(Context.tenant()).toEqual({
        ...unit,
        source: 'app',
        chain: [clinic, unit],
      });
      expect(Context.tenantChain()).toEqual([clinic, unit]);
      expect(Context.tenantId()).toBe('u1');
    });
  });

  it('accepts the tenant as the last chain item, and its own fields win', () => {
    Context.withTenant({ ...unit, role: 'nurse', chain: [clinic, { ...unit }] }, () => {
      expect(Context.tenant()?.chain).toEqual([clinic, { ...unit, role: 'nurse' }]);
    });
  });

  it('a flat tenant has no chain field but a chain of one', () => {
    Context.withTenant(clinic, () => {
      expect(Context.tenant()?.chain).toBeUndefined();
      expect(Context.tenantChain()).toEqual([clinic]);
    });
    inStore({}, () => expect(Context.tenantChain()).toEqual([]));
    expect(Context.tenantChain()).toEqual([]);
  });

  it('validates chain levels', () => {
    inStore({}, () => {
      expect(() => Context.setTenant({ ...unit, chain: [{ id: '', kind: 'clinic' }] })).toThrow(
        /non-empty `id`/,
      );
      expect(() => Context.setTenant({ ...unit, chain: 'nope' as never })).toThrow(/array/);
      expect(() => Context.setTenant({ ...unit, family: '' })).toThrow(/family/);
    });
  });

  it('hands out deep copies', () => {
    Context.withTenant(nested, () => {
      const got = Context.tenant()!;
      (got.chain![0] as { id: string }).id = 'evil';
      const filter = Context.tenantFilter();
      if (filter.mode === 'tenant') (filter.chain[0] as { id: string }).id = 'evil';
      expect(Context.tenantChain()[0]?.id).toBe('c1');
    });
  });
});

describe('level-aware kinds', () => {
  it('scopes by the most specific level whose kind is listed', () => {
    Context.withTenant(nested, () => {
      expect(Context.tenantFilter({ kinds: ['clinic'] })).toEqual({
        mode: 'tenant',
        tenant: { ...clinic, source: 'app' },
        chain: [clinic],
      });
      expect(Context.tenantFilter({ kinds: ['unit'] })).toEqual({
        mode: 'tenant',
        tenant: { ...unit, source: 'app', chain: [clinic, unit] },
        chain: [clinic, unit],
      });
      expect(Context.tenantFilter({ kinds: ['clinic', 'unit'] })).toMatchObject({
        tenant: { id: 'u1' },
      });
      expect(Context.tenantFilter({ kinds: ['organization'] })).toEqual({ mode: 'tenantless' });
      expect(Context.tenantFilter()).toMatchObject({ tenant: { id: 'u1' } });
    });
  });

  it('uses the context kinds when the lib has none', () => {
    Context.configure({ tenancy: { enabled: true, kinds: ['clinic'] } });
    Context.withTenant(nested, () => {
      expect(Context.tenantFilter()).toMatchObject({ mode: 'tenant', tenant: { id: 'c1' } });
    });
  });
});

describe('families', () => {
  it('keeps a second family next to the primary tenant', () => {
    inStore({}, () => {
      Context.setTenant(nested);
      Context.setTenant(account, { family: 'account' });
      expect(Context.tenantId()).toBe('u1');
      expect(Context.tenants().map((t) => [t.id, t.family])).toEqual([
        ['u1', undefined],
        ['a1', 'account'],
      ]);
      expect(Context.tenantChain('account')).toEqual([account]);
      expect(Context.tenantChain('nope')).toEqual([]);

      // Without kinds or family, only the primary tenant counts.
      expect(Context.tenantFilter()).toMatchObject({ tenant: { id: 'u1' } });
      // A lib configured for the other family's kind, or naming it, scopes by it.
      expect(Context.tenantFilter({ kinds: ['account'] })).toMatchObject({
        tenant: { id: 'a1', family: 'account' },
      });
      expect(Context.tenantFilter({ family: 'account' })).toMatchObject({
        tenant: { id: 'a1' },
      });
      expect(Context.tenantFilter({ family: 'account', kinds: ['clinic'] })).toEqual({
        mode: 'tenantless',
      });

      Context.setTenant(null, { family: 'account' });
      expect(Context.tenants()).toHaveLength(1);
      expect(Context.get()?.tenantFamilies).toBeUndefined();
    });
  });

  it('a family alone is not the primary tenant', () => {
    Context.withTenant(
      account,
      () => {
        expect(Context.tenant()).toBeUndefined();
        expect(Context.tenantFilter()).toEqual({ mode: 'tenantless' });
        expect(Context.tenantFilter({ kinds: ['account'] })).toMatchObject({ mode: 'tenant' });
      },
      { family: 'account' },
    );
  });

  it('withTenant(null) clears every family; withTenant(x, fn, { family }) changes only that one', () => {
    Context.withTenant(clinic, () => {
      Context.withTenant(
        account,
        () => {
          expect(Context.tenants().map((t) => t.id)).toEqual(['c1', 'a1']);
          Context.withTenant(null, () => expect(Context.tenants()).toEqual([]));
          expect(Context.tenants()).toHaveLength(2);
        },
        { family: 'account' },
      );
      expect(Context.tenants()).toHaveLength(1);
    });
  });

  it('Context.set("tenantFamilies") drops malformed entries', () => {
    inStore({}, () => {
      Context.set('tenantFamilies', [
        { ...account, source: 'app', family: 'account' },
        { id: '', kind: 'x', source: 'app', family: 'bad' },
        { ...account, source: 'app' },
      ]);
      expect(Context.get()?.tenantFamilies).toEqual([
        { ...account, source: 'app', family: 'account' },
      ]);
    });
  });
});

describe('carrier', () => {
  it('round-trips the chain and the families, as source carrier', () => {
    const carrier = Context.withTenant(nested, () =>
      Context.withTenant(account, () => Context.serialize(), { family: 'account' }),
    );
    Context.deserialize(carrier!, () => {
      expect(Context.tenant()).toEqual({ ...unit, source: 'carrier', chain: [clinic, unit] });
      expect(Context.tenants()[1]).toEqual({ ...account, source: 'carrier', family: 'account' });
    });
  });

  it('with tenancy on, families ride a carrier list that leaves them out', () => {
    Context.configure({ tenancy: { enabled: true }, carrier: ['traceId'] });
    const carrier = Context.withTenant(clinic, () =>
      Context.withTenant(account, () => Context.serialize(), { family: 'account' }),
    );
    expect(carrier?.tenantFamilies).toEqual([{ ...account, source: 'app', family: 'account' }]);
  });

  it('never carries a personal tenant (the userRef re-derives it)', () => {
    Context.configure({ tenancy: { enabled: true, personal: true }, carrier: ['traceId'] });
    const carrier = inStore({ userRef: { type: 'User', id: 7 } }, () => Context.serialize());
    expect(carrier).toEqual({ traceId: 't' });
  });
});

describe('required', () => {
  it('throws a 403 TenantRequiredError instead of answering tenantless', () => {
    Context.configure({ tenancy: { enabled: true, required: true } });
    inStore({}, () => {
      let error: unknown;
      try {
        Context.tenantFilter();
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(TenantRequiredError);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as TenantRequiredError).getStatus()).toBe(403);
      expect((error as TenantRequiredError).code).toBe('E_TENANT_REQUIRED');
      // A lib may opt out for a path that is fine without a tenant.
      expect(Context.tenantFilter({ required: false })).toEqual({ mode: 'tenantless' });
    });
    // No context and allTenants never throw.
    expect(Context.tenantFilter()).toEqual({ mode: 'system' });
    Context.allTenants(() => expect(Context.tenantFilter()).toEqual({ mode: 'all' }));
    // A tenant of another kind is a missing tenant too.
    Context.withTenant(clinic, () => {
      expect(() => Context.tenantFilter({ kinds: ['organization'] })).toThrow(TenantRequiredError);
    });
  });

  it('is ignored while tenancy is off, unless a lib asks for it', () => {
    Context.configure({ tenancy: { required: true } });
    inStore({}, () => {
      expect(Context.tenantFilter()).toEqual({ mode: 'tenantless' });
      expect(() => Context.tenantFilter({ required: true })).toThrow(TenantRequiredError);
    });
  });

  it('requireTenant returns the matching tenant or throws', () => {
    Context.withTenant(nested, () => {
      expect(Context.requireTenant({ kinds: ['clinic'] }).id).toBe('c1');
      expect(() => Context.requireTenant({ kinds: ['organization'] })).toThrow(TenantRequiredError);
    });
    expect(() => Context.requireTenant()).toThrow(TenantRequiredError);
    Context.allTenants(() => expect(() => Context.requireTenant()).toThrow(TenantRequiredError));
  });

  it('reaches published readers through tenantFilter', () => {
    Context.configure({ tenancy: { enabled: true, required: true } });
    inStore({}, () => {
      expect(() => rowTenantId(readTenancy('inherit', contextAccessor))).toThrow(
        TenantRequiredError,
      );
      expect(rowTenantId(readTenancy({ required: false }, contextAccessor))).toBeNull();
    });
  });
});

describe('personal', () => {
  const user = { type: 'User', id: 42 };

  it('is off by default: a user with no tenant is tenantless', () => {
    Context.configure({ tenancy: { enabled: true } });
    inStore({ userRef: user }, () => {
      expect(Context.tenant()).toBeUndefined();
      expect(Context.tenantFilter()).toEqual({ mode: 'tenantless' });
      expect(() => Context.setTenant({ kind: 'user' })).toThrow(/tenancy.personal/);
    });
  });

  it('on: the signed-in user is a kind user tenant until the app sets another', () => {
    Context.configure({ tenancy: { enabled: true, personal: true } });
    inStore({ userRef: user }, () => {
      expect(Context.tenant()).toEqual({ id: '42', kind: 'user', source: 'personal' });
      expect(Context.tenantId()).toBe('42');
      expect(Context.tenantFilter()).toMatchObject({ tenant: { id: '42', kind: 'user' } });
      Context.setTenant(clinic);
      expect(Context.tenant()?.id).toBe('c1');
    });
    inStore({}, () => expect(Context.tenant()).toBeUndefined());
  });

  it('setTenant({ kind: "user" }) takes the id from userRef', () => {
    Context.configure({ tenancy: { enabled: true, personal: true } });
    inStore({ userRef: user }, () => {
      Context.setTenant(clinic);
      Context.setTenant({ kind: 'user', slug: 'me' });
      expect(Context.tenant()).toEqual({ id: '42', kind: 'user', source: 'personal', slug: 'me' });
      expect(Context.get()?.tenantId).toBe('42');
    });
    inStore({}, () => {
      expect(() => Context.setTenant({ kind: 'user' })).toThrow(/userRef/);
    });
  });
});

describe('labels', () => {
  it('falls back to the slug, then the id', async () => {
    expect(await Context.tenantLabel(clinic)).toBe('sunny');
    expect(await Context.tenantLabels([clinic, unit])).toEqual({ c1: 'sunny', u1: 'u1' });
  });

  it('uses tenancy.label, and survives a failing resolver', async () => {
    Context.configure({
      tenancy: {
        enabled: true,
        label: async (t) => {
          if (t.id === 'boom') throw new Error('db down');
          return t.kind === 'clinic' ? `Clinic ${t.id}` : undefined;
        },
      },
    });
    expect(await Context.tenantLabels([clinic, unit, { id: 'boom', kind: 'clinic' }])).toEqual({
      c1: 'Clinic c1',
      u1: 'u1',
      boom: 'boom',
    });
  });

  it('a registered labeler applies unless the config has one', async () => {
    Context.setTenantLabeler((t) => `Reg ${t.id}`);
    expect(await Context.tenantLabel(unit)).toBe('Reg u1');
    Context.configure({ tenancy: { label: () => 'Config' } });
    Context.setTenantLabeler((t) => `Reg ${t.id}`);
    expect(await Context.tenantLabel(unit)).toBe('Config');
    Context.setTenantLabeler(undefined);
  });

  it('the reader helper uses the accessor, else slug/id', async () => {
    Context.configure({ tenancy: { label: (t) => t.id.toUpperCase() } });
    expect(await tenantLabels([clinic], contextAccessor)).toEqual({ c1: 'C1' });
    expect(await tenantLabels([clinic, unit], { tenancy: () => ({ enabled: true }) })).toEqual({
      c1: 'sunny',
      u1: 'u1',
    });
  });
});

describe('the tenancy slot', () => {
  it('is published, frozen and versioned when the module wires up', async () => {
    await wireContextIntoDiagnostics();
    const slot = (globalThis as unknown as Record<symbol, TenancySlot | undefined>)[
      CONTEXT_TENANCY_SLOT
    ];
    expect(slot).toBe(tenancySlot);
    expect(slot?.version).toBe(1);
    expect(Object.isFrozen(slot)).toBe(true);
    expect(CONTEXT_TENANCY_SLOT).toBe(Symbol.for('@dudousxd/nestjs-context:tenancy'));
  });

  it('reads and writes through the Context', () => {
    tenancySlot.withTenant(nested, () => {
      expect(tenancySlot.tenant()?.id).toBe('u1');
      expect(tenancySlot.tenantChain().map((l) => l.id)).toEqual(['c1', 'u1']);
      expect(tenancySlot.requireTenant({ kinds: ['clinic'] }).id).toBe('c1');
      tenancySlot.allTenants(() => expect(tenancySlot.tenantFilter()).toEqual({ mode: 'all' }));
    });
  });
});

describe('readers already published (context 2.0 shape)', () => {
  // Byte-for-byte the reader telescope 4 / durable 0.58 / agent 3 / media 0.12 /
  // notifications / authz 0.11 ship: it only knows `{ kinds }` and `tenant.id`.
  interface V1Accessor {
    tenancy?(): { enabled: boolean; kinds?: string[] };
    tenantFilter?(options?: { kinds?: string[] }): {
      mode: string;
      tenant?: { id: string; kind: string };
    };
  }
  function v1Filter(kinds?: string[]) {
    const a = contextAccessor as V1Accessor;
    if (typeof a.tenancy !== 'function' || !a.tenantFilter || !a.tenancy().enabled) {
      return undefined;
    }
    return a.tenantFilter(kinds ? { kinds } : undefined);
  }

  it('keep working: they scope by the level their kinds pick', () => {
    Context.configure({ tenancy: { enabled: true } });
    Context.withTenant(nested, () => {
      expect(v1Filter()?.tenant?.id).toBe('u1');
      expect(v1Filter(['clinic'])).toMatchObject({ mode: 'tenant', tenant: { id: 'c1' } });
      expect(v1Filter(['organization'])?.mode).toBe('tenantless');
    });
  });

  it('the new reader matches rows per level', () => {
    Context.configure({ tenancy: { enabled: true } });
    Context.withTenant(nested, () => {
      const byClinic = readTenancy({ kinds: ['clinic'] }, contextAccessor);
      const byUnit = readTenancy({ kinds: ['unit'] }, contextAccessor);
      expect([canSeeRow(byClinic, 'c1'), canSeeRow(byClinic, 'u1')]).toEqual([true, false]);
      expect([canSeeRow(byUnit, 'u1'), canSeeRow(byUnit, 'c1')]).toEqual([true, false]);
      expect(rowTenantId(byClinic)).toBe('c1');
    });
  });
});
