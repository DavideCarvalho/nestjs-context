import {
  type DynamicModule,
  Inject,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  type OnModuleInit,
  type Provider,
  type Type,
} from '@nestjs/common';
import { contextAccessor } from './accessor.js';
import { Context } from './context.js';
import { wireContextIntoDiagnostics } from './diagnostics-bridge.js';
import { ContextMiddleware } from './middleware.js';
import { CONTEXT_ACCESSOR, CONTEXT_MODULE_OPTIONS } from './tokens.js';
import type {
  ContextModuleAsyncOptions,
  ContextModuleOptions,
  ContextModuleOptionsFactory,
} from './types.js';

/**
 * Global module that wires the per-request context: registers
 * {@link ContextMiddleware} (unless `autoMiddleware: false`) and exposes the
 * global {@link CONTEXT_ACCESSOR} token other libs inject. See DESIGN §4.
 */
@Module({})
export class ContextModule implements NestModule, OnModuleInit {
  constructor(
    @Inject(CONTEXT_MODULE_OPTIONS) private readonly options: ContextModuleOptions = {},
  ) {}

  /**
   * Register this accessor with `@dudousxd/nestjs-diagnostics` when present, so the
   * `traceId` on every `aviary:*` event auto-fills. Nest awaits `onModuleInit`
   * before the app serves traffic, so the bridge is in place before any emit. Soft
   * and optional — see {@link wireContextIntoDiagnostics}.
   *
   * Also push the (now-resolved) cross-boundary options into the module-level
   * singleton. {@link forRoot} already did this synchronously at wiring time, so
   * this is idempotent for the sync path; it is the ONLY place {@link forRootAsync}
   * can do it, because the async `useFactory`/`useClass`/`useExisting` options are
   * not available until DI has resolved {@link CONTEXT_MODULE_OPTIONS} — by which
   * point Nest has already constructed this module. See DESIGN §4.1 level 4.
   */
  async onModuleInit(): Promise<void> {
    Context.configure(this.options);
    await wireContextIntoDiagnostics();
  }

  static forRoot(options: ContextModuleOptions = {}): DynamicModule {
    // Push the cross-boundary config into the module-level singleton once, here
    // at wiring time — the singleton lives outside DI, so this is the bridge.
    // See DESIGN §4.1 level 4.
    Context.configure(options);

    const providers: Provider[] = [
      { provide: CONTEXT_MODULE_OPTIONS, useValue: options },
      { provide: CONTEXT_ACCESSOR, useValue: contextAccessor },
      ContextMiddleware,
    ];
    return {
      module: ContextModule,
      global: true,
      providers,
      exports: [CONTEXT_ACCESSOR, CONTEXT_MODULE_OPTIONS],
    };
  }

  /**
   * Async counterpart of {@link forRoot}: resolve {@link ContextModuleOptions}
   * lazily through DI (e.g. from a `ConfigService`). Mirrors the ecosystem
   * convention in `nestjs-filter`/`nestjs-authz`. Supply exactly one of
   * `useFactory` / `useClass` / `useExisting`.
   *
   * The same options `forRoot` accepts (traceId hook, initialize, middleware
   * opts, carrier, baggage, enrichers) are honored — they bind to
   * {@link CONTEXT_MODULE_OPTIONS} and the middleware injects them, while the
   * cross-boundary subset is pushed onto the singleton in {@link onModuleInit}
   * (the synchronous `Context.configure` in `forRoot` cannot run here because the
   * options do not exist until DI resolves the factory).
   */
  static forRootAsync(options: ContextModuleAsyncOptions): DynamicModule {
    const asyncProvider = ContextModule.buildAsyncOptionsProvider(options);
    const asyncProviders = Array.isArray(asyncProvider) ? asyncProvider : [asyncProvider];
    const providers: Provider[] = [
      ...asyncProviders,
      { provide: CONTEXT_ACCESSOR, useValue: contextAccessor },
      ContextMiddleware,
    ];
    return {
      module: ContextModule,
      global: true,
      imports: (options.imports ?? []) as DynamicModule[],
      providers,
      exports: [CONTEXT_ACCESSOR, CONTEXT_MODULE_OPTIONS],
    };
  }

  private static buildAsyncOptionsProvider(
    options: ContextModuleAsyncOptions,
  ): Provider | Provider[] {
    if (options.useFactory) {
      return {
        provide: CONTEXT_MODULE_OPTIONS,
        useFactory: options.useFactory,
        inject: (options.inject ?? []) as Array<Type<unknown>>,
      };
    }
    if (options.useClass) {
      return [
        { provide: options.useClass, useClass: options.useClass },
        {
          provide: CONTEXT_MODULE_OPTIONS,
          useFactory: (factory: ContextModuleOptionsFactory) => factory.createContextOptions(),
          inject: [options.useClass],
        },
      ];
    }
    const factoryClass = options.useExisting as Type<ContextModuleOptionsFactory>;
    return {
      provide: CONTEXT_MODULE_OPTIONS,
      useFactory: (factory: ContextModuleOptionsFactory) => factory.createContextOptions(),
      inject: [factoryClass],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // Level 3: skip middleware entirely when the app owns context creation.
    if (this.options.autoMiddleware === false) {
      return;
    }

    const forRoutes = this.options.forRoutes ?? ['*'];
    const middleware = consumer.apply(ContextMiddleware);
    if (this.options.exclude && this.options.exclude.length > 0) {
      // biome-ignore lint/suspicious/noExplicitAny: Nest's route-spread overloads.
      middleware.exclude(...(this.options.exclude as any[]));
    }
    // biome-ignore lint/suspicious/noExplicitAny: Nest's route-spread overloads.
    middleware.forRoutes(...(forRoutes as any[]));
  }
}
