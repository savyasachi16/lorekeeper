import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  extractPdfUrl,
  getScihubMirrors,
  fetchByDoi,
  _resetScihubWarning,
} from '../src/fetch/scihub.js';

describe('extractPdfUrl', () => {
  const MIRROR = 'https://sci-hub.se';

  it('extracts an absolute https URL from <embed>', () => {
    const html = `<html><body><embed type="application/pdf" src="https://dacemirror.example/file.pdf#view=FitH"></body></html>`;
    expect(extractPdfUrl(html, MIRROR)).toBe('https://dacemirror.example/file.pdf');
  });

  it('extracts from <iframe> when <embed> is absent', () => {
    const html = `<iframe id="pdf" src="https://moscow.sci-hub/pdf/foo.pdf"></iframe>`;
    expect(extractPdfUrl(html, MIRROR)).toBe('https://moscow.sci-hub/pdf/foo.pdf');
  });

  it('resolves protocol-relative URLs against https', () => {
    const html = `<embed src="//cdn.example.org/cache/abc.pdf">`;
    expect(extractPdfUrl(html, MIRROR)).toBe('https://cdn.example.org/cache/abc.pdf');
  });

  it('resolves root-relative URLs against the mirror origin', () => {
    const html = `<embed src="/downloads/2020/foo.pdf#nav=1">`;
    expect(extractPdfUrl(html, MIRROR)).toBe('https://sci-hub.se/downloads/2020/foo.pdf');
  });

  it('strips hash fragments', () => {
    const html = `<embed src="https://x.example/y.pdf#view=FitH&page=2">`;
    expect(extractPdfUrl(html, MIRROR)).toBe('https://x.example/y.pdf');
  });

  it('returns null when neither tag is present', () => {
    const html = `<html><body><p>article not found</p></body></html>`;
    expect(extractPdfUrl(html, MIRROR)).toBeNull();
  });
});

describe('getScihubMirrors', () => {
  const original = process.env.LOREKEEPER_SCIHUB_MIRRORS;
  afterEach(() => {
    if (original === undefined) delete process.env.LOREKEEPER_SCIHUB_MIRRORS;
    else process.env.LOREKEEPER_SCIHUB_MIRRORS = original;
  });

  it('returns defaults when env var is unset', () => {
    delete process.env.LOREKEEPER_SCIHUB_MIRRORS;
    const mirrors = getScihubMirrors();
    expect(mirrors).toContain('https://sci-hub.se');
    expect(mirrors.length).toBeGreaterThanOrEqual(3);
  });

  it('parses comma-separated env override and trims trailing slashes', () => {
    process.env.LOREKEEPER_SCIHUB_MIRRORS = 'https://a.test/, https://b.test , https://c.test';
    expect(getScihubMirrors()).toEqual(['https://a.test', 'https://b.test', 'https://c.test']);
  });
});

describe('fetchByDoi', () => {
  let tmpDir: string;

  beforeEach(async () => {
    _resetScihubWarning();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lorekeeper-scihub-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeRes(body: string | Uint8Array, ok = true): Response {
    return {
      ok,
      status: ok ? 200 : 500,
      statusText: ok ? 'OK' : 'ERR',
      text: async () => (typeof body === 'string' ? body : ''),
      arrayBuffer: async () =>
        typeof body === 'string' ? new TextEncoder().encode(body).buffer : body.buffer,
    } as unknown as Response;
  }

  it('downloads the PDF after scraping landing page', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    const calls: string[] = [];
    const fakeFetch = async (url: string | URL): Promise<Response> => {
      const u = url.toString();
      calls.push(u);
      if (u.endsWith('10.1000%2Ffoo')) {
        return makeRes(`<embed src="//cdn.example/file.pdf#view=FitH">`);
      }
      if (u === 'https://cdn.example/file.pdf') {
        return makeRes(pdfBytes);
      }
      return makeRes('', false);
    };

    const out = await fetchByDoi({
      doi: '10.1000/foo',
      destDir: tmpDir,
      filename: 'paper.pdf',
      mirrors: ['https://sci-hub.se'],
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });

    expect(out).toBe(path.resolve(tmpDir, 'paper.pdf'));
    expect(calls[0]).toBe('https://sci-hub.se/10.1000%2Ffoo');
    expect(calls[1]).toBe('https://cdn.example/file.pdf');
    const written = await fs.readFile(out!);
    expect(written.subarray(0, 5)).toEqual(Buffer.from(pdfBytes));
  });

  it('falls through to the next mirror when the first 404s', async () => {
    const fakeFetch = async (url: string | URL): Promise<Response> => {
      const u = url.toString();
      if (u.startsWith('https://dead.test')) return makeRes('', false);
      if (u === 'https://live.test/10.1000%2Fbar') {
        return makeRes(`<iframe src="https://live.test/pdf/bar.pdf"></iframe>`);
      }
      if (u === 'https://live.test/pdf/bar.pdf') {
        return makeRes(new Uint8Array([1, 2, 3]));
      }
      return makeRes('', false);
    };

    const out = await fetchByDoi({
      doi: '10.1000/bar',
      destDir: tmpDir,
      filename: 'bar.pdf',
      mirrors: ['https://dead.test', 'https://live.test'],
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });

    expect(out).not.toBeNull();
    expect(path.basename(out!)).toBe('bar.pdf');
  });

  it('falls through when landing page has no embed/iframe', async () => {
    const fakeFetch = async (url: string | URL): Promise<Response> => {
      const u = url.toString();
      if (u.startsWith('https://m1.test')) return makeRes('<html>not found</html>');
      if (u === 'https://m2.test/10.1000%2Fbaz') {
        return makeRes(`<embed src="/cache/baz.pdf">`);
      }
      if (u === 'https://m2.test/cache/baz.pdf') {
        return makeRes(new Uint8Array([9]));
      }
      return makeRes('', false);
    };

    const out = await fetchByDoi({
      doi: '10.1000/baz',
      destDir: tmpDir,
      filename: 'baz.pdf',
      mirrors: ['https://m1.test', 'https://m2.test'],
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });

    expect(out).not.toBeNull();
  });

  it('returns null when every mirror fails', async () => {
    const fakeFetch = async (): Promise<Response> => makeRes('', false);
    const out = await fetchByDoi({
      doi: '10.1000/none',
      destDir: tmpDir,
      filename: 'none.pdf',
      mirrors: ['https://x.test', 'https://y.test'],
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    expect(out).toBeNull();
  });

  it('survives a fetch that throws and tries the next mirror', async () => {
    const fakeFetch = async (url: string | URL): Promise<Response> => {
      const u = url.toString();
      if (u.startsWith('https://boom.test')) {
        throw new Error('econnreset');
      }
      if (u === 'https://ok.test/10.1000%2Fqux') {
        return makeRes(`<embed src="https://ok.test/qux.pdf">`);
      }
      if (u === 'https://ok.test/qux.pdf') {
        return makeRes(new Uint8Array([7]));
      }
      return makeRes('', false);
    };

    const out = await fetchByDoi({
      doi: '10.1000/qux',
      destDir: tmpDir,
      filename: 'qux.pdf',
      mirrors: ['https://boom.test', 'https://ok.test'],
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    expect(out).not.toBeNull();
  });
});
