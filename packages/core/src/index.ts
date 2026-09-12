/**
 * Kept in sync with this package's `version` in package.json by
 * `scripts/sync-version.mjs`, which the `version` script chains after
 * `changeset version` — tsc bakes this literal into dist, so a release that skips
 * that script ships a build reporting the previous version, and nothing here
 * fails when it does.
 */
export const VERSION = '1.0.3';

export { Context } from './context.js';
export type {
  ContextStore,
  ContextCarrier,
  ContextConfig,
  ContextEnricher,
  UserRef,
} from './context.js';
export {
  type Baggage,
  type BaggageKeyMap,
  decodeBaggage,
  decodeUserRef,
  encodeBaggage,
  encodeUserRef,
} from './baggage.js';
export { contextAccessor } from './accessor.js';
export type { ContextAccessor } from './accessor.js';
export { ContextMiddleware } from './middleware.js';
export { ContextModule } from './module.js';
export { CONTEXT_ACCESSOR, CONTEXT_MODULE_OPTIONS } from './tokens.js';
export type {
  ContextModuleAsyncOptions,
  ContextModuleOptions,
  ContextModuleOptionsFactory,
  ContextRequest,
} from './types.js';
export {
  extractTraceparent,
  parseTraceparent,
  randomTraceId,
  toTraceparent,
} from './traceparent.js';
export type { ParsedTraceparent } from './traceparent.js';
