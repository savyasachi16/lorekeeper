# lorekeeper

Build and maintain a persistent, LLM-curated wiki from your sources.

A concrete implementation of [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Instead of re-deriving knowledge via RAG on every query, an LLM incrementally builds and maintains an Obsidian-compatible markdown wiki that compounds as you feed it more sources.

> **See it in action:** browse [`examples/lorekeeper-demo-vault/`](examples/lorekeeper-demo-vault) for a real wiki built from arXiv papers on agent memory architectures.

## What it does

```
sources/         raw PDFs, articles, notes
    ↓  lorekeeper ingest
wiki/            interlinked markdown — papers, concepts, authors, methods
    ↓  lorekeeper query "..."
cited synthesis answers
```

Each ingest reads the source, reads existing wiki pages, and updates or creates pages with cross-references. The wiki is plain markdown — browse it in [Obsidian](https://obsidian.md), edit it by hand, commit it to git.

## Install

```bash
npm install -g lorekeeper
```

## Quick start

```bash
lorekeeper init my-vault
cd my-vault
lorekeeper ingest ~/Downloads/attention-is-all-you-need.pdf
lorekeeper query "what is multi-head attention?"
lorekeeper lint
```

`--vault <dir>` works from anywhere; otherwise commands walk up from `cwd` looking for the nearest `.lorekeeper/`.

## Where your vault lives

A lorekeeper vault is just a directory of markdown files. `lorekeeper init <dir>` creates it at exactly the path you pass — there is no default location, no global registry, and no hidden state outside the vault directory itself.

| Path                      | Contents                                                |
|---------------------------|---------------------------------------------------------|
| `CLAUDE.md`               | Schema contract — edit to change how the agent writes   |
| `.lorekeeper/config.json` | Ingest history (which sources, when)                    |
| `sources/`                | Raw PDFs, immutable after copy                          |
| `papers/` `concepts/` `authors/` `methods/` | One markdown page per item           |
| `index.md`                | Top-level table of contents                             |

**Open it in Obsidian:** point "Open folder as vault" at the directory. No plugins required. Wikilinks, frontmatter, and graph view all work natively.

**Back it up / share it:** `git init` inside the vault, push to a private repo. The wiki history becomes a real artifact you can diff, blame, and roll back.

## Commands

| Command                          | Purpose                                            |
|----------------------------------|----------------------------------------------------|
| `lorekeeper init <dir>`          | Scaffold a new vault                               |
| `lorekeeper ingest <source>`     | Ingest a PDF / md / txt into the vault             |
| `lorekeeper pull <query>`        | Search arXiv and auto-ingest the top N results     |
| `lorekeeper query <question>`    | Cited synthesis from the wiki                      |
| `lorekeeper lint [--fix]`        | Audit for drift (broken links, duplicates, etc.)   |
| `lorekeeper list`                | List all pages in the vault                        |

## Pulling papers

`lorekeeper pull` searches arXiv, asks Claude to pick the most relevant results, downloads the PDFs, and runs the full ingest pipeline on each one:

```bash
lorekeeper pull "transformer attention mechanisms" --limit 20
lorekeeper pull "diffusion model sampling" --limit 5 --no-filter
```

| Flag             | Default | Purpose                                                |
|------------------|---------|--------------------------------------------------------|
| `--limit N`      | 20      | Number of papers to ingest                             |
| `--no-filter`    | off     | Skip the LLM relevance filter; use arXiv ranking       |
| `--use-scihub`   | off     | Sci-Hub fallback for non-arXiv DOIs (see note below)   |
| `--model <name>` | —       | Claude model override                                  |

Per-paper failures are recorded in the final report and don't halt the batch.

### Sci-Hub fallback

`--use-scihub` is **off by default and must be passed explicitly per invocation**. Sci-Hub's legality varies by jurisdiction and accessing it may infringe copyright in your country. `lorekeeper` prints a stderr warning the first time it touches Sci-Hub during a run. You are responsible for ensuring your usage is lawful. The default arXiv-only path is unaffected — arXiv is open access.

The mirror list defaults to `sci-hub.se`, `sci-hub.ru`, `sci-hub.st`. Override with `LOREKEEPER_SCIHUB_MIRRORS` (comma-separated).

## How it works

Each op spawns a [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk) session with file tools scoped to the vault directory and a system prompt built from the vault's `CLAUDE.md` schema. The agent decides which pages to create or update — `lorekeeper` enforces the sandbox and streams progress.

## MCP server

`lorekeeper-mcp` exposes `ingest_source`, `query_wiki`, `lint_wiki`, `pull_papers`, `list_pages`, and `read_page` as MCP tools so Claude Code can drive your vault directly:

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

## Development

```bash
git clone --recursive https://github.com/savyasachi16/lorekeeper.git
cd lorekeeper
npm install
npm test          # vitest, 84 tests
npm run typecheck
npm run build
```

## License

[MIT](LICENSE)
