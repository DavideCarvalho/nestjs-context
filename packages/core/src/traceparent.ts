import { randomBytes } from 'node:crypto';

/**
 * W3C Trace Context `traceparent` header:
 *   version "-" trace-id "-" parent-id "-" trace-flags
 *   e.g. 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 *
 * Spec: https://www.w3.org/TR/trace-context/#traceparent-header
 */
const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

type Headers = Record<string, string | string[] | undefined>;

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Extract the trace-id (the 32-hex middle segment) from a `traceparent` header.
 * Returns `undefined` if the header is missing or malformed.
 *
 * @param headers request headers (keys are assumed lower-cased, as Node delivers).
 * @param headerName header to read; defaults to the W3C `traceparent`.
 */
export function extractTraceparent(
  headers: Headers,
  headerName = 'traceparent',
): string | undefined {
  const raw = firstHeader(headers[headerName] ?? headers[headerName.toLowerCase()]);
  if (!raw) {
    return undefined;
  }
  const match = TRACEPARENT_RE.exec(raw.trim());
  if (!match) {
    return undefined;
  }
  const traceId = match[2];
  // All-zero trace-id is invalid per spec. The capture group already guarantees
  // exactly 32 hex chars, so a constant compare is equivalent to /^0+$/.
  if (traceId === '00000000000000000000000000000000') {
    return undefined;
  }
  return traceId;
}

/** A fresh 16-byte (32 hex char) trace-id, matching the W3C trace-id shape. */
export function randomTraceId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Wrap a trace-id back into a minimal `traceparent` header value.
 *
 * The trailing `-01` is the W3C trace-flags byte with the `sampled` bit set:
 * we always mark re-emitted spans as sampled so downstream collectors keep
 * them. This is deliberate — we do not propagate the upstream sampling
 * decision (the original flags are dropped at `serialize()` time).
 */
export function toTraceparent(traceId: string): string {
  const parentId = randomBytes(8).toString('hex');
  return `00-${traceId}-${parentId}-01`;
}
