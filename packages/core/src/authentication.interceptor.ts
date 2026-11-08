import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Observable } from 'rxjs';
import {
  type AuthenticationContextLike,
  defaultUserRefFrom,
  resolveAuthenticationContext,
} from './authentication-bridge.js';
import { Context } from './context.js';
import { CONTEXT_MODULE_OPTIONS } from './tokens.js';
import type { ContextModuleOptions } from './types.js';

let warnedOutsideScope = false;

/**
 * Read side of the `@nestjs/authentication` bridge: copies a {@link UserRef} of
 * `AuthenticationContext.user` onto the active context, so `Context.serialize()`
 * carries it across processes. The user itself stays in `AuthenticationContext`.
 *
 * `ContextModule` registers it as an `APP_INTERCEPTOR`. The official
 * `AuthenticationContext` is only filled INSIDE the official module's own
 * `APP_INTERCEPTOR`, and global interceptors run in the order their modules are
 * imported — so import `ContextModule` AFTER `AuthenticationModule`. When it is
 * imported first, this interceptor sees no user, sets nothing, and warns once.
 *
 * A pass-through when `@nestjs/authentication` is not installed/imported, when the
 * call is anonymous, or when no context is active (no middleware on that path).
 */
@Injectable()
export class ContextAuthenticationInterceptor implements NestInterceptor, OnModuleInit {
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

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const auth = this.auth;
    if (auth) {
      const user = auth.user;
      if (user !== null && user !== undefined) {
        const store = Context.get();
        if (store) {
          const ref = (this.options.userRefFrom ?? defaultUserRefFrom)(user);
          if (ref) {
            store.userRef = ref;
          }
        }
      } else if (!warnedOutsideScope && context.getType() === 'http') {
        // The official guard mirrors the user on `request.user`. A user there but
        // not in AuthenticationContext means we run outside the official scope.
        const req = context.switchToHttp().getRequest<{ user?: unknown } | undefined>();
        if (req?.user) {
          warnedOutsideScope = true;
          console.warn(
            '[nestjs-context] AuthenticationContext is empty in ContextAuthenticationInterceptor although the request is authenticated: it runs before @nestjs/authentication’s interceptor. Import ContextModule AFTER AuthenticationModule so userRef is set. This warning fires once per process.',
          );
        }
      }
    }
    return next.handle();
  }

  /** Re-arm the one-shot ordering warning. For tests. */
  static resetWarning(): void {
    warnedOutsideScope = false;
  }
}
