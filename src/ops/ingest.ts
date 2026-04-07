import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Vault } from '../core/vault.js';
import { extractPdfText } from '../core/pdf.js';
import { loadConfig, saveConfig } from '../core/config.js';
import { runAgent, type AgentResult } from '../agent/session.js';
import { INGEST_PROMPT } from '../agent/prompts.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export interface IngestOptions {
  vault: Vault;
  /** Absolute or relative path to the source file. */
  sourcePath: string;
  /** Optional model override. */
  model?: string;
  /** Optional streaming callback. */
  onMessage?: (msg: SDKMessage) => void;
}

export interface IngestResult extends AgentResult {
  /** Path to the source file as copied into sources/ (vault-relative). */
  sourceInVault: string;
  /** True if the source was new (not already ingested). */
  wasNew: boolean;
}

function slugifyFilename(name: string): string {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'source'}${ext.toLowerCase()}`;
}

export async function ingestSource(opts: IngestOptions): Promise<IngestResult> {
  const absSource = path.resolve(opts.sourcePath);
  const ext = path.extname(absSource).toLowerCase();
  if (!['.pdf', '.md', '.txt'].includes(ext)) {
    throw new Error(`Unsupported source type: ${ext}. Supported: .pdf, .md, .txt`);
  }

  // Verify source exists and is a file.
  const stat = await fs.stat(absSource);
  if (!stat.isFile()) {
    throw new Error(`Source is not a file: ${absSource}`);
  }

  // Copy into sources/ with a slugified filename.
  const sourcesDir = path.join(opts.vault.root, 'sources');
  await fs.mkdir(sourcesDir, { recursive: true });
  const destName = slugifyFilename(path.basename(absSource));
  const destAbs = path.join(sourcesDir, destName);
  const sourceInVault = path.join('sources', destName);

  // If already present, don't overwrite — treat as re-ingest request.
  let wasNew = true;
  try {
    await fs.stat(destAbs);
    wasNew = false;
  } catch {
    await fs.copyFile(absSource, destAbs);
  }

  // Extract text for the agent. PDFs get converted; md/txt pass through.
  let extractedText: string;
  if (ext === '.pdf') {
    extractedText = await extractPdfText(destAbs);
  } else {
    extractedText = await fs.readFile(destAbs, 'utf8');
  }

  // Build the user message. The agent sees the source path (so it knows where
  // to cite from) plus the extracted text inline.
  const userMessage = [
    `Ingest this source into the vault:`,
    ``,
    `Source path: ${sourceInVault}`,
    `Original filename: ${path.basename(absSource)}`,
    `Was already in vault: ${wasNew ? 'no' : 'yes (this is a re-ingest)'}`,
    ``,
    `===== EXTRACTED TEXT =====`,
    extractedText,
    `===== END EXTRACTED TEXT =====`,
    ``,
    `Follow the ingest workflow in the schema. Report what you created and updated when done.`,
  ].join('\n');

  const result = await runAgent({
    vault: opts.vault,
    opPrompt: INGEST_PROMPT,
    userMessage,
    mode: 'write',
    model: opts.model,
    maxTurns: 50, // ingest can take many read/write steps
    onMessage: opts.onMessage,
  });

  // Record ingest in config on success.
  if (result.ok && wasNew) {
    const config = await loadConfig(opts.vault);
    config.ingested.push({
      source: sourceInVault,
      ingestedAt: new Date().toISOString(),
    });
    await saveConfig(opts.vault, config);
  }

  return { ...result, sourceInVault, wasNew };
}
