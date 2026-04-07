#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'node:path';
import { findVault, openVault, listPages, type Vault } from './core/vault.js';
import { initVault } from './ops/init.js';
import { ingestSource } from './ops/ingest.js';
import { queryVault } from './ops/query.js';
import { lintVault } from './ops/lint.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Resolve the vault the user is targeting: explicit --vault flag wins,
 * otherwise walk up from cwd looking for `.lorekeeper/`.
 */
async function resolveVault(explicit: string | undefined): Promise<Vault> {
  if (explicit) {
    return openVault(explicit);
  }
  const found = await findVault(process.cwd());
  if (!found) {
    throw new Error(
      `No vault found at or above ${process.cwd()}. Pass --vault <dir> or run 'lorekeeper init' first.`,
    );
  }
  return found;
}

/**
 * Build a message handler that streams progress (tool uses, text) to the
 * console via an ora spinner. Each tool call ticks the spinner with the
 * tool name so users see the agent working.
 */
function makeProgressHandler(spinner: ReturnType<typeof ora>): (msg: SDKMessage) => void {
  let toolCalls = 0;
  return (msg) => {
    if (msg.type === 'assistant') {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use') {
          toolCalls++;
          spinner.text = `working… (${toolCalls} tool call${toolCalls === 1 ? '' : 's'}, last: ${block.name})`;
        }
      }
    }
  };
}

function printResult(label: string, result: { ok: boolean; text: string; turns: number; costUsd?: number }): void {
  if (result.ok) {
    console.log(chalk.green(`\n✓ ${label} complete`));
  } else {
    console.log(chalk.red(`\n✗ ${label} failed`));
  }
  console.log(chalk.dim(`  ${result.turns} turn${result.turns === 1 ? '' : 's'}${
    result.costUsd !== undefined ? `, $${result.costUsd.toFixed(4)}` : ''
  }\n`));
  console.log(result.text);
}

const program = new Command();

program
  .name('lorekeeper')
  .description('Build and maintain a persistent, LLM-curated wiki from your sources.')
  .version('0.1.0');

program
  .command('init <dir>')
  .description('Scaffold a new vault')
  .option('-t, --template <name>', 'template to use', 'research-papers')
  .option('-f, --force', 'initialize even if the target directory is non-empty')
  .action(async (dir: string, opts: { template: string; force?: boolean }) => {
    try {
      const result = await initVault({ dir, template: opts.template, force: opts.force });
      console.log(chalk.green(`✓ Initialized ${result.template} vault at ${result.vaultRoot}`));
      console.log(chalk.dim(`  Created ${result.createdFiles.length} files`));
      console.log(`\nNext: ${chalk.cyan(`cd ${path.relative(process.cwd(), result.vaultRoot) || '.'} && lorekeeper ingest <path>`)}`);
    } catch (err) {
      console.error(chalk.red(`✗ init failed: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program
  .command('ingest <source>')
  .description('Ingest a source (PDF, md, txt) into the vault')
  .option('-v, --vault <dir>', 'vault directory (defaults to nearest .lorekeeper/ ancestor)')
  .option('-m, --model <name>', 'Claude model override')
  .action(async (source: string, opts: { vault?: string; model?: string }) => {
    try {
      const vault = await resolveVault(opts.vault);
      const spinner = ora(`ingesting ${path.basename(source)}…`).start();
      const result = await ingestSource({
        vault,
        sourcePath: source,
        model: opts.model,
        onMessage: makeProgressHandler(spinner),
      });
      spinner.stop();
      console.log(chalk.dim(`  source stored at ${result.sourceInVault}${result.wasNew ? '' : ' (already present, re-ingested)'}`));
      printResult('ingest', result);
      if (!result.ok) process.exit(1);
    } catch (err) {
      console.error(chalk.red(`✗ ingest failed: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program
  .command('query <question>')
  .description('Ask a question; get a cited synthesis from the wiki')
  .option('-v, --vault <dir>', 'vault directory (defaults to nearest .lorekeeper/ ancestor)')
  .option('-m, --model <name>', 'Claude model override')
  .action(async (question: string, opts: { vault?: string; model?: string }) => {
    try {
      const vault = await resolveVault(opts.vault);
      const spinner = ora('querying vault…').start();
      const result = await queryVault({
        vault,
        question,
        model: opts.model,
        onMessage: makeProgressHandler(spinner),
      });
      spinner.stop();
      printResult('query', result);
      if (!result.ok) process.exit(1);
    } catch (err) {
      console.error(chalk.red(`✗ query failed: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program
  .command('lint')
  .description('Audit the vault for drift (broken links, duplicates, contradictions)')
  .option('-v, --vault <dir>', 'vault directory (defaults to nearest .lorekeeper/ ancestor)')
  .option('-f, --fix', 'repair mechanical issues (broken links, missing frontmatter)')
  .option('-m, --model <name>', 'Claude model override')
  .action(async (opts: { vault?: string; fix?: boolean; model?: string }) => {
    try {
      const vault = await resolveVault(opts.vault);
      const spinner = ora(opts.fix ? 'linting vault (fix mode)…' : 'linting vault…').start();
      const result = await lintVault({
        vault,
        fix: opts.fix,
        model: opts.model,
        onMessage: makeProgressHandler(spinner),
      });
      spinner.stop();
      printResult('lint', result);
      if (!result.ok) process.exit(1);
    } catch (err) {
      console.error(chalk.red(`✗ lint failed: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all pages in the vault')
  .option('-v, --vault <dir>', 'vault directory (defaults to nearest .lorekeeper/ ancestor)')
  .action(async (opts: { vault?: string }) => {
    try {
      const vault = await resolveVault(opts.vault);
      const pages = await listPages(vault);
      if (pages.length === 0) {
        console.log(chalk.dim('(vault has no pages yet — try `lorekeeper ingest <source>`)'));
        return;
      }
      for (const p of pages) console.log(p);
    } catch (err) {
      console.error(chalk.red(`✗ list failed: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(`✗ ${(err as Error).message}`));
  process.exit(1);
});
