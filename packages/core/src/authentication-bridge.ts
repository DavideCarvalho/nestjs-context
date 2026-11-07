import type { ModuleRef } from '@nestjs/core';
import type { UserRef } from './context.js';

/**
 * Structural view of `@nestjs/authentication`'s `AuthenticationResult` — the value
 * `AuthenticationContext.run(result, fn)` takes. Declared here (not imported) so
 * this package's types never require `@nestjs/authentication` to be installed.
 * Anything the official package accepts as a result is assignable to it.
 */
export interface AuthenticationResultLike {
  user: unknown;
  session?: unknown;
  // biome-ignore lint/suspicious/noExplicitAny: mirrors the official `mfa?: MfaState` without importing it.
  mfa?: any;
}

/**
 * The slice of `@nestjs/authentication`'s `AuthenticationContext` this package
 * uses. Structural on purpose: the official class is resolved at runtime through
 * `ModuleRef`, never imported statically.
 */
export interface AuthenticationContextLike {
  readonly user: unknown;
  run<R>(result: AuthenticationResultLike | null, fn: () => R): R;
}

/** Maps the official `AuthenticationContext.user` to the {@link UserRef} that travels. */
export type UserRefFrom = (user: unknown) => UserRef | undefined;

/**
 * Default {@link UserRefFrom}: `{ type: 'user', id: user.id }` when the user has a
 * string/number `id`, else `undefined` (nothing is put on the context).
 */
export const defaultUserRefFrom: UserRefFrom = (user) => {
  if (typeof user !== 'object' || user === null) {
    return undefined;
  }
  const id = (user as { id?: unknown }).id;
  return typeof id === 'string' || typeof id === 'number' ? { type: 'user', id } : undefined;
};

/**
 * Resolve the app's `AuthenticationContext` instance (the official one keeps its
 * AsyncLocalStorage PER INSTANCE, so only the DI instance sees the scope its
 * interceptor opens). Returns `undefined` when `@nestjs/authentication` is not
 * installed or `AuthenticationModule` is not imported. Never throws.
 */
export async function resolveAuthenticationContext(
  moduleRef: ModuleRef,
): Promise<AuthenticationContextLike | undefined> {
  let token: unknown;
  try {
    const mod = (await import('@nestjs/authentication' as string)) as {
      AuthenticationContext?: unknown;
    };
    token = mod.AuthenticationContext;
  } catch {
    return undefined; // not installed
  }
  if (!token) {
    return undefined;
  }
  try {
    // biome-ignore lint/suspicious/noExplicitAny: token is the class resolved at runtime.
    return moduleRef.get(token as any, { strict: false }) as AuthenticationContextLike;
  } catch {
    return undefined; // installed, but AuthenticationModule is not in this app
  }
}
