import diagnostics_channel from 'node:diagnostics_channel';
import {
  type DiagnosticEvent,
  channelName,
  emit,
  getContextAccessor,
  resolveTraceId,
  setContextAccessor,
} from '@dudousxd/nestjs-diagnostics';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../src/context.js';
import { wireContextIntoDiagnostics } from '../src/diagnostics-bridge.js';

describe('diagnostics traceId bridge', () => {
  beforeEach(() => setContextAccessor(null));
  afterEach(() => setContextAccessor(null));

  it('registers the context accessor with diagnostics when present', async () => {
    expect(getContextAccessor()).toBeNull();
    await wireContextIntoDiagnostics();
    expect(getContextAccessor()).not.toBeNull();
  });

  it('makes diagnostics resolve the active request traceId', async () => {
    await wireContextIntoDiagnostics();
    expect(resolveTraceId()).toBeUndefined(); // no active context
    Context.run({ traceId: 'trace-123' }, () => {
      expect(resolveTraceId()).toBe('trace-123');
    });
  });

  it('auto-fills traceId on an emitted aviary envelope', async () => {
    await wireContextIntoDiagnostics();
    const name = channelName('authz', 'decision');
    const events: DiagnosticEvent[] = [];
    const channel = diagnostics_channel.channel(name);
    const onMessage = (msg: unknown) => events.push(msg as DiagnosticEvent);
    channel.subscribe(onMessage);
    try {
      Context.run({ traceId: 'trace-xyz' }, () => {
        emit('authz', 'decision', { ability: 'update' });
      });
    } finally {
      channel.unsubscribe(onMessage);
    }
    expect(events).toHaveLength(1);
    expect(events[0]?.traceId).toBe('trace-xyz');
  });
});
