export const CONTEXT_MODULE_OPTIONS = Symbol.for('@dudousxd/nestjs-context:options');

/**
 * Global token bound to a {@link ContextAccessor}. Other ecosystem libs inject
 * it optionally — `@Optional() @Inject(CONTEXT_ACCESSOR)` — so they degrade
 * cleanly when `nestjs-context` is not installed. See DESIGN §6.
 */
export const CONTEXT_ACCESSOR = Symbol.for('@dudousxd/nestjs-context:accessor');
