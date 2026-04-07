/**
 * Obsidian-style wikilink parsing: `[[target]]`, `[[target|alias]]`,
 * `[[target#heading]]`, `[[target#heading|alias]]`.
 *
 * We do NOT support embedded links (`![[...]]`) specially — they parse as
 * regular wikilinks with `embedded: true`.
 */

export interface WikiLink {
  /** The link target, e.g. `papers/attention-is-all-you-need` */
  target: string;
  /** Optional heading anchor (text after `#`) */
  heading?: string;
  /** Optional display alias (text after `|`) */
  alias?: string;
  /** True if the original syntax was `![[...]]` (transclusion) */
  embedded: boolean;
  /** Byte offset into the source string where the link begins */
  start: number;
  /** Byte offset into the source string where the link ends (exclusive) */
  end: number;
}

const WIKILINK_RE = /(!?)\[\[([^\]\n]+)\]\]/g;

/** Extract all wikilinks from a markdown string. */
export function parseWikilinks(markdown: string): WikiLink[] {
  const links: WikiLink[] = [];
  WIKILINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_RE.exec(markdown)) !== null) {
    const embedded = match[1] === '!';
    const inner = match[2];
    if (!inner) continue;

    let target = inner;
    let alias: string | undefined;
    let heading: string | undefined;

    const pipeIdx = target.indexOf('|');
    if (pipeIdx >= 0) {
      alias = target.slice(pipeIdx + 1).trim();
      target = target.slice(0, pipeIdx);
    }

    const hashIdx = target.indexOf('#');
    if (hashIdx >= 0) {
      heading = target.slice(hashIdx + 1).trim();
      target = target.slice(0, hashIdx);
    }

    target = target.trim();
    if (!target) continue;

    links.push({
      target,
      heading,
      alias,
      embedded,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return links;
}

/** Return unique link targets referenced in a page (deduped, sorted). */
export function uniqueTargets(markdown: string): string[] {
  const set = new Set(parseWikilinks(markdown).map((l) => l.target));
  return Array.from(set).sort();
}
