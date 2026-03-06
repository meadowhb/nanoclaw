import fs from 'fs';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('lead bridge', () => {
  const leadBridgeDir = path.join(process.cwd(), 'data', 'lead-bridge');
  const generatedGroupDir = path.join(
    process.cwd(),
    'groups',
    'slk_sales_111_222',
  );

  beforeEach(async () => {
    fs.rmSync(leadBridgeDir, { recursive: true, force: true });
    fs.rmSync(generatedGroupDir, { recursive: true, force: true });
    const db = await import('./db.js');
    db._initTestDatabase();
  });

  afterEach(() => {
    fs.rmSync(leadBridgeDir, { recursive: true, force: true });
    fs.rmSync(generatedGroupDir, { recursive: true, force: true });
  });

  it('bootstraps a lead, ingests a Slack thread, and leases outbound replies', async () => {
    const {
      ackLeadBridgeOutbound,
      bootstrapLeadBridge,
      claimLeadBridgeOutbound,
      enqueueLeadBridgeOutbound,
      ingestLeadBridgeInbound,
    } = await import('./lead-bridge.js');
    const { getGatewayThread, getRegisteredGroup } = await import('./db.js');

    expect(
      bootstrapLeadBridge({
        teamId: 'T123',
        workspaceId: 'cred-1',
        leads: [
          {
            leadId: 'sales-lead',
            channelJid: 'slack:T123:C-SALES',
            folderSlug: 'sales',
            soul: 'Owns pipeline growth.',
          },
        ],
      }),
    ).toEqual({ ok: true });

    expect(
      ingestLeadBridgeInbound({
        teamId: 'T123',
        leadId: 'sales-lead',
        channelJid: 'slack:T123:C-SALES',
        threadJid: 'slack-thread:T123:C-SALES:111.222',
        rootThreadTs: '111.222',
        messageId: 'slack-msg:111.222',
        messageTs: '111.222',
        senderId: 'U123',
        senderName: 'Alice',
        text: 'Can you help with this forecast?',
      }),
    ).toEqual({ ok: true });

    const registered = getRegisteredGroup('slack-thread:T123:C-SALES:111.222');
    expect(registered?.folder).toBe('slk_sales_111_222');
    expect(getGatewayThread('slack-thread:T123:C-SALES:111.222')).toMatchObject({
      lead_id: 'sales-lead',
      channel_jid: 'slack:T123:C-SALES',
      root_thread_ts: '111.222',
    });
    expect(
      fs.existsSync(path.join(generatedGroupDir, 'CLAUDE.md')),
    ).toBe(true);

    const queued = enqueueLeadBridgeOutbound(
      'slack-thread:T123:C-SALES:111.222',
      'Forecast is on track.',
    );
    expect(queued.ok).toBe(true);

    const claimed = claimLeadBridgeOutbound(5);
    expect(claimed.messages).toHaveLength(1);
    expect(claimed.messages[0]).toMatchObject({
      messageId: queued.messageId,
      leadId: 'sales-lead',
      channelJid: 'slack:T123:C-SALES',
      threadJid: 'slack-thread:T123:C-SALES:111.222',
      rootThreadTs: '111.222',
      text: 'Forecast is on track.',
    });

    expect(
      ackLeadBridgeOutbound(
        claimed.messages[0]!.leaseId,
        claimed.messages[0]!.messageId,
      ),
    ).toEqual({ ok: true });
  });
});
