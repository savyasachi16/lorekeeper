/**
 * Shared types for the paper-fetching pipeline. See src/ops/pull.ts for the
 * orchestrator that composes these.
 */

export interface PaperCandidate {
  /** arXiv ID (e.g. "1706.03762") or DOI. Unique within a candidate list. */
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  year?: number;
  venue?: string;
  /** Direct PDF URL if the paper is on arXiv. */
  arxivPdfUrl?: string;
  /** DOI, used for Sci-Hub fallback when arxivPdfUrl is absent. */
  doi?: string;
  source: 'arxiv';
}

/** Streaming progress events emitted by pullPapers() for CLI/MCP consumers. */
export type PullEvent =
  | { type: 'search_start'; query: string; limit: number }
  | { type: 'search_done'; count: number }
  | { type: 'filter_start'; count: number }
  | { type: 'filter_done'; count: number }
  | { type: 'download_start'; title: string; index: number; total: number }
  | { type: 'download_done'; title: string; path: string }
  | { type: 'download_failed'; title: string; reason: string }
  | { type: 'ingest_start'; title: string }
  | { type: 'ingest_done'; title: string; ok: boolean; turns: number };
