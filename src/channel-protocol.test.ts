import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  formatChannelMessage,
  parseChannelMessage,
} from './channel-protocol.js';
import type { ChannelEnvelope } from './orchestration-types.js';

function makeEnvelope(
  type: ChannelEnvelope['type'] = 'work_request',
): ChannelEnvelope {
  return {
    schemaVersion: 1,
    type,
    requestId: randomUUID(),
    senderId: 'sender-1',
    timestamp: Date.now(),
    payload: { hello: 'world' },
  };
}

describe('channel-protocol', () => {
  it('formatChannelMessage -> parseChannelMessage round-trip preserves fields', () => {
    const envelope = makeEnvelope('work_response');
    const message = formatChannelMessage(envelope);
    const parsed = parseChannelMessage(message);

    expect(parsed).toEqual(envelope);
  });

  it('tool message types round-trip', () => {
    const toolCallEnvelope = makeEnvelope('tool_call');
    const toolResultEnvelope = makeEnvelope('tool_result');

    expect(parseChannelMessage(formatChannelMessage(toolCallEnvelope))).toEqual(
      toolCallEnvelope,
    );
    expect(
      parseChannelMessage(formatChannelMessage(toolResultEnvelope)),
    ).toEqual(toolResultEnvelope);
  });

  it('parseChannelMessage returns null for plain text with no tags', () => {
    expect(parseChannelMessage('hello world')).toBeNull();
  });

  it('parseChannelMessage returns null for malformed JSON inside tags', () => {
    const text = `[MC:work_request:${randomUUID()}]\n{bad-json}\n[/MC]`;
    expect(parseChannelMessage(text)).toBeNull();
  });

  it('parseChannelMessage extracts envelope from message with surrounding text', () => {
    const envelope = makeEnvelope('presence_query');
    const wrapped = `prefix text\n${formatChannelMessage(
      envelope,
    )}\ntrailing text`;
    const parsed = parseChannelMessage(wrapped);

    expect(parsed).toEqual(envelope);
  });
});
