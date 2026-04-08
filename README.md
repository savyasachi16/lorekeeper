# lorekeeper

Build and maintain a persistent, LLM-curated wiki from your sources.

A concrete implementation of [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Instead of re-deriving knowledge via RAG on every query, an LLM incrementally builds and maintains an Obsidian-compatible markdown wiki that compounds as you feed it more sources.

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

`--use-scihub` is **off by default and must be passed explicitly per invocation**. Sci-Hub's legality varies by jurisdiction and accessing it may infringe copyright in your country. `lorekeeper` prints a stderr warning the first time it touches Sci-Hub during a run. You are responsible for ensuring your usage is lawful where you live and for the institutions whose materials you access. The default arXiv-only path is unaffected — arXiv is open access.

The mirror list defaults to `sci-hub.se`, `sci-hub.ru`, `sci-hub.st`. Override with `LOREKEEPER_SCIHUB_MIRRORS` (comma-separated).

## How it works

`ingest`, `query`, `lint`, and `pull` each spawn a [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk) session with a system prompt built from the vault's `CLAUDE.md` schema and file tools scoped to the vault directory. Write ops (`ingest`, `lint --fix`) get read+write tools; read ops get read-only. The agent decides which pages to touch — `lorekeeper` enforces the sandbox and streams progress.

## Vault layout

```
my-vault/
├── CLAUDE.md              schema + workflow (user-editable)
├── .lorekeeper/
│   └── config.json
├── sources/               raw inputs, immutable after copy
├── papers/                one page per paper
├── concepts/              cross-cutting ideas
├── authors/               researchers
├── methods/               techniques
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

## Development

```bash
git clone https://github.com/savyasachi16/lorekeeper.git
cd lorekeeper
npm install
npm test          # vitest, 80 tests
npm run typecheck
npm run build
```

## License

[MIT](LICENSE)
