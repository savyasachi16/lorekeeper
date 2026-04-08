import { describe, it, expect } from 'vitest';
import { buildFilterPrompt, parseFilterResponse, rankByRelevance } from '../src/fetch/filter.js';
import type { PaperCandidate } from '../src/fetch/types.js';

function makeCandidate(id: string, title: string): PaperCandidate {
  return { id, title, authors: ['Alice', 'Bob'], abstract: `abstract for ${id}`, source: 'arxiv' };
}

const CANDIDATES: PaperCandidate[] = [
  makeCandidate('1706.03762', 'Attention Is All You Need'),
  makeCandidate('1810.04805', 'BERT: Pre-training of Deep Bidirectional Transformers'),
  makeCandidate('2005.14165', 'GPT-3: Language Models are Few-Shot Learners'),
  makeCandidate('2010.11929', 'An Image is Worth 16x16 Words'),
];

describe('buildFilterPrompt', () => {
  it('includes the query, limit, and all candidate ids', () => {
    const prompt = buildFilterPrompt('transformer attention', CANDIDATES, 2);
    expect(prompt).toContain('transformer attention');
    expect(prompt).toContain('up to 2');
    for (const c of CANDIDATES) expect(prompt).toContain(c.id);
  });

  it('truncates author lists past three', () => {
    const many: PaperCandidate = {
      id: 'x',
      title: 't',
      authors: ['A', 'B', 'C', 'D', 'E'],
      abstract: 'a',
      source: 'arxiv',
    };
    const prompt = buildFilterPrompt('q', [many], 1);
    expect(prompt).toContain('A, B, C, et al.');
  });
});

describe('parseFilterResponse', () => {
  it('resolves selected ids in order', () => {
    const text = `{"selected": ["2005.14165", "1706.03762"]}`;
    const out = parseFilterResponse(text, CANDIDATES, 5);
    expect(out?.map((c) => c.id)).toEqual(['2005.14165', '1706.03762']);
  });

  it('strips markdown code fences', () => {
    const text = '```json\n{"selected": ["1810.04805"]}\n```';
    const out = parseFilterResponse(text, CANDIDATES, 5);
    expect(out?.map((c) => c.id)).toEqual(['1810.04805']);
  });

  it('caps the result at the limit', () => {
    const text = `{"selected": ["1706.03762", "1810.04805", "2005.14165", "2010.11929"]}`;
    const out = parseFilterResponse(text, CANDIDATES, 2);
    expect(out).toHaveLength(2);
    expect(out?.map((c) => c.id)).toEqual(['1706.03762', '1810.04805']);
  });

  it('drops unknown ids and dedupes', () => {
    const text = `{"selected": ["bogus", "1706.03762", "1706.03762", "2005.14165"]}`;
    const out = parseFilterResponse(text, CANDIDATES, 5);
    expect(out?.map((c) => c.id)).toEqual(['1706.03762', '2005.14165']);
  });

  it('returns null on malformed JSON', () => {
    expect(parseFilterResponse('not json at all', CANDIDATES, 5)).toBeNull();
  });

  it('returns null when selected is not an array', () => {
    expect(parseFilterResponse(`{"selected": "1706.03762"}`, CANDIDATES, 5)).toBeNull();
  });

  it('returns null when no selected ids match candidates', () => {
    expect(parseFilterResponse(`{"selected": ["nope", "also-nope"]}`, CANDIDATES, 5)).toBeNull();
  });
});

describe('rankByRelevance', () => {
  function fakeQuery(resultText: string) {
    return () =>
      (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          result: resultText,
          num_turns: 1,
          total_cost_usd: 0,
        };
      })();
  }

  it('returns input as-is when count is already <= limit', async () => {
    const out = await rankByRelevance({
      query: 'q',
      candidates: CANDIDATES.slice(0, 2),
      limit: 5,
      queryImpl: (() => {
        throw new Error('should not be called');
      }) as never,
    });
    expect(out).toHaveLength(2);
  });

  it('uses model selection when filter parses cleanly', async () => {
    const out = await rankByRelevance({
      query: 'language models',
      candidates: CANDIDATES,
      limit: 2,
      queryImpl: fakeQuery(`{"selected": ["2005.14165", "1810.04805"]}`) as never,
    });
    expect(out.map((c) => c.id)).toEqual(['2005.14165', '1810.04805']);
  });

  it('falls back to original order when JSON is malformed', async () => {
    const out = await rankByRelevance({
      query: 'q',
      candidates: CANDIDATES,
      limit: 2,
      queryImpl: fakeQuery('garbage non-json') as never,
    });
    expect(out.map((c) => c.id)).toEqual(['1706.03762', '1810.04805']);
  });

  it('falls back when the SDK call throws', async () => {
    const out = await rankByRelevance({
      query: 'q',
      candidates: CANDIDATES,
      limit: 3,
      queryImpl: (() => {
        throw new Error('sdk down');
      }) as never,
    });
    expect(out.map((c) => c.id)).toEqual(['1706.03762', '1810.04805', '2005.14165']);
  });

  it('falls back when result subtype is not success', async () => {
    const queryImpl = (() =>
      (async function* () {
        yield { type: 'result', subtype: 'error', num_turns: 1, total_cost_usd: 0, errors: [] };
      })()) as never;
    const out = await rankByRelevance({
      query: 'q',
      candidates: CANDIDATES,
      limit: 1,
      queryImpl,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('1706.03762');
  });
});
