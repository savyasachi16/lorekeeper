import { promises as fs } from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { PaperCandidate } from './types.js';

/**
 * arXiv search via the public Atom API. No key required, but arXiv asks for
 * ≤1 request per 3 seconds — a single search per `pull` invocation is fine.
 *
 * Docs: https://info.arxiv.org/help/api/user-manual.html
 */

const ARXIV_API = 'https://export.arxiv.org/api/query';
const USER_AGENT = 'lorekeeper/0.2.0 (+https://github.com/savya/lorekeeper)';

// Minimal shape we need from the parsed Atom feed. fast-xml-parser returns
// loosely-typed objects, so we coerce at the boundary.
interface AtomEntry {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  author?: { name?: string } | Array<{ name?: string }>;
  link?: Array<{ '@_rel'?: string; '@_type'?: string; '@_title'?: string; '@_href'?: string }>;
  'arxiv:doi'?: string;
  'arxiv:primary_category'?: { '@_term'?: string };
}

interface AtomFeed {
  feed?: {
    entry?: AtomEntry | AtomEntry[];
  };
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** Extract the short arXiv ID from a full abs URL (e.g. "http://arxiv.org/abs/1706.03762v5" → "1706.03762"). */
function extractArxivId(idUrl: string): string {
  const m = idUrl.match(/arxiv\.org\/abs\/([^/\s]+?)(v\d+)?$/);
  return m ? m[1]! : idUrl;
}

function parseEntry(entry: AtomEntry): PaperCandidate | null {
  if (!entry.id || !entry.title) return null;

  const id = extractArxivId(entry.id);
  const authors = toArray(entry.author)
    .map((a) => a?.name)
    .filter((n): n is string => typeof n === 'string');

  // Find the PDF link. arXiv emits <link title="pdf" type="application/pdf" ... />.
  const pdfLink = toArray(entry.link).find(
    (l) => l['@_title'] === 'pdf' || l['@_type'] === 'application/pdf',
  );

  const year = entry.published ? Number(entry.published.slice(0, 4)) : undefined;

  return {
    id,
    title: entry.title.replace(/\s+/g, ' ').trim(),
    authors,
    abstract: (entry.summary ?? '').replace(/\s+/g, ' ').trim(),
    year: Number.isFinite(year) ? year : undefined,
    venue: 'arXiv',
    arxivPdfUrl: pdfLink?.['@_href'],
    doi: entry['arxiv:doi'],
    source: 'arxiv',
  };
}

/**
 * Parse an arXiv Atom feed XML string into PaperCandidates. Exported so tests
 * can drive it with a fixture without hitting the network.
 */
export function parseArxivFeed(xml: string): PaperCandidate[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    // Preserve multiple <link>s and <author>s as arrays even when there's one.
    isArray: (name) => name === 'link' || name === 'author' || name === 'entry',
  });
  const parsed = parser.parse(xml) as AtomFeed;
  const entries = toArray(parsed.feed?.entry);
  const candidates: PaperCandidate[] = [];
  for (const entry of entries) {
    const c = parseEntry(entry);
    if (c) candidates.push(c);
  }
  return candidates;
}

export interface ArxivSearchOptions {
  query: string;
  maxResults: number;
  /** Override the fetch function (for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Query arXiv and return candidate papers. */
export async function searchArxiv(opts: ArxivSearchOptions): Promise<PaperCandidate[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(ARXIV_API);
  url.searchParams.set('search_query', `all:${opts.query}`);
  url.searchParams.set('start', '0');
  url.searchParams.set('max_results', String(opts.maxResults));
  url.searchParams.set('sortBy', 'relevance');
  url.searchParams.set('sortOrder', 'descending');

  const res = await fetchImpl(url.toString(), {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/atom+xml' },
  });
  if (!res.ok) {
    throw new Error(`arXiv search failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  return parseArxivFeed(xml);
}

export interface DownloadPdfOptions {
  pdfUrl: string;
  destDir: string;
  filename: string;
  fetchImpl?: typeof fetch;
}

/**
 * Download a PDF from arXiv to `destDir/filename`. Returns the absolute path.
 * Overwrites an existing file with the same name.
 */
export async function downloadArxivPdf(opts: DownloadPdfOptions): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  await fs.mkdir(opts.destDir, { recursive: true });
  const dest = path.resolve(opts.destDir, opts.filename);

  const res = await fetchImpl(opts.pdfUrl, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/pdf' },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`PDF download failed: ${res.status} ${res.statusText} (${opts.pdfUrl})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
  return dest;
}

/** Build a filesystem-safe filename for a candidate, ending in `.pdf`. */
export function candidateFilename(c: PaperCandidate): string {
  const slug = c.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${slug || c.id}.pdf`;
}
