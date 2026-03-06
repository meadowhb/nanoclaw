import {
  getLeadConversationBinding,
  upsertLeadConversationBinding,
  type LeadConversationBindingRecord,
} from './db.js';
import type { LeadRegistry } from './lead-registry.js';
import { NanoclawProvisioner } from './nanoclaw-provisioner.js';
import type {
  AgentRequest,
  AgentResponse,
  LeadBlueprint,
  WorkerExecutor,
} from './orchestration-types.js';
import { RuntimeManager } from './runtime-manager.js';
import type {
  SessionRuntimeContext,
  SessionRuntimeTool,
} from './session-runtime.js';

export interface LeadConversationStore {
  get(
    leadId: string,
    channel: string,
    threadId: string,
  ): LeadConversationBindingRecord | undefined;
  upsert(input: {
    leadId: string;
    channel: string;
    threadId: string;
    sessionId: string;
    resumeAt?: string | null;
  }): LeadConversationBindingRecord;
}

export interface NanoclawExecutorOptions {
  dataDir: string;
  leadRegistry: LeadRegistry;
  runtimeManager?: RuntimeManager;
  provisioner?: NanoclawProvisioner;
  conversationStore?: LeadConversationStore;
  threadIdResolver?: (request: AgentRequest, channelJid: string) => string;
  mcpToolFactory?: (
    blueprint: LeadBlueprint,
    request: AgentRequest,
  ) => SessionRuntimeTool[];
}

function defaultConversationStore(): LeadConversationStore {
  return {
    get: getLeadConversationBinding,
    upsert: upsertLeadConversationBinding,
  };
}

function defaultThreadIdResolver(
  request: AgentRequest,
  _channelJid: string,
): string {
  return request.podId;
}

function defaultMcpToolFactory(blueprint: LeadBlueprint): SessionRuntimeTool[] {
  const names = blueprint.runtime?.allowedTools ?? [];
  return names.map((name) => ({
    name,
    description: `Runtime tool ${name} for ${blueprint.leadId}`,
    invoke: async (input: Record<string, unknown>) => ({
      tool: name,
      accepted: true,
      input,
    }),
  }));
}

export class NanoclawExecutor implements WorkerExecutor {
  private readonly leadRegistry: LeadRegistry;
  private readonly runtimeManager: RuntimeManager;
  private readonly provisioner: NanoclawProvisioner;
  private readonly conversationStore: LeadConversationStore;
  private readonly threadIdResolver: (
    request: AgentRequest,
    channelJid: string,
  ) => string;
  private readonly mcpToolFactory: (
    blueprint: LeadBlueprint,
    request: AgentRequest,
  ) => SessionRuntimeTool[];

  constructor(options: NanoclawExecutorOptions) {
    this.leadRegistry = options.leadRegistry;
    this.runtimeManager = options.runtimeManager ?? new RuntimeManager();
    this.provisioner =
      options.provisioner ??
      new NanoclawProvisioner({ dataDir: options.dataDir });
    this.conversationStore =
      options.conversationStore ?? defaultConversationStore();
    this.threadIdResolver = options.threadIdResolver ?? defaultThreadIdResolver;
    this.mcpToolFactory = options.mcpToolFactory ?? defaultMcpToolFactory;
  }

  async sendWork(
    workerId: string,
    request: AgentRequest,
    channelJid: string,
  ): Promise<AgentResponse> {
    const blueprint = this.leadRegistry.get(workerId);
    if (!blueprint) {
      return {
        schemaVersion: 1,
        requestId: request.requestId,
        status: 'error',
        error: `Unknown lead: ${workerId}`,
        durationMs: 0,
        tokensUsed: { input: 0, output: 0 },
      };
    }

    const threadId = this.threadIdResolver(request, channelJid);
    const binding = this.conversationStore.get(workerId, channelJid, threadId);
    const instance = this.provisioner.provision(blueprint);
    const context: SessionRuntimeContext = {
      lead: blueprint,
      instance,
      request,
      channelJid,
      threadId,
      sessionId: binding?.sessionId,
      resumeAt: binding?.resumeAt ?? undefined,
      mcpTools: this.mcpToolFactory(blueprint, request),
    };
    const result = await this.runtimeManager.run(context);

    const sessionId = result.sessionId ?? binding?.sessionId;
    const resumeAt = result.resumeAt ?? binding?.resumeAt ?? null;
    if (sessionId) {
      this.conversationStore.upsert({
        leadId: workerId,
        channel: channelJid,
        threadId,
        sessionId,
        resumeAt,
      });
    }

    return result.response;
  }

  async getPresence(workerId: string): Promise<'online' | 'offline' | 'busy'> {
    return this.leadRegistry.get(workerId) ? 'online' : 'offline';
  }

  async dispose(): Promise<void> {
    await this.runtimeManager.dispose();
  }
}
