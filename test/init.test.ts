import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initVault } from '../src/ops/init.js';
import { loadConfig } from '../src/core/config.js';
import { openVault } from '../src/core/vault.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lorekeeper-init-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('initVault', () => {
  it('scaffolds a research-papers vault', async () => {
    const dir = path.join(tmpDir, 'my-vault');
    const result = await initVault({ dir });

    expect(result.template).toBe('research-papers');
    expect(result.vaultRoot).toBe(dir);

    // Template files copied
    await expect(fs.stat(path.join(dir, 'CLAUDE.md'))).resolves.toBeDefined();
    await expect(fs.stat(path.join(dir, 'index.md'))).resolves.toBeDefined();

    // Subdirs created
    for (const sub of ['sources', 'papers', 'concepts', 'authors', 'methods']) {
      const stat = await fs.stat(path.join(dir, sub));
      expect(stat.isDirectory()).toBe(true);
    }

    // Config written and loadable
    const vault = await openVault(dir);
    const config = await loadConfig(vault);
    expect(config.version).toBe(1);
    expect(config.template).toBe('research-papers');
    expect(config.ingested).toEqual([]);
  });

  it('refuses to init a non-empty directory without --force', async () => {
    const dir = path.join(tmpDir, 'existing');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# existing project');

    await expect(initVault({ dir })).rejects.toThrow(/not empty/i);
  });

  it('initializes a non-empty directory with --force and preserves existing files', async () => {
    const dir = path.join(tmpDir, 'existing');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# existing project');

    await initVault({ dir, force: true });

    // Existing file preserved
    const readme = await fs.readFile(path.join(dir, 'README.md'), 'utf8');
    expect(readme).toBe('# existing project');
    // Template files still copied
    await expect(fs.stat(path.join(dir, 'CLAUDE.md'))).resolves.toBeDefined();
  });

  it('rejects unknown templates', async () => {
    await expect(
      initVault({ dir: path.join(tmpDir, 'v'), template: 'nonexistent' }),
    ).rejects.toThrow(/unknown template/i);
  });
});
