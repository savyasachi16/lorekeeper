import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Sci-Hub fallback for non-arXiv DOIs. Sci-Hub is legally gray in many
 * jurisdictions; this module is OFF by default and must be explicitly enabled
 * per `pull` invocation via `--use-scihub`.
 *
 * Mirrors and HTML structure change without notice — keep all scraping
 * isolated to this file so fixes don't bleed into the rest of the codebase.
 */

const DEFAULT_MIRRORS = ['https://sci-hub.se', 'https://sci-hub.ru', 'https://sci-hub.st'];

// Browser-ish UA — Sci-Hub mirrors sometimes 403 a bare Node UA.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

let warnedThisInvocation = false;

function warnOnce(): void {
  if (warnedThisInvocation) return;
  warnedThisInvocation = true;
  process.stderr.write(
    'lorekeeper: Using Sci-Hub fallback. Ensure this is legal in your jurisdiction.\n',
  );
}

/** For tests. Resets the once-per-invocation warning latch. */
export function _resetScihubWarning(): void {
  warnedThisInvocation = false;
}

/** Resolve mirror list from env var, comma-separated, or fall back to defaults. */
export function getScihubMirrors(): string[] {
  const env = process.env.LOREKEEPER_SCIHUB_MIRRORS;
  if (!env) return [...DEFAULT_MIRRORS];
  return env
    .split(',')
    .map((m) => m.trim().replace(/\/+$/, ''))
    .filter((m) => m.length > 0);
}

/**
 * Extract a PDF URL from a Sci-Hub HTML response. Looks for `<embed>` or
 * `<iframe>` with a src attribute. Resolves protocol-less (`//host/...`) and
 * root-relative (`/host/...`) URLs against the mirror origin.
 *
 * Returns null if no candidate src is found.
 */
export function extractPdfUrl(html: string, mirrorBase: string): string | null {
  // Match <embed ... src="..."> or <iframe ... src="..."> — Sci-Hub uses both
  // depending on mirror and browser detection.
  const re = /<(?:embed|iframe)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i;
  const m = html.match(re);
  if (!m) return null;
  let src = m[1]!.trim();
  // Strip URL fragments — Sci-Hub appends `#view=FitH` etc.
  const hashIdx = src.indexOf('#');
  if (hashIdx >= 0) src = src.slice(0, hashIdx);
  if (!src) return null;

  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) {
    const origin = new URL(mirrorBase).origin;
    return `${origin}${src}`;
  }
  // Relative path — resolve against mirror base.
  return new URL(src, mirrorBase + '/').toString();
}

export interface FetchByDoiOptions {
  doi: string;
  destDir: string;
  filename: string;
  mirrors?: string[];
  fetchImpl?: typeof fetch;
}

/**
 * Try each Sci-Hub mirror in order. For each one: fetch the DOI landing page,
 * scrape out the embedded PDF URL, then download the PDF. Returns the absolute
 * path to the saved file, or null if every mirror failed.
 */
export async function fetchByDoi(opts: FetchByDoiOptions): Promise<string | null> {
  warnOnce();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const mirrors = opts.mirrors ?? getScihubMirrors();
  await fs.mkdir(opts.destDir, { recursive: true });
  const dest = path.resolve(opts.destDir, opts.filename);

  for (const mirror of mirrors) {
    try {
      const landingUrl = `${mirror}/${encodeURIComponent(opts.doi)}`;
      const landingRes = await fetchImpl(landingUrl, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        redirect: 'follow',
      });
      if (!landingRes.ok) continue;
      const html = await landingRes.text();
      const pdfUrl = extractPdfUrl(html, mirror);
      if (!pdfUrl) continue;

      const pdfRes = await fetchImpl(pdfUrl, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/pdf' },
        redirect: 'follow',
      });
      if (!pdfRes.ok) continue;
      const buf = Buffer.from(await pdfRes.arrayBuffer());
      await fs.writeFile(dest, buf);
      return dest;
    } catch {
      // Try next mirror.
      continue;
    }
  }
  return null;
}
