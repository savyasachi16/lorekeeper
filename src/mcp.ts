#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { promises as fs } from 'node:fs';
import { openVault, listPages, resolveInVault, type Vault } from './core/vault.js';
import { ingestSource } from './ops/ingest.js';
import { queryVault } from './ops/query.js';
import { lintVault } from './ops/lint.js';
import { pullPapers } from './ops/pull.js';

/**
 * MCP server exposing lorekeeper ops. The vault path is fixed at startup via
 * `--vault <dir>` — a single server instance targets a single vault, which
 * keeps the tool surface simple and avoids cross-vault confusion.
 */

function parseArgs(argv: string[]): { vault: string } {
  const idx = argv.indexOf('--vault');
  if (idx === -1 || idx === argv.length - 1) {
    console.error('Usage: lorekeeper-mcp --vault <dir>');
    process.exit(1);
  }
  return { vault: argv[idx + 1]! };
}

function textResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
  };
}

async function main(): Promise<void> {
  const { vault: vaultArg } = parseArgs(process.argv.slice(2));
  let vault: Vault;
  try {
    vault = await openVault(vaultArg);
  } catch (err) {
    console.error(`Failed to open vault: ${(err as Error).message}`);
    process.exit(1);
  }

  const server = new McpServer({
    name: 'lorekeeper',
    version: '0.1.0',
  });

  server.registerTool(
    'ingest_source',
    {
      description:
        'Ingest a source document (PDF, md, or txt) into the lorekeeper vault. The source is copied into sources/ and the LLM then updates wiki pages per the vault schema. Returns a summary of created and updated pages.',
      inputSchema: {
        source_path: z.string().describe('Absolute path to the source file to ingest'),
      },
    },
    async ({ source_path }) => {
      const result = await ingestSource({ vault, sourcePath: source_path });
      return textResult(
        `${result.ok ? 'OK' : 'FAILED'} (${result.turns} turns)\n\n${result.text}`,
      );
    },
  );

  server.registerTool(
    'query_wiki',
    {
      description:
        'Ask a natural-language question against the lorekeeper vault. The LLM traverses the wiki graph and returns a synthesis with inline [[wikilink]] citations.',
      inputSchema: {
        question: z.string().describe('The question to ask the wiki'),
      },
    },
    async ({ question }) => {
      const result = await queryVault({ vault, question });
      return textResult(result.text);
    },
  );

  server.registerTool(
    'lint_wiki',
    {
      description:
        'Audit the vault for drift: broken wikilinks, orphaned pages, duplicates, missing frontmatter, contradictions, stale claims. With fix=true, repairs mechanical issues only.',
      inputSchema: {
        fix: z.boolean().optional().describe('If true, repair mechanical issues in place'),
      },
    },
    async ({ fix }) => {
      const result = await lintVault({ vault, fix });
      return textResult(result.text);
    },
  );

  server.registerTool(
    'list_pages',
    {
      description: 'List all markdown pages in the vault as vault-relative paths.',
      inputSchema: {},
    },
    async () => {
      const pages = await listPages(vault);
      return textResult(pages.length === 0 ? '(vault has no pages)' : pages.join('\n'));
    },
  );

  server.registerTool(
    'pull_papers',
    {
      description:
        'Search arXiv (and optionally Sci-Hub) for papers matching a query and auto-ingest the top N most relevant ones into the vault. Each paper goes through the full ingest pipeline. Returns a tally of ingested vs skipped.',
      inputSchema: {
        query: z.string().describe('Search query, e.g. "transformer attention mechanisms"'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Number of papers to ingest (default 20, max 100)'),
        use_scihub: z
          .boolean()
          .optional()
          .describe(
            'Enable Sci-Hub fallback for non-arXiv DOIs. Default false. User-facing legal caveat applies.',
          ),
        no_filter: z
          .boolean()
          .optional()
          .describe('Skip the LLM relevance filter and use arXiv ranking directly'),
      },
    },
    async ({ query, limit, use_scihub, no_filter }) => {
      const result = await pullPapers({
        vault,
        query,
        limit: limit ?? 20,
        useScihub: use_scihub,
        noFilter: no_filter,
      });
      const lines = [
        `pull complete: ${result.ingested}/${result.requested} ingested, ${result.fetched} downloaded, ${result.skipped.length} skipped`,
      ];
      if (result.skipped.length > 0) {
        lines.push('', 'Skipped:');
        for (const s of result.skipped) lines.push(`  - ${s.title}: ${s.reason}`);
      }
      return textResult(lines.join('\n'));
    },
  );

  server.registerTool(
    'read_page',
    {
      description: 'Read the markdown contents of a page by its vault-relative path.',
      inputSchema: {
        page: z.string().describe('Vault-relative path, e.g. "papers/attention-is-all-you-need.md"'),
      },
    },
    async ({ page }) => {
      try {
        const abs = resolveInVault(vault, page);
        const contents = await fs.readFile(abs, 'utf8');
        return textResult(contents);
      } catch (err) {
        return textResult(`ERROR: ${(err as Error).message}`);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log startup on stderr so it doesn't pollute the MCP stdio stream.
  console.error(`lorekeeper-mcp connected — vault: ${vault.root}`);
}

main().catch((err) => {
  console.error(`lorekeeper-mcp fatal: ${(err as Error).message}`);
  process.exit(1);
});
