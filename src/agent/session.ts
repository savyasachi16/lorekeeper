import { promises as fs } from 'node:fs';
import path from 'node:path';
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Vault } from '../core/vault.js';
import { composeSystemPrompt } from './prompts.js';

/**
 * Agent session wrapper. lorekeeper doesn't define its own tools — it relies
 * on Claude Code's built-in file tools (Read/Write/Edit/Glob/Grep) restricted
 * to the vault directory by setting `cwd` and scoping `allowedTools`.
 *
 * Read-only ops (query, lint) get Read/Glob/Grep only.
 * Write ops (ingest, lint --fix) also get Write/Edit.
 */

const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];
const READ_WRITE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];

export type SessionMode = 'read' | 'write';

export interface RunAgentOptions {
  vault: Vault;
  /** Op-specific system prompt prefix. The vault's CLAUDE.md is appended automatically. */
  opPrompt: string;
  /** The user message / task description sent to the agent. */
  userMessage: string;
  mode: SessionMode;
  /** Optional model override. Defaults to SDK's default. */
  model?: string;
  /** Max conversation turns. Defaults to 30 — ingest can take many read/write steps. */
  maxTurns?: number;
  /** Optional callback invoked with each streamed message (for CLI progress UI). */
  onMessage?: (msg: SDKMessage) => void;
  /** Optional abort controller for cancellation. */
  abortController?: AbortController;
}

export interface AgentResult {
  /** Final assistant text, or error string on failure. */
  text: string;
  /** True if the run terminated with a success result. */
  ok: boolean;
  /** Number of turns used. */
  turns: number;
  /** Total cost in USD, if reported. */
  costUsd?: number;
}

/** Load the vault's CLAUDE.md from disk. Throws if absent. */
export async function loadVaultSchema(vault: Vault): Promise<string> {
  const p = path.join(vault.root, 'CLAUDE.md');
  try {
    return await fs.readFile(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Vault is missing CLAUDE.md at ${p}. Run 'lorekeeper init' to scaffold it.`);
    }
    throw err;
  }
}

/**
 * Run an agent session against the vault. Returns after the result message
 * is received. The agent runs in the vault directory with a restricted tool
 * set; Claude Code's built-in path restrictions plus `cwd` keep writes inside.
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const schema = await loadVaultSchema(opts.vault);
  const systemPrompt = composeSystemPrompt(opts.opPrompt, schema);
  const tools = opts.mode === 'write' ? READ_WRITE_TOOLS : READ_ONLY_TOOLS;

  const options: Options = {
    cwd: opts.vault.root,
    systemPrompt,
    tools,
    allowedTools: tools,
    model: opts.model,
    maxTurns: opts.maxTurns ?? 30,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    // Isolate from user/project settings — the vault's CLAUDE.md is the
    // authoritative schema and we pass it explicitly via systemPrompt.
    settingSources: [],
    persistSession: false,
    abortController: opts.abortController,
  };

  const q = query({ prompt: opts.userMessage, options });

  let lastText = '';
  let turns = 0;
  let ok = false;
  let costUsd: number | undefined;

  for await (const msg of q) {
    if (opts.onMessage) opts.onMessage(msg);

    if (msg.type === 'result') {
      turns = msg.num_turns;
      costUsd = msg.total_cost_usd;
      if (msg.subtype === 'success') {
        ok = true;
        lastText = msg.result;
      } else {
        ok = false;
        lastText = `Agent run failed: ${msg.subtype}${
          'errors' in msg && msg.errors.length > 0 ? ` — ${msg.errors.join('; ')}` : ''
        }`;
      }
      break;
    }
  }

  return { text: lastText, ok, turns, costUsd };
}
