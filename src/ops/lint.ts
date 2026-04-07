import type { Vault } from '../core/vault.js';
import { runAgent, type AgentResult } from '../agent/session.js';
import { LINT_PROMPT } from '../agent/prompts.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export interface LintOptions {
  vault: Vault;
  /** If true, allow the agent to repair mechanical issues (broken links, missing frontmatter). */
  fix?: boolean;
  model?: string;
  onMessage?: (msg: SDKMessage) => void;
}

export async function lintVault(opts: LintOptions): Promise<AgentResult> {
  const fix = opts.fix ?? false;
  const userMessage = fix
    ? `Audit this vault for drift. Fix mode is ENABLED — repair broken wikilinks and missing required frontmatter fields. Do NOT rewrite prose to resolve contradictions; flag those and stop.`
    : `Audit this vault for drift. Report findings only — do not modify any files.`;

  return runAgent({
    vault: opts.vault,
    opPrompt: LINT_PROMPT,
    userMessage,
    mode: fix ? 'write' : 'read',
    model: opts.model,
    maxTurns: fix ? 40 : 20,
    onMessage: opts.onMessage,
  });
}
