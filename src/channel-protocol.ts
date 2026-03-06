import {
  ChannelEnvelopeSchema,
  type ChannelEnvelope,
} from './orchestration-types.js';

const OPEN_TAG_PATTERN = /\[MC:([a-z_]+):([^\]\n]+)\]/g;
const OPEN_TAG_CAPTURE_PATTERN = /^\[MC:([a-z_]+):([^\]\n]+)\]$/;
const CLOSE_TAG = '[/MC]';

export function parseChannelMessage(text: string): ChannelEnvelope | null {
  OPEN_TAG_PATTERN.lastIndex = 0;
  const openMatches = [...text.matchAll(OPEN_TAG_PATTERN)];
  if (openMatches.length !== 1) {
    return null;
  }

  const openMatch = openMatches[0]!;
  const openTag = openMatch[0];
  const openTagIndex = openMatch.index ?? -1;
  if (openTagIndex < 0) {
    return null;
  }

  const closeTagIndex = text.indexOf(CLOSE_TAG, openTagIndex + openTag.length);
  if (closeTagIndex < 0) {
    return null;
  }

  const trailingCloseTagIndex = text.indexOf(
    CLOSE_TAG,
    closeTagIndex + CLOSE_TAG.length,
  );
  if (trailingCloseTagIndex >= 0) {
    return null;
  }

  const betweenTags = text.slice(openTagIndex + openTag.length, closeTagIndex);
  if (betweenTags.includes('[MC:')) {
    return null;
  }

  const opener = openTag.match(OPEN_TAG_CAPTURE_PATTERN);
  if (!opener) {
    return null;
  }

  const type = opener[1]!;
  const requestId = opener[2]!;

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(betweenTags.trim());
  } catch {
    return null;
  }

  if (typeof parsedBody !== 'object' || parsedBody === null) {
    return null;
  }

  const bodyRecord = parsedBody as Record<string, unknown>;
  const candidate: unknown = {
    schemaVersion: bodyRecord.schemaVersion,
    type,
    requestId,
    senderId: bodyRecord.senderId,
    timestamp: bodyRecord.timestamp,
    payload: bodyRecord.payload,
  };
  const validation = ChannelEnvelopeSchema.safeParse(candidate);
  if (!validation.success) {
    return null;
  }

  return {
    schemaVersion: validation.data.schemaVersion,
    type: validation.data.type,
    requestId: validation.data.requestId,
    senderId: validation.data.senderId,
    timestamp: validation.data.timestamp,
    payload: validation.data.payload,
  };
}

export function formatChannelMessage(envelope: ChannelEnvelope): string {
  const body = {
    schemaVersion: envelope.schemaVersion,
    senderId: envelope.senderId,
    timestamp: envelope.timestamp,
    payload: envelope.payload,
  };

  return `[MC:${envelope.type}:${envelope.requestId}]\n${JSON.stringify(
    body,
    null,
    2,
  )}\n[/MC]`;
}
