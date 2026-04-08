import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Vault } from '../core/vault.js';
import type { PaperCandidate, PullEvent } from '../fetch/types.js';
import { searchArxiv, downloadArxivPdf, candidateFilename } from '../fetch/arxiv.js';
import { fetchByDoi as scihubFetchByDoi } from '../fetch/scihub.js';
import { rankByRelevance } from '../fetch/filter.js';
import { ingestSource } from './ingest.js';

/**
 * `pull` orchestrator: search → optional LLM filter → per-paper download →
 * per-paper ingest. Errors on individual papers don't halt the batch — they
 * land in `skipped` and the loop continues.
 */

export interface PullOptions {
  vault: Vault;
  query: string;
  /** Number of papers to ingest. */
  limit: number;
  /** Allow Sci-Hub fallback for non-arXiv DOIs. Default false. */
  useScihub?: boolean;
  /** Skip the LLM relevance filter. Default false. */
  noFilter?: boolean;
  /** Optional model override (used by both filter and per-paper ingest). */
  model?: string;
  /** Streaming progress callback for CLI/MCP consumers. */
  onProgress?: (event: PullEvent) => void;
  // ===== injection points for tests =====
  searchImpl?: typeof searchArxiv;
  downloadImpl?: typeof downloadArxivPdf;
  scihubImpl?: typeof scihubFetchByDoi;
  filterImpl?: typeof rankByRelevance;
  ingestImpl?: typeof ingestSource;
}

export interface PullResult {
  requested: number;
  fetched: number;
  ingested: number;
  skipped: { title: string; reason: string }[];
  perPaperResults: { title: string; ok: boolean; turns: number }[];
}

/** Over-fetch factor: ask arXiv for ~3x the requested limit so the LLM filter has headroom. */
const OVERFETCH_MULTIPLIER = 3;

export async function pullPapers(opts: PullOptions): Promise<PullResult> {
  const search = opts.searchImpl ?? searchArxiv;
  const download = opts.downloadImpl ?? downloadArxivPdf;
  const scihub = opts.scihubImpl ?? scihubFetchByDoi;
  const filter = opts.filterImpl ?? rankByRelevance;
  const ingest = opts.ingestImpl ?? ingestSource;
  const emit = (e: PullEvent): void => opts.onProgress?.(e);

  const result: PullResult = {
    requested: opts.limit,
    fetched: 0,
    ingested: 0,
    skipped: [],
    perPaperResults: [],
  };

  // 1. Search arXiv (over-fetch for filter headroom).
  const maxResults = opts.noFilter ? opts.limit : opts.limit * OVERFETCH_MULTIPLIER;
  emit({ type: 'search_start', query: opts.query, limit: opts.limit });
  const candidates = await search({ query: opts.query, maxResults });
  emit({ type: 'search_done', count: candidates.length });

  if (candidates.length === 0) {
    return result;
  }

  // 2. Optional LLM relevance filter.
  let chosen: PaperCandidate[];
  if (opts.noFilter || candidates.length <= opts.limit) {
    chosen = candidates.slice(0, opts.limit);
  } else {
    emit({ type: 'filter_start', count: candidates.length });
    chosen = await filter({
      query: opts.query,
      candidates,
      limit: opts.limit,
      model: opts.model,
    });
    emit({ type: 'filter_done', count: chosen.length });
  }

  // 3. Per-paper download + ingest. Use a temp dir so failed downloads
  // don't litter the vault, then ingestSource copies into sources/.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lorekeeper-pull-'));

  try {
    for (let i = 0; i < chosen.length; i++) {
      const c = chosen[i]!;
      const total = chosen.length;
      emit({ type: 'download_start', title: c.title, index: i + 1, total });

      let pdfPath: string | null = null;
      try {
        if (c.arxivPdfUrl) {
          pdfPath = await download({
            pdfUrl: c.arxivPdfUrl,
            destDir: tmpDir,
            filename: candidateFilename(c),
          });
        } else if (opts.useScihub && c.doi) {
          pdfPath = await scihub({
            doi: c.doi,
            destDir: tmpDir,
            filename: candidateFilename(c),
          });
        } else {
          const reason = c.doi
            ? 'no arXiv PDF and Sci-Hub disabled'
            : 'no arXiv PDF and no DOI';
          result.skipped.push({ title: c.title, reason });
          emit({ type: 'download_failed', title: c.title, reason });
          continue;
        }
      } catch (err) {
        const reason = `download error: ${(err as Error).message}`;
        result.skipped.push({ title: c.title, reason });
        emit({ type: 'download_failed', title: c.title, reason });
        continue;
      }

      if (!pdfPath) {
        const reason = 'all sources returned no PDF';
        result.skipped.push({ title: c.title, reason });
        emit({ type: 'download_failed', title: c.title, reason });
        continue;
      }

      result.fetched++;
      emit({ type: 'download_done', title: c.title, path: pdfPath });

      // 4. Ingest. Per-paper failures don't halt the batch.
      emit({ type: 'ingest_start', title: c.title });
      try {
        const ir = await ingest({
          vault: opts.vault,
          sourcePath: pdfPath,
          model: opts.model,
        });
        result.perPaperResults.push({ title: c.title, ok: ir.ok, turns: ir.turns });
        if (ir.ok) result.ingested++;
        else result.skipped.push({ title: c.title, reason: 'ingest failed' });
        emit({ type: 'ingest_done', title: c.title, ok: ir.ok, turns: ir.turns });
      } catch (err) {
        const reason = `ingest error: ${(err as Error).message}`;
        result.skipped.push({ title: c.title, reason });
        emit({ type: 'ingest_done', title: c.title, ok: false, turns: 0 });
      }
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  return result;
}
