import type { AddressInfo } from 'node:net';
import {
  AuthenticationContext,
  AuthenticationModule,
  AuthenticationProvider,
  AuthenticationRegistry,
  type AuthenticationResult,
} from '@nestjs/authentication';
import {
  Controller,
  type ExecutionContext,
  Get,
  type INestApplication,
  Injectable,
  Module,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Context,
  ContextAuthenticationInterceptor,
  type ContextCarrier,
  ContextModule,
  type ContextModuleOptions,
  ContextRunner,
  type UserRef,
} from '../src/index.js';

interface User {
  id: string;
  email: string;
  org: string;
}

const USERS: Record<string, User> = {
  u1: { id: 'u1', email: 'ada@example.com', org: 'acme' },
};

/** Bearer `<id>` → that user. Enough to drive the real official guard. */
@Injectable()
class FakeBearer extends AuthenticationProvider<User> {
  constructor(registry: AuthenticationRegistry) {
    super();
    registry.registerProvider(this);
  }
  authenticate(context: ExecutionContext): AuthenticationResult<User> | null {
    const header = this.header(context, 'authorization');
    const user = header ? USERS[header.replace(/^Bearer /, '')] : undefined;
    return user ? { user, session: { sid: `s-${user.id}` } } : null;
  }
}

@Controller()
class ProbeController {
  constructor(private readonly auth: AuthenticationContext<User>) {}

  @Get('probe')
  probe() {
    return {
      userRef: Context.userRef() ?? null,
      carrier: Context.serialize() ?? null,
      officialUser: this.auth.user?.id ?? null,
    };
  }
}

function authModule() {
  return AuthenticationModule.forRoot({ allowInMemoryStorage: true });
}

async function boot(options: ContextModuleOptions = {}, contextFirst = false) {
  const imports = contextFirst
    ? [ContextModule.forRoot(options), authModule()]
    : [authModule(), ContextModule.forRoot(options)];

  @Module({ imports, controllers: [ProbeController], providers: [FakeBearer] })
  class AppModule {}

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  return app;
}

async function get(app: INestApplication, token?: string) {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/probe`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

let app: INestApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  Context.resetConfig();
  ContextAuthenticationInterceptor.resetWarning();
  vi.restoreAllMocks();
});

describe('read side: AuthenticationContext.user → Context userRef', () => {
  it('sets userRef from the official AuthenticationContext (default mapping)', async () => {
    app = await boot();
    const { status, body } = await get(app, 'u1');
    expect(status).toBe(200);
    expect(body.officialUser).toBe('u1');
    expect(body.userRef).toEqual({ type: 'user', id: 'u1' });
  });

  it('honours a custom userRefFrom', async () => {
    app = await boot({
      userRefFrom: (user) => ({ type: 'member', id: `${(user as User).org}:${(user as User).id}` }),
    });
    const { body } = await get(app, 'u1');
    expect(body.userRef).toEqual({ type: 'member', id: 'acme:u1' });
  });

  it('carries only the reference — never the user or the session', async () => {
    app = await boot();
    const { body } = await get(app, 'u1');
    const carrier = body.carrier as Record<string, unknown>;
    expect(carrier.userRef).toEqual({ type: 'user', id: 'u1' });
    expect(Object.keys(carrier).sort()).toEqual(['traceId', 'userRef']);
    expect(JSON.stringify(carrier)).not.toContain('ada@example.com');
    expect(JSON.stringify(carrier)).not.toContain('s-u1');
  });

  it('leaves userRef unset when the official guard rejects the call', async () => {
    app = await boot();
    const { status } = await get(app);
    expect(status).toBe(401);
  });
});

describe('interceptor order', () => {
  it('runs inside the official interceptor when ContextModule is imported after AuthenticationModule', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    app = await boot({}, false);
    const { body } = await get(app, 'u1');
    expect(body.userRef).toEqual({ type: 'user', id: 'u1' });
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('AuthenticationContext is empty'),
    );
  });

  it('imported first, it runs outside the official scope: sets nothing and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    app = await boot({}, true);
    const first = await get(app, 'u1');
    await get(app, 'u1');
    // The handler itself still sees the official user — only our bridge missed it.
    expect(first.body.officialUser).toBe('u1');
    expect(first.body.userRef).toBeNull();
    const ordering = warn.mock.calls.filter((c) =>
      String(c[0]).includes('AuthenticationContext is empty'),
    );
    expect(ordering).toHaveLength(1);
  });
});

describe('write side: ContextRunner rehydrates on the other side', () => {
  async function bootWorker(options: ContextModuleOptions) {
    @Module({ imports: [authModule(), ContextModule.forRoot(options)] })
    class WorkerModule {}
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    const worker = moduleRef.createNestApplication({ logger: false });
    await worker.init();
    return worker;
  }

  it('a carrier from a request yields AuthenticationContext.user in the worker', async () => {
    app = await boot();
    const { body } = await get(app, 'u1');
    const carrier = body.carrier as ContextCarrier;
    await app.close();
    app = undefined;

    const seen: UserRef[] = [];
    app = await bootWorker({
      rehydrateUser: async (ref) => {
        seen.push(ref);
        // Inside the restored context: the lookup is traced.
        expect(Context.traceId()).toBe(carrier.traceId);
        const user = USERS[String(ref.id)];
        return user ? { user } : null;
      },
    });
    const runner = app.get(ContextRunner);
    const auth = app.get<AuthenticationContext<User>>(AuthenticationContext);

    const out = await runner.run(carrier, async () => {
      await Promise.resolve();
      return {
        user: auth.user,
        isAuthenticated: auth.isAuthenticated,
        traceId: Context.traceId(),
        userRef: Context.userRef(),
      };
    });

    expect(seen).toEqual([{ type: 'user', id: 'u1' }]);
    expect(out.user).toEqual(USERS.u1);
    expect(out.isAuthenticated).toBe(true);
    expect(out.traceId).toBe(carrier.traceId);
    expect(out.userRef).toEqual({ type: 'user', id: 'u1' });
    // Outside run(), nothing leaks.
    expect(auth.user).toBeNull();
  });

  it('runs anonymous without a userRef, without rehydrateUser, or when rehydrate returns null', async () => {
    const rehydrateUser = vi.fn(async () => null);
    app = await bootWorker({ rehydrateUser });
    const runner = app.get(ContextRunner);
    const auth = app.get<AuthenticationContext<User>>(AuthenticationContext);

    expect(await runner.run({ traceId: 't1' }, () => auth.user)).toBeNull();
    expect(rehydrateUser).not.toHaveBeenCalled();
    expect(
      await runner.run({ traceId: 't2', userRef: { type: 'user', id: 'gone' } }, () => auth.user),
    ).toBeNull();
    expect(rehydrateUser).toHaveBeenCalledOnce();
  });

  it('starts a fresh context for a missing carrier, and propagates rehydrate errors', async () => {
    app = await bootWorker({
      rehydrateUser: async () => {
        throw new Error('db down');
      },
    });
    const runner = app.get(ContextRunner);
    expect(await runner.run(undefined, () => Context.traceId())).toMatch(/^[0-9a-f]{32}$/);
    await expect(
      runner.run({ traceId: 't', userRef: { type: 'user', id: 'u1' } }, () => 1),
    ).rejects.toThrow('db down');
  });

  it('without AuthenticationModule it is Context.deserialize with an async fn', async () => {
    @Module({ imports: [ContextModule.forRoot({ rehydrateUser: () => ({ user: USERS.u1 }) })] })
    class PlainModule {}
    const moduleRef = await Test.createTestingModule({ imports: [PlainModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const runner = app.get(ContextRunner);
    const out = await runner.run(
      { traceId: 'abc', tenantId: 't1', userRef: { type: 'user', id: 'u1' } },
      async () => Context.get(),
    );
    expect(out).toEqual({ traceId: 'abc', tenantId: 't1', userRef: { type: 'user', id: 'u1' } });
  });
});
