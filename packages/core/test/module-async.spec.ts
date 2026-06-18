import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTEXT_ACCESSOR,
  CONTEXT_MODULE_OPTIONS,
  Context,
  ContextModule,
  contextAccessor,
} from '../src/index.js';
import type { ContextModuleOptions, ContextModuleOptionsFactory } from '../src/types.js';

afterEach(() => {
  // The singleton config is process-global; reset between tests so one app's
  // carrier/serialize/enrichers never bleeds into the next.
  Context.resetConfig();
});

describe('ContextModule.forRootAsync', () => {
  it('is a global dynamic module exporting the accessor + options', () => {
    const mod = ContextModule.forRootAsync({ useFactory: () => ({}) });
    expect(mod.module).toBe(ContextModule);
    expect(mod.global).toBe(true);
    expect(mod.exports).toContain(CONTEXT_ACCESSOR);
    expect(mod.exports).toContain(CONTEXT_MODULE_OPTIONS);
  });

  it('wires the imports through to the dynamic module', () => {
    @Module({})
    class SomeImport {}
    const mod = ContextModule.forRootAsync({ imports: [SomeImport], useFactory: () => ({}) });
    expect(mod.imports).toContain(SomeImport);
  });

  it('resolves options from useFactory and binds CONTEXT_MODULE_OPTIONS', async () => {
    const options: ContextModuleOptions = { traceHeader: 'x-async-trace' };
    const moduleRef = await Test.createTestingModule({
      imports: [ContextModule.forRootAsync({ useFactory: () => options })],
    }).compile();

    const resolved = moduleRef.get<ContextModuleOptions>(CONTEXT_MODULE_OPTIONS);
    expect(resolved.traceHeader).toBe('x-async-trace');
    const accessor = moduleRef.get(CONTEXT_ACCESSOR);
    expect(accessor).toBe(contextAccessor);
    await moduleRef.close();
  });

  it('injects DI dependencies into useFactory', async () => {
    @Injectable()
    class ConfigService {
      readonly header = 'x-from-config';
    }
    @Module({ providers: [ConfigService], exports: [ConfigService] })
    class ConfigModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        ContextModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (...args: unknown[]) => {
            const config = args[0] as ConfigService;
            return { traceHeader: config.header };
          },
        }),
      ],
    }).compile();
    await moduleRef.init();

    const resolved = moduleRef.get<ContextModuleOptions>(CONTEXT_MODULE_OPTIONS);
    expect(resolved.traceHeader).toBe('x-from-config');
    await moduleRef.close();
  });

  it('applies the resolved options to the singleton (carrier/enrichers) after init', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ContextModule.forRootAsync({
          useFactory: (): ContextModuleOptions => ({
            carrier: ['traceId', 'tenantId'],
            enrichers: [() => ({ tenantId: 'derived' })],
          }),
        }),
      ],
    }).compile();
    // onModuleInit is where the async path pushes resolved options to the singleton.
    await moduleRef.init();

    // enricher applied via singleton runEnrichers
    Context.run({ traceId: 't1' }, () => {
      Context.runEnrichers();
      expect(Context.tenantId()).toBe('derived');
      // carrier override honored (userRef excluded)
      const carrier = Context.serialize();
      expect(carrier).toEqual({ traceId: 't1', tenantId: 'derived' });
    });
    await moduleRef.close();
  });

  it('supports useClass via a ContextModuleOptionsFactory', async () => {
    @Injectable()
    class OptionsFactory implements ContextModuleOptionsFactory {
      createContextOptions(): ContextModuleOptions {
        return { traceHeader: 'x-class-trace' };
      }
    }

    const moduleRef = await Test.createTestingModule({
      imports: [ContextModule.forRootAsync({ useClass: OptionsFactory })],
    }).compile();
    await moduleRef.init();

    const resolved = moduleRef.get<ContextModuleOptions>(CONTEXT_MODULE_OPTIONS);
    expect(resolved.traceHeader).toBe('x-class-trace');
    await moduleRef.close();
  });

  it('supports useExisting via an already-provided factory', async () => {
    @Injectable()
    class OptionsFactory implements ContextModuleOptionsFactory {
      createContextOptions(): ContextModuleOptions {
        return { traceHeader: 'x-existing-trace' };
      }
    }
    @Module({ providers: [OptionsFactory], exports: [OptionsFactory] })
    class FactoryModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        ContextModule.forRootAsync({ imports: [FactoryModule], useExisting: OptionsFactory }),
      ],
    }).compile();
    await moduleRef.init();

    const resolved = moduleRef.get<ContextModuleOptions>(CONTEXT_MODULE_OPTIONS);
    expect(resolved.traceHeader).toBe('x-existing-trace');
    await moduleRef.close();
  });
});

describe('ContextModule.forRoot stays backward-compatible', () => {
  it('still configures the singleton synchronously at wiring time', () => {
    ContextModule.forRoot({ carrier: ['traceId'] });
    Context.run({ traceId: 't9', tenantId: 'tn' }, () => {
      expect(Context.serialize()).toEqual({ traceId: 't9' });
    });
  });
});
