import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractPdfText } from '../src/core/pdf.js';

/**
 * Build a minimal single-page PDF containing `text`. Hand-rolled so we don't
 * need a PDF-generation dependency or a committed binary fixture.
 *
 * PDF xref entries must be exactly 20 bytes: "oooooooooo ggggg n \n"
 * (10 offset + space + 5 gen + space + 'n' + space + newline).
 */
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
  for (const off of offsets) {
    body += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(body, 'binary');
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lorekeeper-pdf-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('extractPdfText', () => {
  it('extracts text from a minimal single-page PDF', async () => {
    const pdfPath = path.join(tmpDir, 'fixture.pdf');
    await fs.writeFile(pdfPath, buildMinimalPdf('lorekeeper fixture'));
    const text = await extractPdfText(pdfPath);
    // pdfjs may split the string across items, so just assert substring presence
    // of each word rather than exact equality.
    expect(text).toContain('lorekeeper');
    expect(text).toContain('fixture');
  });
});
