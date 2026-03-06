import type {
  AgentRequest,
  AgentResponse,
  LeadBlueprint,
  LeadInstance,
} from './orchestration-types.js';

export interface SessionRuntimeTool {
  name: string;
  description: string;
  invoke(input: Record<string, unknown>): Promise<unknown>;
}

export interface SessionRuntimeContext {
  lead: LeadBlueprint;
  instance: LeadInstance;
  request: AgentRequest;
  channelJid: string;
  threadId: string;
  sessionId?: string;
  resumeAt?: string;
  mcpTools: SessionRuntimeTool[];
}

export interface SessionRuntimeResult {
  response: AgentResponse;
  sessionId?: string;
  resumeAt?: string;
}

export interface SessionRuntime {
  run(context: SessionRuntimeContext): Promise<SessionRuntimeResult>;
  dispose?(): Promise<void>;
}
