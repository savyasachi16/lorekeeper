import type { Vault } from '../core/vault.js';
import { runAgent, type AgentResult } from '../agent/session.js';
import { QUERY_PROMPT } from '../agent/prompts.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export interface QueryOptions {
  vault: Vault;
  question: string;
  model?: string;
  onMessage?: (msg: SDKMessage) => void;
}

export async function queryVault(opts: QueryOptions): Promise<AgentResult> {
  return runAgent({
    vault: opts.vault,
    opPrompt: QUERY_PROMPT,
    userMessage: opts.question,
    mode: 'read',
    model: opts.model,
    maxTurns: 20,
    onMessage: opts.onMessage,
  });
}
