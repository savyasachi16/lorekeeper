import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Stub the agent session runner so the test runs offline and deterministically.
// We still exercise the vault I/O, PDF extraction, and config update paths in
// ingest.ts — which is where lorekeeper's logic actually lives.
//
// The default mock simulates a successful agent run by writing a minimal
// papers/<slug>.md page that references the source file. This lets ingest.ts's
// post-hoc page-existence check (Bug #1 fix) pass for tests that don't care
// about that branch. Tests covering the silent-failure path use
// `mockImplementationOnce` to override.
vi.mock('../src/agent/session.js', async () => {
  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  return {
    runAgent: vi.fn(async (opts: { userMessage: string; vault: { root: string } }) => {
      // Extract source path from the user message and synthesize a stub page.
      const m = opts.userMessage.match(/Source path: (sources\/[^\n]+)/);
      if (m) {
        const sourceRel = m[1]!;
        const slug = path.basename(sourceRel, path.extname(sourceRel));
        const papersDir = path.join(opts.vault.root, 'papers');
        await fs.mkdir(papersDir, { recursive: true });
        await fs.writeFile(
          path.join(papersDir, `${slug}.md`),
          `---\ntype: paper\ntitle: ${slug}\nsource: ${sourceRel}\n---\n\nstub body`,
        );
      }
      return {
        text: `(stubbed agent) received ${opts.userMessage.length} chars`,
        ok: true,
        turns: 3,
        costUsd: 0.01,
      };
    }),
    loadVaultSchema: vi.fn(async () => '# stub schema'),
  };
});

import { initVault } from '../src/ops/init.js';
import { ingestSource } from '../src/ops/ingest.js';
import { loadConfig } from '../src/core/config.js';
import { openVault } from '../src/core/vault.js';
import { runAgent } from '../src/agent/session.js';

/** Build a minimal single-page PDF (same helper as pdf.test.ts, inlined). */
function buildMinimalPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 50 50 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, 'binary'));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(body, 'binary');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, 'binary');
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lorekeeper-e2e-'));
  vi.clearAllMocks();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('ingest E2E (stubbed agent)', () => {
  it('copies PDF into sources/, extracts text, and records in config', async () => {
    // 1. Init a vault
    const vaultDir = path.join(tmpDir, 'vault');
    await initVault({ dir: vaultDir });

    // 2. Write a fake PDF
    const pdfPath = path.join(tmpDir, 'Test Paper — v1.pdf');
    await fs.writeFile(pdfPath, buildMinimalPdf('test paper fixture content'));

    // 3. Ingest
    const vault = await openVault(vaultDir);
    const result = await ingestSource({ vault, sourcePath: pdfPath });

    // 4. Assertions: result shape
    expect(result.ok).toBe(true);
    expect(result.wasNew).toBe(true);
    expect(result.sourceInVault).toBe('sources/test-paper-v1.pdf');

    // 5. Source was copied (slugified)
    const copied = await fs.readFile(path.join(vaultDir, 'sources', 'test-paper-v1.pdf'));
    expect(copied.length).toBeGreaterThan(100);

    // 6. Config updated with ingest record
    const config = await loadConfig(vault);
    expect(config.ingested).toHaveLength(1);
    expect(config.ingested[0].source).toBe('sources/test-paper-v1.pdf');

    // 7. runAgent was invoked with extracted PDF text in the user message
    expect(runAgent).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(runAgent).mock.calls[0][0];
    expect(callArgs.mode).toBe('write');
    expect(callArgs.userMessage).toContain('sources/test-paper-v1.pdf');
    expect(callArgs.userMessage).toContain('fixture'); // extracted PDF text
  });

  it('does not re-copy or re-record when ingesting the same source twice', async () => {
    const vaultDir = path.join(tmpDir, 'vault');
    await initVault({ dir: vaultDir });

    const pdfPath = path.join(tmpDir, 'paper.pdf');
    await fs.writeFile(pdfPath, buildMinimalPdf('once'));

    const vault = await openVault(vaultDir);
    const r1 = await ingestSource({ vault, sourcePath: pdfPath });
    const r2 = await ingestSource({ vault, sourcePath: pdfPath });

    expect(r1.wasNew).toBe(true);
    expect(r2.wasNew).toBe(false);

    const config = await loadConfig(vault);
    // Only the first ingest creates a config entry — re-ingests don't duplicate.
    expect(config.ingested).toHaveLength(1);
  });

  it('detects silent ingest failures (agent ok=true but no page written)', async () => {
    // Regression test for Bug #1 from the v2 live test: paper 3 (large
    // extracted text) had its agent return success without ever calling
    // Write. Config got the entry, user saw "ingested" but no page existed.
    vi.mocked(runAgent).mockImplementationOnce(async () => ({
      text: 'I read the source and synthesized a summary in my head.',
      ok: true,
      turns: 4,
      costUsd: 0.005,
    }));

    const vaultDir = path.join(tmpDir, 'vault');
    await initVault({ dir: vaultDir });

    const pdfPath = path.join(tmpDir, 'silent-fail.pdf');
    await fs.writeFile(pdfPath, buildMinimalPdf('content'));

    const vault = await openVault(vaultDir);
    const result = await ingestSource({ vault, sourcePath: pdfPath });

    // The agent's `ok: true` must be overridden to false because no page exists.
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/silently failed|no papers.*page references/i);

    // Config must NOT have recorded this as ingested.
    const config = await loadConfig(vault);
    expect(config.ingested).toHaveLength(0);
  });

  it('writes a vault-internal extracted-text file for large sources', async () => {
    // Bug #1 fix: when extracted text exceeds the inline cap, ingest writes
    // it to .lorekeeper/extracted/ and tells the agent to Read it. The file
    // should be cleaned up after runAgent returns.
    let observedUserMessage = '';
    let extractedFileExistedDuringRun = false;
    const vaultDir = path.join(tmpDir, 'vault');
    await initVault({ dir: vaultDir });

    vi.mocked(runAgent).mockImplementationOnce(async (opts) => {
      observedUserMessage = opts.userMessage;
      // Check that the extracted file is on disk while the agent "runs".
      const extractedDir = path.join(vaultDir, '.lorekeeper', 'extracted');
      try {
        const entries = await fs.readdir(extractedDir);
        extractedFileExistedDuringRun = entries.length > 0;
      } catch {
        extractedFileExistedDuringRun = false;
      }
      // Simulate the agent actually writing a paper page so verification passes.
      const papersDir = path.join(vaultDir, 'papers');
      await fs.mkdir(papersDir, { recursive: true });
      await fs.writeFile(
        path.join(papersDir, 'big.md'),
        `---\ntype: paper\ntitle: Big\nsource: sources/big.txt\n---\n\nbody`,
      );
      return { text: 'wrote big.md', ok: true, turns: 5, costUsd: 0.01 };
    });

    // Create a fake "large" PDF — we don't actually need 50k chars of real
    // PDF text, we just need extractPdfText to return >50k chars. Easier to
    // bypass: write a .txt source instead, which skips PDF extraction and
    // uses the file contents directly.
    const txtPath = path.join(tmpDir, 'big.txt');
    await fs.writeFile(txtPath, 'x'.repeat(60_000));

    const vault = await openVault(vaultDir);
    const result = await ingestSource({ vault, sourcePath: txtPath });

    expect(result.ok).toBe(true);
    expect(extractedFileExistedDuringRun).toBe(true);
    expect(observedUserMessage).toContain('.lorekeeper/extracted/big.txt');
    expect(observedUserMessage).toContain('Read it from this vault path');

    // After the run, the file should be cleaned up.
    const extractedDir = path.join(vaultDir, '.lorekeeper', 'extracted');
    const remaining = await fs.readdir(extractedDir).catch(() => [] as string[]);
    expect(remaining).toEqual([]);
  });

  it('injects today\'s date into the ingest user message', async () => {
    // Bug #3 fix: agents hallucinate the ingested date from priors. Verify
    // ingest.ts now passes today's actual date in the user message.
    let observedUserMessage = '';
    vi.mocked(runAgent).mockImplementationOnce(async (opts) => {
      observedUserMessage = opts.userMessage;
      // Stub a successful page write so post-hoc verification passes.
      const papersDir = path.join(opts.vault.root, 'papers');
      await fs.mkdir(papersDir, { recursive: true });
      await fs.writeFile(
        path.join(papersDir, 'p.md'),
        `---\ntype: paper\ntitle: P\nsource: sources/p.pdf\n---\n\nbody`,
      );
      return { text: 'ok', ok: true, turns: 1, costUsd: 0.001 };
    });

    const vaultDir = path.join(tmpDir, 'vault');
    await initVault({ dir: vaultDir });
    const pdfPath = path.join(tmpDir, 'p.pdf');
    await fs.writeFile(pdfPath, buildMinimalPdf('p'));
    const vault = await openVault(vaultDir);
    await ingestSource({ vault, sourcePath: pdfPath });

    const today = new Date().toISOString().slice(0, 10);
    expect(observedUserMessage).toContain(`Today's date is ${today}`);
  });

  it('rejects unsupported source extensions', async () => {
    const vaultDir = path.join(tmpDir, 'vault');
    await initVault({ dir: vaultDir });

    const badPath = path.join(tmpDir, 'image.png');
    await fs.writeFile(badPath, 'fake');

    const vault = await openVault(vaultDir);
    await expect(ingestSource({ vault, sourcePath: badPath })).rejects.toThrow(/unsupported/i);
  });
});
