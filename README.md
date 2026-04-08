# lorekeeper

Build and maintain a persistent, LLM-curated wiki from your sources.

A concrete implementation of [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f): instead of re-deriving knowledge from scratch via RAG on every query, `lorekeeper` has an LLM incrementally build and maintain an Obsidian-compatible markdown wiki that compounds as you feed it more sources.

> **Status:** early work in progress. v1 targets research papers.

## What it does

```
sources/         # your raw PDFs, articles, notes
    ↓  lorekeeper ingest
wiki/            # interlinked markdown pages — papers, concepts, authors, methods
    ↓  lorekeeper query "..."
cited synthesis answers
```

Each ingest reads the source, reads existing wiki pages, and updates or creates pages with cross-references. The wiki itself is just markdown — browse it in [Obsidian](https://obsidian.md), edit it by hand, commit it to git.

## Quick start

```bash
npm install -g lorekeeper

lorekeeper init my-vault
lorekeeper ingest ~/Downloads/attention-is-all-you-need.pdf --vault my-vault
lorekeeper query "what is multi-head attention?" --vault my-vault
lorekeeper lint --vault my-vault
```

## Pulling papers from arXiv

Skip the manual download step entirely. `lorekeeper pull` searches arXiv, asks Claude to pick the most relevant results, downloads the PDFs, and runs the full ingest pipeline on each one:

```bash
lorekeeper pull "transformer attention mechanisms" --limit 20 --vault my-vault
lorekeeper pull "diffusion model sampling" --limit 5 --no-filter --vault my-vault
```

Flags:

- `--limit N` — number of papers to ingest (default 20)
- `--no-filter` — skip the LLM relevance filter and use arXiv's ranking directly
- `--use-scihub` — enable Sci-Hub fallback for non-arXiv DOIs (off by default; see legal note below)
- `--model <name>` — Claude model override

Per-paper failures (broken download, ingest error) are recorded in the final report and don't halt the batch.

### Sci-Hub fallback (legal note)

`--use-scihub` is **off by default and must be passed explicitly per invocation**. Sci-Hub's legality varies by jurisdiction; in many countries accessing it may infringe copyright. `lorekeeper` will print a stderr warning the first time it touches Sci-Hub during a run. You are responsible for ensuring your usage is lawful where you live and for the institutions whose materials you access. The default arXiv-only path is unaffected — arXiv is open access.

The mirror list defaults to `sci-hub.se`, `sci-hub.ru`, `sci-hub.st` and can be overridden via the `LOREKEEPER_SCIHUB_MIRRORS` env var (comma-separated).

## How it works

- **Core operations** (`ingest`, `query`, `lint`) each spawn a [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk) session with a system prompt built from the vault's `CLAUDE.md` schema and file tools scoped to the vault directory.
- **Write ops** (`ingest`, `lint --fix`) get read+write tools; **read ops** (`query`, `lint`) get read-only tools.
- The agent decides which pages to touch. `lorekeeper` enforces the sandbox and streams progress.

## Vault layout

```
my-vault/
├── CLAUDE.md              # schema + workflow (user-editable)
├── .lorekeeper/
│   └── config.json
├── sources/               # raw inputs, immutable after copy
├── papers/                # one page per paper
├── concepts/              # cross-cutting ideas
├── authors/               # researchers
├── methods/               # techniques
└── index.md
```

## MCP server

`lorekeeper-mcp` exposes `ingest_source`, `query_wiki`, `lint_wiki`, `pull_papers`, `list_pages`, and `read_page` as MCP tools so Claude Code can drive your vault directly. Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "lorekeeper": {
      "command": "lorekeeper-mcp",
      "args": ["--vault", "/path/to/my-vault"]
    }
  }
}
```

## License

MIT
