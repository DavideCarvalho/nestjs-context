import {
  type DynamicModule,
  Inject,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  type Provider,
} from '@nestjs/common';
import { contextAccessor } from './accessor.js';
import { Context } from './context.js';
import { ContextMiddleware } from './middleware.js';
import { CONTEXT_ACCESSOR, CONTEXT_MODULE_OPTIONS } from './tokens.js';
import type { ContextModuleOptions } from './types.js';

/**
 * Global module that wires the per-request context: registers
 * {@link ContextMiddleware} (unless `autoMiddleware: false`) and exposes the
 * global {@link CONTEXT_ACCESSOR} token other libs inject. See DESIGN §4.
 */
@Module({})
export class ContextModule implements NestModule {
  constructor(
    @Inject(CONTEXT_MODULE_OPTIONS) private readonly options: ContextModuleOptions = {},
  ) {}

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
