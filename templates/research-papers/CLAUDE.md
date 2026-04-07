# Lorekeeper Vault — Research Papers Schema

You are maintaining a **research-papers wiki** in this directory. This document is your schema contract. Follow it strictly. When the user edits this file, the rules they write here override the defaults below.

## What this vault is

A persistent, interlinked markdown knowledge base built from research papers. Each ingested paper produces a `papers/*.md` page and may create or update `concepts/`, `authors/`, and `methods/` pages that interlink via Obsidian wikilinks (`[[target]]`). The wiki compounds over time — every ingest reads existing pages and extends the graph rather than duplicating.

## Directory layout

```
CLAUDE.md                 ← this file, the schema contract
.lorekeeper/config.json   ← ingest history (lorekeeper-managed, don't hand-edit)
sources/                  ← raw papers (PDFs, .md). Immutable after ingest. DO NOT modify.
papers/                   ← one page per ingested paper
concepts/                 ← cross-cutting ideas that appear across multiple papers
authors/                  ← researcher pages, one per person
methods/                  ← techniques, architectures, algorithms
index.md                  ← human-curated entry point; you may append to it but preserve existing sections
```

Create subdirectories only if they already exist. Do **not** invent new top-level directories.

## Page types

Every page has YAML frontmatter. The `type` field is required and must be one of `paper`, `concept`, `author`, `method`. Titles in frontmatter are human-readable; filenames are the slugified form used in wikilinks.

### `paper`

```yaml
---
type: paper
title: Attention Is All You Need
authors: ["[[authors/vaswani-ashish]]", "[[authors/shazeer-noam]]"]
year: 2017
venue: NeurIPS
source: sources/attention-is-all-you-need.pdf
ingested: 2026-04-07
tags: [transformer, attention, nlp]
---
```

Body structure (use these exact H2 headings):

```markdown
## Summary
One paragraph. What problem, what approach, what result. No marketing language.

## Key contributions
- Bullet list of the 2–5 things this paper is actually cited for.

## Methods
Prose description linking to [[methods/...]] pages for each technique introduced
or used. If a method is novel to this paper, create the method page.

## Findings
What the experiments showed. Include headline numbers.

## Connections
- Links to [[concepts/...]] and other [[papers/...]] this paper relates to,
  each with a sentence explaining the connection.

## Notes
Anything that didn't fit above. Confusions, caveats, things to revisit.
```

### `concept`

```yaml
---
type: concept
title: Self-attention
tags: [transformer, attention]
---
```

Body: a running synthesis of what this concept means, drawn from every paper that references it. Structure freely but **always end with a `## Sources` section** listing the papers that contributed, as wikilinks.

### `author`

```yaml
---
type: author
title: Ashish Vaswani
affiliation: Google Brain (2017)
---
```

Body: brief biography if known, followed by `## Papers` — a bulleted list of `[[papers/...]]` pages by this author in this vault.

### `method`

```yaml
---
type: method
title: Multi-head attention
tags: [attention]
---
```

Body: explanation of the technique. End with `## Introduced in` (paper where it originated, if known) and `## Used by` (list of papers in this vault that use it).

## Filename conventions

- Lowercase, hyphenated, ASCII only.
- `papers/`: derive from title — `attention-is-all-you-need.md`. Drop articles, punctuation.
- `authors/`: `lastname-firstname.md` — `vaswani-ashish.md`. Disambiguate collisions with a middle initial.
- `concepts/`, `methods/`: the singular noun form — `self-attention.md`, `multi-head-attention.md`.

Wikilinks use the path without the `.md` extension: `[[papers/attention-is-all-you-need]]`.

## Ingest workflow (when invoked to ingest a source)

You will receive a source that has already been copied into `sources/` and, for PDFs, pre-extracted to text. Your job:

1. **Read `index.md` and glob `papers/`, `concepts/`, `authors/`, `methods/`** to learn what's already in the vault. This is non-negotiable — you must know the existing graph before writing.
2. **Extract paper metadata**: title, authors, year, venue. If ambiguous, use the most defensible inference and flag uncertainty in `## Notes`.
3. **Create the `papers/<slug>.md` page** with full frontmatter and all six H2 sections.
4. **For each author**, check if `authors/<slug>.md` exists. If yes, append this paper to its `## Papers` list. If no, create it. Never leave authors unlinked.
5. **For each method or concept mentioned prominently**, check for an existing page. If one exists, update it: add a synthesis paragraph informed by the new paper, and add the paper to its `## Sources` or `## Used by` section. If none exists and the concept/method is genuinely load-bearing for this paper, create the page. Err on the side of **updating existing pages** rather than creating near-duplicates.
6. **Update `index.md`** only if this paper represents a new cluster or theme not yet indexed. Otherwise leave it alone.
7. **Do not modify files in `sources/`** — they are immutable.
8. **Do not delete existing pages** during ingest. If you believe a page is wrong, note it in your response; the user will run `lint --fix` separately.

When you finish, report a concise summary: which pages you created, which you updated, and any flags or uncertainties.

## Query workflow (when invoked to answer a question)

You will receive a natural-language question. Your job:

1. **Start from `index.md`** and the question's keywords to identify candidate pages.
2. **Follow wikilinks** across the graph — do not rely solely on keyword search. The wiki's value is in traversal.
3. **Synthesize an answer** that cites specific pages inline using `[[target]]` wikilinks. Every non-trivial claim should cite a page.
4. If the wiki doesn't have enough information, say so plainly. Do **not** invent facts or reach for your pretraining knowledge — the user is asking what *this wiki* says.

You have **read-only** access during queries. Do not write files.

## Lint workflow (when invoked to audit the vault)

Your job is to find and (if `--fix` is enabled) repair:

- **Broken wikilinks**: targets that don't resolve to an existing page.
- **Orphaned pages**: pages nothing links to (excluding `index.md`).
- **Duplicate pages**: two pages covering the same entity under different slugs.
- **Missing frontmatter fields**: required fields absent for the page's declared type.
- **Contradictions**: factual claims that disagree across pages.
- **Stale claims**: frontmatter dates older than any source update.

Report findings as a bulleted list grouped by category. With `--fix`, repair only the mechanical issues (broken links, missing frontmatter) — never rewrite prose to resolve contradictions without explicit user direction.

## Style rules

- **Dense, direct prose.** No filler, no hedging preambles, no marketing language.
- **Cite with wikilinks**, not footnotes or URLs (unless the source is a URL).
- **Prefer updating over creating.** A sprawling graph of near-duplicate pages is the failure mode this tool exists to prevent.
- **Keep frontmatter minimal.** Only the fields listed above. Don't invent new frontmatter keys without the user editing this schema first.
