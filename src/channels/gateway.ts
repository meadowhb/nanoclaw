import { registerChannel, type ChannelOpts } from './registry.js';
import type { Channel } from '../types.js';
import { enqueueLeadBridgeOutbound } from '../lead-bridge.js';

class GatewayChannel implements Channel {
  readonly name = 'gateway';

  async connect(): Promise<void> {
    return undefined;
  }

  async disconnect(): Promise<void> {
    return undefined;
  }

  isConnected(): boolean {
    return true;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('slack-thread:');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    enqueueLeadBridgeOutbound(jid, text);
  }
}

registerChannel('gateway', (_opts: ChannelOpts) => new GatewayChannel());
