import { describe, it, expect } from 'vitest';
import { parseWikilinks, uniqueTargets } from '../src/core/wikilinks.js';

describe('parseWikilinks', () => {
  it('parses plain wikilinks', () => {
    const links = parseWikilinks('see [[papers/foo]] and [[concepts/bar]]');
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ target: 'papers/foo', embedded: false });
    expect(links[1]).toMatchObject({ target: 'concepts/bar', embedded: false });
  });

  it('parses aliased wikilinks', () => {
    const [link] = parseWikilinks('see [[papers/foo|this paper]]');
    expect(link).toMatchObject({ target: 'papers/foo', alias: 'this paper' });
  });

  it('parses heading anchors', () => {
    const [link] = parseWikilinks('see [[papers/foo#methods]]');
    expect(link).toMatchObject({ target: 'papers/foo', heading: 'methods' });
  });

  it('parses heading + alias combo', () => {
    const [link] = parseWikilinks('see [[papers/foo#methods|the methods]]');
    expect(link).toMatchObject({
      target: 'papers/foo',
      heading: 'methods',
      alias: 'the methods',
    });
  });

  it('parses embedded wikilinks', () => {
    const [link] = parseWikilinks('![[figures/chart.png]]');
    expect(link).toMatchObject({ target: 'figures/chart.png', embedded: true });
  });

  it('ignores malformed links', () => {
    expect(parseWikilinks('[[]]')).toEqual([]);
    expect(parseWikilinks('[[   ]]')).toEqual([]);
  });

  it('records byte offsets', () => {
    const text = 'prefix [[target]] suffix';
    const [link] = parseWikilinks(text);
    expect(text.slice(link.start, link.end)).toBe('[[target]]');
  });
});

describe('uniqueTargets', () => {
  it('dedupes and sorts', () => {
    const targets = uniqueTargets('[[b]] [[a]] [[b|alias]] [[a#heading]]');
    expect(targets).toEqual(['a', 'b']);
  });
});
