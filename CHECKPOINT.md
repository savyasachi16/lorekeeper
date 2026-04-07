# lorekeeper — implementation checkpoint

> Use this to resume work after a conversation compaction. Read this file FIRST,
> then read the plan, then read the most recently touched source files.

## Where things live

| Thing                  | Path                                                                  |
|------------------------|-----------------------------------------------------------------------|
| Repo                   | `/Users/savya/projects/lorekeeper/` (git repo, branch `main`)         |
| Plan (full v1 + v2)    | `/Users/savya/.claude/plans/rustling-wobbling-elephant.md`            |
| Source gist context    | https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f     |

## What's shipped (v1) — DO NOT REDO

v1 is committed (9 commits, 32 tests passing, typecheck clean, `init` smoke-tested).
See `git log --oneline` for the trail. v1 surface:

- **CLI**: `init`, `ingest`, `query`, `lint`, `list` (`src/cli.ts`)
- **MCP server**: `ingest_source`, `query_wiki`, `lint_wiki`, `list_pages`, `read_page` (`src/mcp.ts`)
- **Core primitives**: `src/core/{vault,frontmatter,wikilinks,pdf,config,schema}.ts`
- **Agent plumbing**: `src/agent/{session,prompts}.ts` — wraps `@anthropic-ai/claude-agent-sdk`. NOTE: lorekeeper does NOT define custom file tools; it relies on Claude Code's built-in `Read`/`Write`/`Edit`/`Glob`/`Grep` scoped via `cwd: vault.root`. `tools.ts` was deliberately dropped from the original plan.
- **Ops**: `src/ops/{init,ingest,query,lint}.ts`
- **Template**: `templates/research-papers/{CLAUDE.md,index.md}` — the schema contract is the most load-bearing prompt in the system.

## v2 status — IN PROGRESS

Goal: `lorekeeper pull "<query>" --limit N` — search arXiv, optionally filter with the LLM, download PDFs, ingest each. Sci-Hub fallback for non-arXiv DOIs (opt-in via `--use-scihub`).

### Locked decisions (do not re-ask)

| Decision        | Choice                                                 |
|-----------------|--------------------------------------------------------|
| Search          | arXiv primary + Sci-Hub fallback                       |
| Selection UX    | Auto-ingest top N (no interactive picker)              |
| LLM filter      | Yes — rank candidates with Claude before downloading   |
| Sci-Hub default | OFF — must pass `--use-scihub` per invocation          |

### v2 file status

| File                          | Status         | Notes                                                      |
|-------------------------------|----------------|------------------------------------------------------------|
| `package.json`                | EDITED         | `fast-xml-parser ^5.5.10` added                            |
| `src/fetch/types.ts`          | DONE           | `PaperCandidate`, `PullEvent` interfaces                   |
| `src/fetch/arxiv.ts`          | DONE           | `parseArxivFeed`, `searchArxiv`, `downloadArxivPdf`, `candidateFilename` |
| `test/arxiv.test.ts`          | NOT STARTED    | **next up** — fixture Atom XML → assert parser output     |
| `src/fetch/scihub.ts`         | NOT STARTED    | Mirror list + `<embed>`/`<iframe>` scraper                 |
| `test/scihub.test.ts`         | NOT STARTED    | Fixture HTML → URL extraction                              |
| `src/fetch/filter.ts`         | NOT STARTED    | One-shot SDK `query()` with `outputFormat: json_schema`    |
| `test/filter.test.ts`         | NOT STARTED    | Mock SDK, verify rank parse + fallback                     |
| `src/ops/pull.ts`             | NOT STARTED    | Orchestrator: search → filter → download → ingest          |
| `src/cli.ts`                  | NEEDS EDIT     | Register `pull` subcommand                                 |
| `src/mcp.ts`                  | NEEDS EDIT     | Register `pull_papers` tool                                |
| `test/pull.e2e.test.ts`       | NOT STARTED    | Mock arxiv + ingest, drive full pipeline                   |
| `README.md`                   | NEEDS EDIT     | Document `pull` + Sci-Hub legal note                       |

### Next action when resuming

1. `cd /Users/savya/projects/lorekeeper` (CWD does NOT auto-persist between bash calls — use absolute paths or `git -C`)
2. Mark task #10 in_progress (still owns "Build arXiv search module")
3. Write `test/arxiv.test.ts` — see `src/fetch/arxiv.ts` for the export surface (`parseArxivFeed`, `candidateFilename`). Test fixture should be a small inline Atom XML string with 1–2 entries covering: title with newlines, multiple authors, pdf `<link>`, optional `arxiv:doi`, version-suffixed `id` URL.
4. `npm test` should report 33+ passing
5. `npm run typecheck` should be clean
6. Commit phase 1: `feat(fetch): add arXiv search and PDF download`
7. Mark task #10 complete, task #11 in_progress, proceed to Sci-Hub.

### Open tasks (for TaskList)

- #10 in_progress — Build arXiv search module (code done, test pending)
- #11 pending — Build Sci-Hub fallback
- #12 pending — Build LLM relevance filter
- #13 pending — Wire pull op + CLI
- #14 pending — Add pull MCP tool + README

## Important conventions / gotchas (carry forward)

- **Branch is `main`**, never `master` — global rule from user CLAUDE.md
- **Commit at every checkpoint** — user explicitly requested this
- **Co-author every commit**: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
- **Skill rule**: don't spawn subagents unless the user asks. Plan-mode workflow says "default to ≥1 Plan agent" but this conflicts with the main-prompt rule; main rule wins. Continue writing plans inline.
- **Plan-mode hard rule**: only the plan file may be edited in plan mode. All other tools must be read-only.
- **bash CWD is not sticky** between calls. Use `git -C /Users/savya/projects/lorekeeper ...` for git, absolute paths for everything else, OR `cd /path && cmd` chained in one call.
- **The Agent SDK is a Claude Code subprocess wrapper**. Don't define custom file tools — set `cwd: vault.root`, `tools: ['Read','Write','Edit','Glob','Grep']` (or read-only subset), `permissionMode: 'bypassPermissions'`, `allowDangerouslySkipPermissions: true`, `settingSources: []`, `persistSession: false`.
- **The vault's CLAUDE.md is the schema contract** — read it via `loadVaultSchema()` and append to systemPrompt with `composeSystemPrompt()`.
- **`runAgent` from `src/agent/session.ts`** is the only way ingest/query/lint should talk to Claude. Pull's filter step should also use the SDK directly via `query()` (one-shot, no tools, JSON output schema) — see plan for details.
- **PDF generation in tests**: there's a hand-rolled minimal PDF builder in `test/pdf.test.ts` and `test/ingest.e2e.test.ts`. Reuse the helper if a future test needs a fixture PDF.
- **Path-escape guard** lives in `src/core/vault.ts` (`resolveInVault`) — security boundary. Anything writing into the vault from a new module should go through it.
- **Conciseness rules** from user CLAUDE.md: direct, technical, no openers/closers/praise/filler, end every response with a confidence score on its own line.

## Verification commands (cheat sheet)

```bash
cd /Users/savya/projects/lorekeeper
npm test                    # vitest run, should be 32 passing pre-v2
npm run typecheck           # tsc --noEmit, must be clean
npm run build               # tsc, emits dist/
git log --oneline           # commit trail
git status                  # check uncommitted state
```

## Resume snippet to paste back to Claude

> Resume lorekeeper v2 work. Read `/Users/savya/projects/lorekeeper/CHECKPOINT.md` first, then continue from the "Next action when resuming" section. Plan file at `/Users/savya/.claude/plans/rustling-wobbling-elephant.md`.
