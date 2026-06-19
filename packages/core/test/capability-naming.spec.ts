import { assertCapabilityNaming, capability } from '@dudousxd/nestjs-diagnostics';
import { describe, expect, it } from 'vitest';
import { CONTEXT_ACCESSOR, CONTEXT_MODULE_OPTIONS } from '../src/tokens.js';

describe('nestjs-context capability tokens', () => {
  it('follow the canonical naming', () => {
    expect(() =>
      assertCapabilityNaming('context', { CONTEXT_ACCESSOR, CONTEXT_MODULE_OPTIONS }),
    ).not.toThrow();
  });

  it('CONTEXT_ACCESSOR is the exact canonical symbol (non-breaking)', () => {
    expect(CONTEXT_ACCESSOR).toBe(capability('context', 'accessor'));
    expect(CONTEXT_ACCESSOR).toBe(Symbol.for('@dudousxd/nestjs-context:accessor'));
  });
});
