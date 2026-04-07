import { describe, it, expect } from 'vitest';
import { parsePage, serializePage } from '../src/core/frontmatter.js';

describe('parsePage', () => {
  it('parses frontmatter and body', () => {
    const raw = `---
type: paper
title: Attention Is All You Need
year: 2017
---

Body here.
`;
    const page = parsePage(raw);
    expect(page.data).toMatchObject({
      type: 'paper',
      title: 'Attention Is All You Need',
      year: 2017,
    });
    expect(page.content.trim()).toBe('Body here.');
  });

  it('handles pages with no frontmatter', () => {
    const page = parsePage('just text');
    expect(page.data).toEqual({});
    expect(page.content).toBe('just text');
  });
});

describe('serializePage', () => {
  it('roundtrips through parse → serialize → parse', () => {
    const data = { type: 'concept', title: 'Self-attention', tags: ['transformer'] };
    const body = 'A mechanism that…';
    const serialized = serializePage(data, body);
    const reparsed = parsePage(serialized);
    expect(reparsed.data).toEqual(data);
    expect(reparsed.content.trim()).toBe(body);
  });
});
