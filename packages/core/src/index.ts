/** Keep in sync with this package's `version` in package.json. */
export const VERSION = '1.0.3';

export type { ContextAccessor } from './accessor.js';
export { contextAccessor } from './accessor.js';
export {
  type Baggage,
  type BaggageKeyMap,
  decodeBaggage,
  decodeUserRef,
  encodeBaggage,
  encodeUserRef,
} from './baggage.js';
export type {
  ContextCarrier,
  ContextConfig,
  ContextEnricher,
  ContextStore,
  UserRef,
} from './context.js';
export { Context } from './context.js';
export { ContextMiddleware } from './middleware.js';
export { ContextModule } from './module.js';
export { CONTEXT_ACCESSOR, CONTEXT_MODULE_OPTIONS } from './tokens.js';
export type { ParsedTraceparent } from './traceparent.js';
export {
  extractTraceparent,
  parseTraceparent,
  randomTraceId,
  toTraceparent,
} from './traceparent.js';
export type {
  ContextModuleAsyncOptions,
  ContextModuleOptions,
  ContextModuleOptionsFactory,
  ContextRequest,
} from './types.js';
