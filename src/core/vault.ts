import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * A vault is a directory containing a `.lorekeeper/` folder. All file operations
 * performed by agent sessions must go through helpers here so paths are verified
 * to stay inside the vault root — this is the security boundary.
 */

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

export class PathEscapeError extends VaultError {
  constructor(attempted: string, vaultRoot: string) {
    super(`Path escapes vault: ${attempted} (vault root: ${vaultRoot})`);
    this.name = 'PathEscapeError';
  }
}

export interface Vault {
  readonly root: string;
}

/**
 * Walk up from `startDir` looking for a directory containing `.lorekeeper/`.
 * Returns the vault root, or null if none found before hitting the filesystem root.
 */
export async function findVault(startDir: string): Promise<Vault | null> {
  let current = path.resolve(startDir);
  while (true) {
    const marker = path.join(current, '.lorekeeper');
    try {
      const stat = await fs.stat(marker);
      if (stat.isDirectory()) {
        return { root: current };
      }
    } catch {
      // not here, keep walking
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Load a vault at an explicit path. Throws if `.lorekeeper/` is missing. */
export async function openVault(root: string): Promise<Vault> {
  const resolved = path.resolve(root);
  const marker = path.join(resolved, '.lorekeeper');
  try {
    const stat = await fs.stat(marker);
    if (!stat.isDirectory()) {
      throw new VaultError(`Not a vault: ${resolved} (.lorekeeper is not a directory)`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new VaultError(`Not a vault: ${resolved} (missing .lorekeeper/)`);
    }
    throw err;
  }
  return { root: resolved };
}

/**
 * Resolve a user-supplied path against the vault root and assert it stays inside.
 * Rejects absolute paths, `..` traversal, and symlink escapes at the string level.
 * Callers that also need to defeat symlink races should `fs.realpath` the result
 * and re-check containment.
 */
export function resolveInVault(vault: Vault, relative: string): string {
  if (path.isAbsolute(relative)) {
    throw new PathEscapeError(relative, vault.root);
  }
  const resolved = path.resolve(vault.root, relative);
  const rootWithSep = vault.root.endsWith(path.sep) ? vault.root : vault.root + path.sep;
  if (resolved !== vault.root && !resolved.startsWith(rootWithSep)) {
    throw new PathEscapeError(relative, vault.root);
  }
  return resolved;
}

export async function readFileInVault(vault: Vault, relative: string): Promise<string> {
  const abs = resolveInVault(vault, relative);
  return fs.readFile(abs, 'utf8');
}

export async function writeFileInVault(
  vault: Vault,
  relative: string,
  contents: string,
): Promise<void> {
  const abs = resolveInVault(vault, relative);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents, 'utf8');
}

export async function fileExistsInVault(vault: Vault, relative: string): Promise<boolean> {
  try {
    const abs = resolveInVault(vault, relative);
    await fs.stat(abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively list all `.md` pages under the vault, returned as vault-relative
 * POSIX paths. Excludes `sources/` (raw inputs, not wiki pages), `.lorekeeper/`,
 * and `node_modules/`.
 */
export async function listPages(vault: Vault): Promise<string[]> {
  const skip = new Set(['sources', '.lorekeeper', 'node_modules', '.git']);
  const results: string[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        await walk(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(prefix ? `${prefix}/${entry.name}` : entry.name);
      }
    }
  }

  await walk(vault.root, '');
  return results.sort();
}
