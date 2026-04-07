import { promises as fs } from 'node:fs';
// The legacy build works in Node without a DOM polyfill.
// Types live alongside the .mjs file.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - pdfjs-dist legacy subpath has types but TS may not resolve them cleanly
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Extract text from a PDF file. Returns the concatenation of every page's
 * text content with a single blank line between pages.
 *
 * This is deliberately simple: no layout reconstruction, no figure extraction,
 * no table handling. The goal is to feed something reasonable to the LLM, which
 * is robust to messy input.
 */
export async function extractPdfText(pdfPath: string): Promise<string> {
  const data = await fs.readFile(pdfPath);
  // pdfjs wants a Uint8Array, not a Buffer alias.
  const uint8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  const loadingTask = pdfjsLib.getDocument({
    data: uint8,
    // Silence worker warnings in node — we run the main thread parser.
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const doc = await loadingTask.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: unknown) => {
        const it = item as { str?: string };
        return it.str ?? '';
      })
      .join(' ');
    pages.push(pageText.trim());
  }
  await doc.destroy();
  return pages.join('\n\n');
}
