import { describe, it, expect, vi } from 'vitest';
import { pullPapers } from '../src/ops/pull.js';
import type { PaperCandidate, PullEvent } from '../src/fetch/types.js';
import type { Vault } from '../src/core/vault.js';

const VAULT: Vault = { root: '/fake/vault' };

function makeCandidate(
  id: string,
  title: string,
  opts: { pdfUrl?: string; doi?: string } = {},
): PaperCandidate {
  return {
    id,
    title,
    authors: ['Author'],
    abstract: `abstract ${id}`,
    source: 'arxiv',
    arxivPdfUrl: opts.pdfUrl,
    doi: opts.doi,
  };
}

const C1 = makeCandidate('1706.03762', 'Attention Is All You Need', {
  pdfUrl: 'http://arxiv.org/pdf/1706.03762',
});
const C2 = makeCandidate('1810.04805', 'BERT', { pdfUrl: 'http://arxiv.org/pdf/1810.04805' });
const C3 = makeCandidate('2005.14165', 'GPT-3', { pdfUrl: 'http://arxiv.org/pdf/2005.14165' });
const C4_NOPDF = makeCandidate('only-doi', 'DOI Only Paper', { doi: '10.1000/foo' });
const C5_NOTHING = makeCandidate('orphan', 'Orphan Paper');

describe('pullPapers', () => {
  it('runs the full pipeline: search → filter → download → ingest', async () => {
    const events: PullEvent[] = [];
    const search = vi.fn(async () => [C1, C2, C3]);
    const filter = vi.fn(async ({ candidates, limit }) => candidates.slice(0, limit));
    const download = vi.fn(async ({ filename }: { filename: string }) => `/tmp/${filename}`);
    const ingest = vi.fn(async () => ({
      ok: true,
      turns: 5,
      text: 'done',
      sourceInVault: 'sources/x.pdf',
      wasNew: true,
    }));

    const result = await pullPapers({
      vault: VAULT,
      query: 'transformers',
      limit: 2,
      onProgress: (e) => events.push(e),
      searchImpl: search as never,
      downloadImpl: download as never,
      filterImpl: filter as never,
      ingestImpl: ingest as never,
    });

    expect(result.requested).toBe(2);
    expect(result.fetched).toBe(2);
    expect(result.ingested).toBe(2);
    expect(result.skipped).toEqual([]);
    expect(result.perPaperResults).toHaveLength(2);

    // Search asked for over-fetched count.
    expect(search).toHaveBeenCalledWith({ query: 'transformers', maxResults: 6 });
    // Filter trimmed to limit.
    expect(filter).toHaveBeenCalledTimes(1);
    // Two downloads + two ingests.
    expect(download).toHaveBeenCalledTimes(2);
    expect(ingest).toHaveBeenCalledTimes(2);

    // Events emitted in roughly correct order.
    expect(events[0]).toMatchObject({ type: 'search_start' });
    expect(events.some((e) => e.type === 'filter_done')).toBe(true);
    expect(events.filter((e) => e.type === 'ingest_done')).toHaveLength(2);
  });

  it('skips the filter when noFilter=true and uses limit directly', async () => {
    const search = vi.fn(async () => [C1, C2, C3]);
    const filter = vi.fn();
    const download = vi.fn(async ({ filename }: { filename: string }) => `/tmp/${filename}`);
    const ingest = vi.fn(async () => ({
      ok: true,
      turns: 1,
      text: '',
      sourceInVault: 'sources/x.pdf',
      wasNew: true,
    }));

    const result = await pullPapers({
      vault: VAULT,
      query: 'q',
      limit: 2,
      noFilter: true,
      searchImpl: search as never,
      downloadImpl: download as never,
      filterImpl: filter as never,
      ingestImpl: ingest as never,
    });

    expect(search).toHaveBeenCalledWith({ query: 'q', maxResults: 2 });
    expect(filter).not.toHaveBeenCalled();
    expect(result.ingested).toBe(2);
  });

  it('skips candidates with no PDF and no Sci-Hub fallback', async () => {
    const ingest = vi.fn(async () => ({
      ok: true,
      turns: 1,
      text: '',
      sourceInVault: 'sources/x.pdf',
      wasNew: true,
    }));
    const result = await pullPapers({
      vault: VAULT,
      query: 'q',
      limit: 3,
      noFilter: true,
      searchImpl: (async () => [C1, C5_NOTHING, C4_NOPDF]) as never,
      downloadImpl: (async ({ filename }: { filename: string }) => `/tmp/${filename}`) as never,
      ingestImpl: ingest as never,
    });

    expect(result.ingested).toBe(1);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.map((s) => s.title)).toEqual(['Orphan Paper', 'DOI Only Paper']);
  });

  it('uses Sci-Hub fallback for DOI-only candidates when enabled', async () => {
    const scihub = vi.fn(async ({ filename }: { filename: string }) => `/tmp/${filename}`);
    const ingest = vi.fn(async () => ({
      ok: true,
      turns: 1,
      text: '',
      sourceInVault: 'sources/x.pdf',
      wasNew: true,
    }));
    const result = await pullPapers({
      vault: VAULT,
      query: 'q',
      limit: 2,
      useScihub: true,
      noFilter: true,
      searchImpl: (async () => [C1, C4_NOPDF]) as never,
      downloadImpl: (async ({ filename }: { filename: string }) => `/tmp/${filename}`) as never,
      scihubImpl: scihub as never,
      ingestImpl: ingest as never,
    });

    expect(scihub).toHaveBeenCalledTimes(1);
    expect(scihub).toHaveBeenCalledWith(
      expect.objectContaining({ doi: '10.1000/foo' }),
    );
    expect(result.ingested).toBe(2);
    expect(result.skipped).toEqual([]);
  });

  it('records but does not halt on individual download failures', async () => {
    const download = vi.fn(async ({ pdfUrl }: { pdfUrl: string }) => {
      if (pdfUrl.includes('1810.04805')) throw new Error('404');
      return '/tmp/ok.pdf';
    });
    const ingest = vi.fn(async () => ({
      ok: true,
      turns: 1,
      text: '',
      sourceInVault: 'sources/x.pdf',
      wasNew: true,
    }));
    const result = await pullPapers({
      vault: VAULT,
      query: 'q',
      limit: 3,
      noFilter: true,
      searchImpl: (async () => [C1, C2, C3]) as never,
      downloadImpl: download as never,
      ingestImpl: ingest as never,
    });

    expect(result.fetched).toBe(2);
    expect(result.ingested).toBe(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain('404');
  });

  it('records but does not halt on individual ingest failures', async () => {
    let calls = 0;
    const ingest = vi.fn(async () => {
      calls++;
      return {
        ok: calls !== 2,
        turns: 1,
        text: '',
        sourceInVault: 'sources/x.pdf',
        wasNew: true,
      };
    });
    const result = await pullPapers({
      vault: VAULT,
      query: 'q',
      limit: 3,
      noFilter: true,
      searchImpl: (async () => [C1, C2, C3]) as never,
      downloadImpl: (async ({ filename }: { filename: string }) => `/tmp/${filename}`) as never,
      ingestImpl: ingest as never,
    });

    expect(result.fetched).toBe(3);
    expect(result.ingested).toBe(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toBe('ingest failed');
  });

  it('returns early when search yields no candidates', async () => {
    const ingest = vi.fn();
    const result = await pullPapers({
      vault: VAULT,
      query: 'no results',
      limit: 5,
      searchImpl: (async () => []) as never,
      ingestImpl: ingest as never,
    });
    expect(result.fetched).toBe(0);
    expect(result.ingested).toBe(0);
    expect(ingest).not.toHaveBeenCalled();
  });
});
