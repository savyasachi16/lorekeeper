import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  findVault,
  openVault,
  resolveInVault,
  readFileInVault,
  writeFileInVault,
  listPages,
  PathEscapeError,
  VaultError,
} from '../src/core/vault.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lorekeeper-vault-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function makeVault(): Promise<string> {
  const vaultDir = path.join(tmpRoot, 'my-vault');
  await fs.mkdir(path.join(vaultDir, '.lorekeeper'), { recursive: true });
  return vaultDir;
}

describe('openVault', () => {
  it('opens an existing vault', async () => {
    const dir = await makeVault();
    const v = await openVault(dir);
    expect(v.root).toBe(path.resolve(dir));
  });

  it('throws when .lorekeeper is missing', async () => {
    await expect(openVault(tmpRoot)).rejects.toThrow(VaultError);
  });
});

describe('findVault', () => {
  it('finds vault from a nested subdir', async () => {
    const vaultDir = await makeVault();
    const nested = path.join(vaultDir, 'papers', 'sub');
    await fs.mkdir(nested, { recursive: true });
    const found = await findVault(nested);
    expect(found?.root).toBe(path.resolve(vaultDir));
  });

  it('returns null when no vault exists above', async () => {
    const found = await findVault(tmpRoot);
    expect(found).toBeNull();
  });
});

describe('resolveInVault (security boundary)', () => {
  it('resolves a simple relative path', async () => {
    const v = await openVault(await makeVault());
    const resolved = resolveInVault(v, 'papers/foo.md');
    expect(resolved).toBe(path.join(v.root, 'papers', 'foo.md'));
  });

  it('rejects absolute paths', async () => {
    const v = await openVault(await makeVault());
    expect(() => resolveInVault(v, '/etc/passwd')).toThrow(PathEscapeError);
  });

  it('rejects .. traversal that escapes the root', async () => {
    const v = await openVault(await makeVault());
    expect(() => resolveInVault(v, '../outside.md')).toThrow(PathEscapeError);
    expect(() => resolveInVault(v, 'papers/../../outside.md')).toThrow(PathEscapeError);
  });

  it('allows .. traversal that stays inside', async () => {
    const v = await openVault(await makeVault());
    const resolved = resolveInVault(v, 'papers/../concepts/x.md');
    expect(resolved).toBe(path.join(v.root, 'concepts', 'x.md'));
  });

  it('rejects a path equal to vault root prefix but outside', async () => {
    // e.g. if vault is /tmp/my-vault, path '/tmp/my-vault-evil/x' should not pass.
    // This is exercised via the rootWithSep check.
    const v = await openVault(await makeVault());
    // Construct a sibling dir with a name that's a prefix of the vault name.
    // Since we pass relative paths, we rely on the absolute check above.
    expect(() => resolveInVault(v, '../my-vault-evil/x')).toThrow(PathEscapeError);
  });
});

describe('writeFileInVault / readFileInVault', () => {
  it('roundtrips a file through vault helpers', async () => {
    const v = await openVault(await makeVault());
    await writeFileInVault(v, 'papers/x.md', 'hello');
    const read = await readFileInVault(v, 'papers/x.md');
    expect(read).toBe('hello');
  });

  it('creates parent dirs on write', async () => {
    const v = await openVault(await makeVault());
    await writeFileInVault(v, 'deeply/nested/thing.md', 'ok');
    const read = await readFileInVault(v, 'deeply/nested/thing.md');
    expect(read).toBe('ok');
  });

  it('rejects writes that escape', async () => {
    const v = await openVault(await makeVault());
    await expect(writeFileInVault(v, '../escape.md', 'nope')).rejects.toThrow(PathEscapeError);
  });
});

describe('listPages', () => {
  it('lists .md files and skips sources/ + .lorekeeper/', async () => {
    const v = await openVault(await makeVault());
    await writeFileInVault(v, 'index.md', '# root');
    await writeFileInVault(v, 'papers/foo.md', '# foo');
    await writeFileInVault(v, 'concepts/bar.md', '# bar');
    // A file inside sources/ — should be skipped.
    await fs.mkdir(path.join(v.root, 'sources'), { recursive: true });
    await fs.writeFile(path.join(v.root, 'sources', 'raw.md'), '# raw');
    // A file inside .lorekeeper/ — should be skipped.
    await fs.writeFile(path.join(v.root, '.lorekeeper', 'notes.md'), '# notes');

    const pages = await listPages(v);
    expect(pages).toEqual(['concepts/bar.md', 'index.md', 'papers/foo.md']);
  });
});
