import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Vault } from '../core/vault.js';
import { extractPdfText } from '../core/pdf.js';
import { loadConfig, saveConfig } from '../core/config.js';
import { parsePage } from '../core/frontmatter.js';
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

/**
 * Inline-text cap. Beyond this many chars, the extracted text is written to a
 * temp file under .lorekeeper/extracted/ and the agent is told to Read it
 * rather than ingesting it inline. Empirically, the in-prompt approach started
 * silently failing on a 164k-char paper (Bug #1 from the live test).
 */
const INLINE_TEXT_CAP = 50_000;

function slugifyFilename(name: string): string {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'source'}${ext.toLowerCase()}`;
}

/**
 * Scan papers/ for any page whose frontmatter `source:` field references the
 * given vault-relative source path. Returns the first match's vault-relative
 * page path, or null if no page links to the source.
 *
 * This is the post-hoc verification for Bug #1: the SDK reporting `success`
 * is necessary but not sufficient — we need proof that a page was actually
 * written for this ingest.
 */
async function findPageForSource(vault: Vault, sourceInVault: string): Promise<string | null> {
  const papersDir = path.join(vault.root, 'papers');
  let entries: string[];
  try {
    entries = await fs.readdir(papersDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const abs = path.join(papersDir, entry);
    try {
      const raw = await fs.readFile(abs, 'utf8');
      const { data } = parsePage<{ source?: string }>(raw);
      if (typeof data.source === 'string' && data.source === sourceInVault) {
        return path.join('papers', entry);
      }
    } catch {
      // skip unreadable / unparseable pages
    }
  }
  return null;
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

  // Bug #1 fix: large extracted text inlined into the user message caused the
  // ingest agent to silently return success without writing any pages. Cap
  // inline text at INLINE_TEXT_CAP. Beyond that, write to a vault-internal
  // temp file and instruct the agent to Read it.
  const slug = path.basename(destName, ext);
  const extractedDir = path.join(opts.vault.root, '.lorekeeper', 'extracted');
  const extractedRel = path.join('.lorekeeper', 'extracted', `${slug}.txt`);
  const extractedAbs = path.join(extractedDir, `${slug}.txt`);
  let usedExtractedFile = false;
  let textBlock: string;
  if (extractedText.length > INLINE_TEXT_CAP) {
    await fs.mkdir(extractedDir, { recursive: true });
    await fs.writeFile(extractedAbs, extractedText, 'utf8');
    usedExtractedFile = true;
    textBlock = [
      `The extracted text is too long to inline (${extractedText.length} chars).`,
      `Read it from this vault path with the Read tool, in chunks if needed:`,
      `  ${extractedRel}`,
      ``,
      `Excerpt (first ${INLINE_TEXT_CAP} chars):`,
      extractedText.slice(0, INLINE_TEXT_CAP),
      `... [truncated; full text at ${extractedRel}]`,
    ].join('\n');
  } else {
    textBlock = [`===== EXTRACTED TEXT =====`, extractedText, `===== END EXTRACTED TEXT =====`].join(
      '\n',
    );
  }

  // Bug #3 fix: agents hallucinate the `ingested:` date from priors when not
  // told what today is. Inject it explicitly.
  const today = new Date().toISOString().slice(0, 10);

  const userMessage = [
    `Ingest this source into the vault.`,
    ``,
    `Today's date is ${today}. Use this exact date for the page's frontmatter \`ingested:\` field.`,
    ``,
    `Source path: ${sourceInVault}`,
    `Original filename: ${path.basename(absSource)}`,
    `Was already in vault: ${wasNew ? 'no' : 'yes (this is a re-ingest)'}`,
    ``,
    textBlock,
    ``,
    `Follow the ingest workflow in the schema. Report what you created and updated when done.`,
  ].join('\n');

  let result: AgentResult;
  try {
    result = await runAgent({
      vault: opts.vault,
      opPrompt: INGEST_PROMPT,
      userMessage,
      mode: 'write',
      model: opts.model,
      maxTurns: 50,
      onMessage: opts.onMessage,
    });
  } finally {
    if (usedExtractedFile) {
      await fs.rm(extractedAbs, { force: true });
    }
  }

  // Bug #1 fix: post-hoc verification. The SDK can report success even when
  // the agent never called Write. Confirm a paper page now references this
  // source on disk before declaring victory.
  const pagePath = await findPageForSource(opts.vault, sourceInVault);
  if (result.ok && !pagePath) {
    return {
      ...result,
      ok: false,
      text:
        `Agent reported success but no papers/*.md page references ${sourceInVault}. ` +
        `The ingest silently failed (likely the agent never called Write). ` +
        `Original agent text:\n\n${result.text}`,
      sourceInVault,
      wasNew,
    };
  }

  // Record ingest in config on real success.
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
