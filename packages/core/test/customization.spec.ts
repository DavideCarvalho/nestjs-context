import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Context,
  type ContextCarrier,
  ContextMiddleware,
  ContextModule,
  type ContextStore,
} from '../src/index.js';

// Custom field for carrier/initialize tests (DESIGN §4.1 level 1 augmentation).
declare module '../src/index.js' {
  interface ContextStore {
    locale?: string;
  }
}

afterEach(() => {
  // The singleton config is module-level; reset so cross-process tests don't
  // leak into each other or into the back-compat default-behaviour tests.
  Context.resetConfig();
});

describe('Level 2 — population hooks', () => {
  it('uses a custom traceId hook over the header/random default', () => {
    const mw = new ContextMiddleware({
      traceId: (req) => `trace-${req.headers?.['x-correlation-id']}`,
    });
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    Context.run({ traceId: 'placeholder' }, () => {
      mw.use({ headers: { traceparent, 'x-correlation-id': 'corr-9' } }, {}, () => {});
      // header is ignored because the hook wins
      expect(Context.traceId()).toBe('trace-corr-9');
    });
  });

  it('falls back to header/random when traceId hook is absent', () => {
    const mw = new ContextMiddleware({});
    Context.run({ traceId: 'placeholder' }, () => {
      mw.use({ headers: {} }, {}, () => {});
      expect(Context.traceId()).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  it('merges initialize() fields into the initial store', () => {
    const mw = new ContextMiddleware({
      initialize: (req) => ({
        tenantId: `tenant-${req.headers?.host}`,
        locale: 'pt-BR',
      }),
    });
    Context.run({ traceId: 'placeholder' }, () => {
      mw.use({ headers: { host: 'acme', 'x-request-id': 'req-1' } }, {}, () => {});
      expect(Context.tenantId()).toBe('tenant-acme');
      expect(Context.get()?.locale).toBe('pt-BR');
      // base fields still present
      expect(Context.get()?.requestId).toBe('req-1');
      expect(Context.traceId()).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  it('initialize() CANNOT clobber the resolved traceId/requestId (P8 precedence)', () => {
    const mw = new ContextMiddleware({
      // initialize is merged FIRST; the dedicated traceId/requestId win LAST.
      initialize: () => ({ traceId: 'forced', requestId: 'forced-req' }),
    });
    Context.run({ traceId: 'placeholder' }, () => {
      mw.use({ headers: { 'x-request-id': 'header-req' } }, {}, () => {});
      // header/random-resolved traceId wins over initialize's stray traceId
      expect(Context.traceId()).toMatch(/^[0-9a-f]{32}$/);
      expect(Context.traceId()).not.toBe('forced');
      // header request-id wins over initialize's stray requestId
      expect(Context.get()?.requestId).toBe('header-req');
    });
  });

  it('initialize() requestId persists when no x-request-id header is present', () => {
    const mw = new ContextMiddleware({
      initialize: () => ({ requestId: 'from-init', tenantId: 'acme' }),
    });
    Context.run({ traceId: 'placeholder' }, () => {
      mw.use({ headers: {} }, {}, () => {});
      // no header to override it, so initialize's requestId survives
      expect(Context.get()?.requestId).toBe('from-init');
      expect(Context.tenantId()).toBe('acme');
    });
  });

  it('treats an empty-string x-request-id as absent (LOW)', () => {
    const mw = new ContextMiddleware({});
    Context.run({ traceId: 'placeholder' }, () => {
      mw.use({ headers: { 'x-request-id': '' } }, {}, () => {});
      expect(Context.get()?.requestId).toBeUndefined();
    });
  });

  it('the traceId hook wins even when initialize returns a traceId (P8)', () => {
    const mw = new ContextMiddleware({
      traceId: () => 'hook-trace',
      initialize: () => ({ traceId: 'init-trace' }),
    });
    Context.run({ traceId: 'placeholder' }, () => {
      mw.use({ headers: {} }, {}, () => {});
      expect(Context.traceId()).toBe('hook-trace');
    });
  });
});

describe('Level 3 — entrypoint toggle', () => {
  it('autoMiddleware:false registers NO middleware', () => {
    const apply = vi.fn();
    const consumer = { apply } as never;
    new ContextModule({ autoMiddleware: false }).configure(consumer);
    expect(apply).not.toHaveBeenCalled();
  });

  it('registers the middleware by default (autoMiddleware undefined)', () => {
    const forRoutes = vi.fn();
    const apply = vi.fn().mockReturnValue({ forRoutes });
    const consumer = { apply } as never;
    new ContextModule({}).configure(consumer);
    expect(apply).toHaveBeenCalledWith(ContextMiddleware);
    expect(forRoutes).toHaveBeenCalledWith('*');
  });

  it('passes custom forRoutes and exclude through to the consumer', () => {
    const forRoutes = vi.fn();
    const exclude = vi.fn().mockReturnValue({ forRoutes });
    const apply = vi.fn().mockReturnValue({ forRoutes, exclude });
    const consumer = { apply } as never;
    new ContextModule({
      forRoutes: ['api/*'],
      exclude: ['health', 'metrics'],
    }).configure(consumer);
    expect(exclude).toHaveBeenCalledWith('health', 'metrics');
    expect(forRoutes).toHaveBeenCalledWith('api/*');
  });
});

describe('Level 4 — configurable carrier', () => {
  it('serialize() includes a custom augmented field when listed in carrier', () => {
    Context.configure({ carrier: ['traceId', 'tenantId', 'userRef', 'locale'] });
    Context.run({ traceId: 't', tenantId: 'ten', locale: 'es-ES' }, () => {
      const carrier = Context.serialize() as ContextCarrier & { locale?: string };
      expect(carrier?.traceId).toBe('t');
      expect(carrier?.tenantId).toBe('ten');
      expect(carrier?.locale).toBe('es-ES');
    });
  });

  it('serialize() excludes fields not listed in a custom carrier', () => {
    Context.configure({ carrier: ['traceId'] });
    Context.run({ traceId: 't', tenantId: 'ten', userRef: { type: 'user', id: 1 } }, () => {
      expect(Context.serialize()).toEqual({ traceId: 't' });
    });
  });

  it('full serialize/deserialize override is honoured', () => {
    const serialize = (s: ContextStore): ContextCarrier =>
      ({ traceId: s.traceId, tenantId: `T:${s.tenantId}` }) as ContextCarrier;
    const deserialize = (c: ContextCarrier): ContextStore => ({
      traceId: c.traceId,
      tenantId: (c.tenantId ?? '').replace(/^T:/, ''),
    });
    Context.configure({ serialize, deserialize });

    let carrier: ReturnType<typeof Context.serialize>;
    Context.run({ traceId: 'x', tenantId: 'acme' }, () => {
      carrier = Context.serialize();
    });
    expect(carrier).toEqual({ traceId: 'x', tenantId: 'T:acme' });

    Context.deserialize(carrier!, () => {
      expect(Context.traceId()).toBe('x');
      expect(Context.tenantId()).toBe('acme');
    });
  });

  it('defaults are preserved when configure was never called', () => {
    // resetConfig in afterEach guarantees a clean slate here.
    Context.run({ traceId: 'd', tenantId: 'tn', userRef: { type: 'user', id: 2 } }, () => {
      expect(Context.serialize()).toEqual({
        traceId: 'd',
        tenantId: 'tn',
        userRef: { type: 'user', id: 2 },
      });
    });
  });

  it('forRoot pushes carrier config into the singleton', () => {
    ContextModule.forRoot({ carrier: ['traceId', 'locale'] });
    Context.run({ traceId: 'fr', tenantId: 'skip', locale: 'fr-FR' }, () => {
      expect(Context.serialize()).toEqual({ traceId: 'fr', locale: 'fr-FR' });
    });
  });
});

describe('P7 — config is process-global, replaced wholesale (no mixed pair)', () => {
  it('a second forRoot REPLACES the config — never an A.serialize + B.deserialize mix', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // App A: custom serialize/deserialize as a matched PAIR.
    const serializeA = (s: ContextStore): ContextCarrier =>
      ({ traceId: s.traceId, tenantId: `A:${s.tenantId}` }) as ContextCarrier;
    const deserializeA = (c: ContextCarrier): ContextStore => ({
      traceId: c.traceId,
      tenantId: (c.tenantId ?? '').replace(/^A:/, ''),
    });
    ContextModule.forRoot({ serialize: serializeA, deserialize: deserializeA });

    // App B: a DIFFERENT matched pair. This must NOT merge into A's config
    // (which would leave A's deserialize paired with B's serialize, or similar).
    const serializeB = (s: ContextStore): ContextCarrier =>
      ({ traceId: s.traceId, tenantId: `B:${s.tenantId}` }) as ContextCarrier;
    const deserializeB = (c: ContextCarrier): ContextStore => ({
      traceId: c.traceId,
      tenantId: (c.tenantId ?? '').replace(/^B:/, ''),
    });
    ContextModule.forRoot({ serialize: serializeB, deserialize: deserializeB });

    // The active config must be B's pair, intact — serialize+deserialize from B.
    let carrier: ReturnType<typeof Context.serialize>;
    Context.run({ traceId: 'x', tenantId: 'acme' }, () => {
      carrier = Context.serialize();
    });
    // B's serialize ran (B: prefix), NOT A's (A: prefix).
    expect(carrier).toEqual({ traceId: 'x', tenantId: 'B:acme' });

    Context.deserialize(carrier!, () => {
      // B's deserialize ran and correctly stripped B:'s own prefix — proving the
      // pair is matched, not A.deserialize trying to strip A: off a B: value.
      expect(Context.tenantId()).toBe('acme');
    });

    // And the conflicting second forRoot warned.
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('process-global');

    warn.mockRestore();
  });

  it('does NOT warn when the second forRoot config is identical', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ContextModule.forRoot({ carrier: ['traceId', 'tenantId'] });
    ContextModule.forRoot({ carrier: ['traceId', 'tenantId'] });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('resetConfig() clears the configured flag so the next forRoot is silent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ContextModule.forRoot({ carrier: ['traceId'] });
    Context.resetConfig();
    ContextModule.forRoot({ carrier: ['traceId', 'tenantId'] });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
