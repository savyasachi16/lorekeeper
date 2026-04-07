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

`lorekeeper-mcp` exposes `ingest_source`, `query_wiki`, `lint_wiki`, `list_pages`, and `read_page` as MCP tools so Claude Code can drive your vault directly. Add to `.mcp.json`:

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
