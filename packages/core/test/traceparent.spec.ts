import { describe, expect, it } from 'vitest';
import { extractTraceparent, randomTraceId, toTraceparent } from '../src/index.js';

const VALID = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

describe('extractTraceparent', () => {
  it('extracts the trace-id from a valid traceparent', () => {
    expect(extractTraceparent({ traceparent: VALID })).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('reads from a custom header name', () => {
    expect(extractTraceparent({ 'x-trace': VALID }, 'x-trace')).toBe(
      '4bf92f3577b34da6a3ce929d0e0e4736',
    );
  });

  it('handles array header values', () => {
    expect(extractTraceparent({ traceparent: [VALID, 'other'] })).toBe(
      '4bf92f3577b34da6a3ce929d0e0e4736',
    );
  });

  it('returns undefined when missing', () => {
    expect(extractTraceparent({})).toBeUndefined();
  });

  it('returns undefined for a malformed header', () => {
    expect(extractTraceparent({ traceparent: 'not-a-traceparent' })).toBeUndefined();
  });

  it('rejects an all-zero trace-id', () => {
    expect(
      extractTraceparent({
        traceparent: '00-00000000000000000000000000000000-00f067aa0ba902b7-01',
      }),
    ).toBeUndefined();
  });
});

describe('randomTraceId', () => {
  it('produces a 32-hex-char id', () => {
    const id = randomTraceId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('produces distinct ids', () => {
    expect(randomTraceId()).not.toBe(randomTraceId());
  });
});

describe('toTraceparent', () => {
  it('round-trips a trace-id back out of a traceparent', () => {
    const id = randomTraceId();
    expect(extractTraceparent({ traceparent: toTraceparent(id) })).toBe(id);
  });
});
