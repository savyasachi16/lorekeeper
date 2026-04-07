import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Stub the agent session runner so the test runs offline and deterministically.
// We still exercise the vault I/O, PDF extraction, and config update paths in
// ingest.ts — which is where lorekeeper's logic actually lives.
vi.mock('../src/agent/session.js', () => ({
  runAgent: vi.fn(async (opts: { userMessage: string }) => ({
    text: `(stubbed agent) received ${opts.userMessage.length} chars`,
    ok: true,
    turns: 3,
    costUsd: 0.01,
  })),
  loadVaultSchema: vi.fn(async () => '# stub schema'),
}));

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

  it('rejects unsupported source extensions', async () => {
    const vaultDir = path.join(tmpDir, 'vault');
    await initVault({ dir: vaultDir });

    const badPath = path.join(tmpDir, 'image.png');
    await fs.writeFile(badPath, 'fake');

    const vault = await openVault(vaultDir);
    await expect(ingestSource({ vault, sourcePath: badPath })).rejects.toThrow(/unsupported/i);
  });
});
