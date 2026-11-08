import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  type AuthenticationContextLike,
  resolveAuthenticationContext,
} from './authentication-bridge.js';
import { Context, type ContextCarrier } from './context.js';
import { CONTEXT_MODULE_OPTIONS } from './tokens.js';
import { randomTraceId } from './traceparent.js';
import type { ContextModuleOptions } from './types.js';

let warnedNoRehydrate = false;

/**
 * Runs a unit of work on "the other side" of a process boundary (queue worker,
 * durable step, scheduled job) with the context the producer serialized.
 *
 * `run(carrier, fn)`:
 * 1. re-enters the carrier with `Context.deserialize` (traceId, tenantId, userRef);
 * 2. when `@nestjs/authentication` is in the app, calls
 *    `ContextModule.forRoot({ rehydrateUser })` with `carrier.userRef` (inside the
 *    restored context, so its lookups are traced) and runs `fn` under
 *    `AuthenticationContext.run(result, fn)` — `AuthenticationContext.user` is then
 *    the rehydrated user. Without a `userRef` or a `rehydrateUser`, `fn` runs as
 *    anonymous (`run(null, fn)`), never inheriting an outer caller's user.
 *
 * The carrier only ever holds the `userRef`; the user and session are rebuilt
 * here, never serialized. Without `@nestjs/authentication`, this is
 * `Context.deserialize` with an async `fn`.
 */
@Injectable()
export class ContextRunner implements OnModuleInit {
  private auth: AuthenticationContextLike | undefined;

  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(CONTEXT_MODULE_OPTIONS)
    private readonly options: ContextModuleOptions = {},
  ) {}

  async onModuleInit(): Promise<void> {
    this.auth = await resolveAuthenticationContext(this.moduleRef);
  }

  /**
   * Run `fn` inside the context `carrier` describes. A missing carrier starts a
   * fresh context (new traceId, anonymous). Errors from `rehydrateUser` or `fn`
   * propagate.
   */
  run<T>(carrier: ContextCarrier | undefined, fn: () => T | Promise<T>): Promise<T> {
    const body = async (): Promise<T> => {
      const auth = this.auth;
      if (!auth) {
        return fn();
      }
      const ref = carrier?.userRef;
      const rehydrate = this.options.rehydrateUser;
      if (ref && !rehydrate && !warnedNoRehydrate) {
        warnedNoRehydrate = true;
        console.warn(
          '[nestjs-context] ContextRunner received a carrier with a userRef but ContextModule has no rehydrateUser, so the work runs anonymous. Pass ContextModule.forRoot({ rehydrateUser }) to run it as the user. This warning fires once per process.',
        );
      }
      const result = ref && rehydrate ? await rehydrate(ref) : null;
      return auth.run(result ?? null, fn);
    };
    return carrier
      ? Context.deserialize(carrier, body)
      : Context.run({ traceId: randomTraceId() }, body);
  }

  /** Re-arm the one-shot missing-`rehydrateUser` warning. For tests. */
  static resetWarning(): void {
    warnedNoRehydrate = false;
  }
}
