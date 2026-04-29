# Lorekeeper Instructions

## Project Overview
TypeScript implementation of the "LLM Wiki" pattern. Builds persistent, LLM-curated knowledge bases from research papers and sources.

## Critical Paths
- `src/`: Core logic and CLI.
- `bin/`: Executable entry points (`lorekeeper`, `lorekeeper-mcp`).
- `test/`: Vitest suite.
- `templates/`: Default vault structures/prompts.

## Commands
- **Build:** `npm run build` (TSC)
- **Dev:** `npm run dev` (Runs CLI via tsx)
- **Test:** `npm run test` (Vitest run once)
- **Test Watch:** `npm run test:watch`
- **Lint/Types:** `npm run typecheck`

## Engineering Standards
- **Runtime:** Node.js >= 20.
- **Patterns:** Prefer functional composition over deep inheritance for LLM pipeline stages.
- **MCP:** Adheres to the Model Context Protocol for tool exposure.
- **Vaults:** Knowledge is stored in markdown with YAML frontmatter; ensure any modification maintains schema integrity.

## Directory Layout
- `src/cli.ts`: Main entry point for the tool.
- `src/mcp/`: Server implementation for MCP clients.
- `src/parsers/`: Extraction logic (PDF, XML, etc.).
- `src/prompts/`: System instructions for LLM-curated updates.