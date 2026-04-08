import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { PaperCandidate } from './types.js';

/**
 * LLM relevance filter. Given a user query and a list of candidate papers
 * (already over-fetched from arXiv), ask Claude to pick the top N most
 * relevant ones. Pure ranking — no tools, single turn, JSON-only output.
 *
 * On any failure (parse error, timeout, fewer IDs than requested) we fall
 * back to the engine's original ranking order. Filtering is best-effort:
 * losing it should never block a `pull` invocation.
 */

const SYSTEM_PROMPT = `You are a research librarian helping a user find relevant papers.
You will receive a research query and a numbered list of candidate papers (title + abstract).
Pick the most relevant ones, preferring specific results over broad surveys and avoiding
near-duplicates on the same result.

Respond with JSON ONLY, no prose, no markdown fences. Format:
{"selected": ["<id>", "<id>", ...]}

Where each <id> is the exact id string from the candidate list. Return at most the
requested number of papers, in descending order of relevance.`;

export interface RankByRelevanceOptions {
  query: string;
  candidates: PaperCandidate[];
  limit: number;
  model?: string;
  /** Override the SDK query function for tests. */
  queryImpl?: typeof query;
}

/** Build the user message presenting candidates to the model. */
export function buildFilterPrompt(
  userQuery: string,
  candidates: PaperCandidate[],
  limit: number,
): string {
  const list = candidates
    .map((c, i) => {
      const authors = c.authors.slice(0, 3).join(', ') + (c.authors.length > 3 ? ', et al.' : '');
      const year = c.year ? ` (${c.year})` : '';
      return `${i + 1}. id=${c.id}\n   title: ${c.title}${year}\n   authors: ${authors}\n   abstract: ${c.abstract}`;
    })
    .join('\n\n');
  return `Research query: ${userQuery}

Pick up to ${limit} most relevant papers from the list below.

${list}

Respond with JSON only.`;
}

/**
 * Parse the model's JSON response and resolve it to a ranked subset of
 * candidates. Returns null on any parse failure so the caller can fall back.
 */
export function parseFilterResponse(
  text: string,
  candidates: PaperCandidate[],
  limit: number,
): PaperCandidate[] | null {
  // Strip optional markdown fences in case the model ignores instructions.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { selected?: unknown }).selected)
  ) {
    return null;
  }
  const selected = (parsed as { selected: unknown[] }).selected.filter(
    (s): s is string => typeof s === 'string',
  );
  if (selected.length === 0) return null;

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const ranked: PaperCandidate[] = [];
  const seen = new Set<string>();
  for (const id of selected) {
    if (seen.has(id)) continue;
    const c = byId.get(id);
    if (c) {
      ranked.push(c);
      seen.add(id);
    }
    if (ranked.length >= limit) break;
  }
  return ranked.length > 0 ? ranked : null;
}

/**
 * Rank candidates by relevance using a one-shot Claude call. On any failure,
 * returns the first `limit` candidates in their original order.
 */
export async function rankByRelevance(opts: RankByRelevanceOptions): Promise<PaperCandidate[]> {
  if (opts.candidates.length <= opts.limit) return opts.candidates;

  const prompt = buildFilterPrompt(opts.query, opts.candidates, opts.limit);
  const queryImpl = opts.queryImpl ?? query;

  const options: Options = {
    systemPrompt: SYSTEM_PROMPT,
    // No tools — pure inference.
    tools: [],
    allowedTools: [],
    maxTurns: 1,
    model: opts.model,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    settingSources: [],
    persistSession: false,
  };

  let text = '';
  try {
    const q = queryImpl({ prompt, options });
    for await (const msg of q as AsyncIterable<SDKMessage>) {
      if (msg.type === 'result') {
        if (msg.subtype === 'success') text = msg.result;
        break;
      }
    }
  } catch {
    return opts.candidates.slice(0, opts.limit);
  }

  const ranked = parseFilterResponse(text, opts.candidates, opts.limit);
  return ranked ?? opts.candidates.slice(0, opts.limit);
}
