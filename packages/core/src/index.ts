/** Keep in sync with this package's `version` in package.json. */
export const VERSION = '0.2.0';

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
