import { describe, it, expect } from 'vitest';
import { parseArxivFeed, candidateFilename } from '../src/fetch/arxiv.js';

const FIXTURE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <title type="html">ArXiv Query: search_query=all:transformer</title>
  <id>http://arxiv.org/api/query</id>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v5</id>
    <updated>2017-12-06T18:41:51Z</updated>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All You
      Need</title>
    <summary>  The dominant sequence transduction models are based on
      complex recurrent or convolutional neural networks.  </summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <author><name>Niki Parmar</name></author>
    <arxiv:doi>10.48550/arXiv.1706.03762</arxiv:doi>
    <link href="http://arxiv.org/abs/1706.03762v5" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/1706.03762v5" rel="related" type="application/pdf"/>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2005.14165v4</id>
    <published>2020-05-28T17:29:03Z</published>
    <title>Language Models are Few-Shot Learners</title>
    <summary>Recent work has demonstrated substantial gains on many NLP tasks.</summary>
    <author><name>Tom B. Brown</name></author>
    <link href="http://arxiv.org/abs/2005.14165v4" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2005.14165v4" rel="related" type="application/pdf"/>
  </entry>
</feed>`;

describe('parseArxivFeed', () => {
  it('extracts candidates from a multi-entry Atom feed', () => {
    const candidates = parseArxivFeed(FIXTURE_FEED);
    expect(candidates).toHaveLength(2);
  });

  it('strips version suffix and abs/ prefix from id', () => {
    const [first] = parseArxivFeed(FIXTURE_FEED);
    expect(first.id).toBe('1706.03762');
  });

  it('collapses whitespace in title and abstract', () => {
    const [first] = parseArxivFeed(FIXTURE_FEED);
    expect(first.title).toBe('Attention Is All You Need');
    expect(first.abstract).toBe(
      'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.',
    );
  });

  it('captures all authors as an array', () => {
    const [first] = parseArxivFeed(FIXTURE_FEED);
    expect(first.authors).toEqual(['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar']);
  });

  it('handles a single-author entry', () => {
    const [, second] = parseArxivFeed(FIXTURE_FEED);
    expect(second.authors).toEqual(['Tom B. Brown']);
  });

  it('extracts the PDF link href', () => {
    const [first] = parseArxivFeed(FIXTURE_FEED);
    expect(first.arxivPdfUrl).toBe('http://arxiv.org/pdf/1706.03762v5');
  });

  it('extracts year from published date', () => {
    const [first, second] = parseArxivFeed(FIXTURE_FEED);
    expect(first.year).toBe(2017);
    expect(second.year).toBe(2020);
  });

  it('captures DOI when present and leaves it undefined when absent', () => {
    const [first, second] = parseArxivFeed(FIXTURE_FEED);
    expect(first.doi).toBe('10.48550/arXiv.1706.03762');
    expect(second.doi).toBeUndefined();
  });

  it('marks venue as arXiv', () => {
    const [first] = parseArxivFeed(FIXTURE_FEED);
    expect(first.venue).toBe('arXiv');
    expect(first.source).toBe('arxiv');
  });

  it('returns an empty array for an empty feed', () => {
    const empty = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`;
    expect(parseArxivFeed(empty)).toEqual([]);
  });
});

describe('candidateFilename', () => {
  it('slugifies title to a safe pdf filename', () => {
    const name = candidateFilename({
      id: '1706.03762',
      title: 'Attention Is All You Need',
      authors: [],
      abstract: '',
      source: 'arxiv',
    });
    expect(name).toBe('attention-is-all-you-need.pdf');
  });

  it('strips punctuation and special characters', () => {
    const name = candidateFilename({
      id: 'x',
      title: 'BERT: Pre-training of Deep Bidirectional Transformers!',
      authors: [],
      abstract: '',
      source: 'arxiv',
    });
    expect(name).toBe('bert-pre-training-of-deep-bidirectional-transformers.pdf');
  });

  it('falls back to id when title is empty', () => {
    const name = candidateFilename({
      id: '2401.00001',
      title: '',
      authors: [],
      abstract: '',
      source: 'arxiv',
    });
    expect(name).toBe('2401.00001.pdf');
  });

  it('truncates very long titles', () => {
    const longTitle = 'a'.repeat(200);
    const name = candidateFilename({
      id: 'x',
      title: longTitle,
      authors: [],
      abstract: '',
      source: 'arxiv',
    });
    // 80-char slug + ".pdf"
    expect(name.length).toBeLessThanOrEqual(84);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});
