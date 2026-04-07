import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfig, saveConfig } from '../core/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Path to the bundled templates directory. At dev time this resolves relative
 * to src/ops/; at runtime after `tsc` it resolves relative to dist/ops/. The
 * templates/ dir is shipped alongside dist/ via `files` in package.json.
 */
function templatesDir(): string {
  // From dist/ops/init.js → ../../templates, same for src/ops/init.ts.
  return path.resolve(__dirname, '..', '..', 'templates');
}

export interface InitOptions {
  /** Destination directory for the new vault. Created if missing. */
  dir: string;
  /** Template name, e.g. "research-papers". */
  template?: string;
  /** If true, initialize even if the directory is non-empty (but never overwrite existing files). */
  force?: boolean;
}

export interface InitResult {
  vaultRoot: string;
  template: string;
  createdFiles: string[];
}

async function copyDirRecursive(src: string, dest: string): Promise<string[]> {
  const created: string[] = [];
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      created.push(...(await copyDirRecursive(s, d)));
    } else if (entry.isFile()) {
      // Never overwrite an existing file.
      try {
        await fs.stat(d);
        continue;
      } catch {
        // doesn't exist, copy it
      }
      await fs.copyFile(s, d);
      created.push(d);
    }
  }
  return created;
}

export async function initVault(opts: InitOptions): Promise<InitResult> {
  const template = opts.template ?? 'research-papers';
  const templateSrc = path.join(templatesDir(), template);

  try {
    const stat = await fs.stat(templateSrc);
    if (!stat.isDirectory()) {
      throw new Error(`Template "${template}" is not a directory`);
    }
  } catch {
    throw new Error(`Unknown template: "${template}" (looked in ${templateSrc})`);
  }

  const vaultRoot = path.resolve(opts.dir);
  await fs.mkdir(vaultRoot, { recursive: true });

  if (!opts.force) {
    const existing = await fs.readdir(vaultRoot);
    const nonHidden = existing.filter((e) => !e.startsWith('.'));
    if (nonHidden.length > 0) {
      throw new Error(
        `Target directory is not empty: ${vaultRoot}\nPass --force to initialize anyway (existing files will not be overwritten).`,
      );
    }
  }

  // Copy template files (CLAUDE.md, index.md) into vault root.
  const createdFiles = await copyDirRecursive(templateSrc, vaultRoot);

  // Create standard subdirs so the agent has somewhere to write on first ingest.
  for (const sub of ['sources', 'papers', 'concepts', 'authors', 'methods']) {
    await fs.mkdir(path.join(vaultRoot, sub), { recursive: true });
    // Add a .gitkeep so empty dirs survive in git.
    const keep = path.join(vaultRoot, sub, '.gitkeep');
    try {
      await fs.stat(keep);
    } catch {
      await fs.writeFile(keep, '');
      createdFiles.push(keep);
    }
  }

  // Write initial .lorekeeper/config.json.
  const configDir = path.join(vaultRoot, '.lorekeeper');
  await fs.mkdir(configDir, { recursive: true });
  const vault = { root: vaultRoot };
  await saveConfig(vault, defaultConfig(template));
  createdFiles.push(path.join(configDir, 'config.json'));

  return { vaultRoot, template, createdFiles };
}
