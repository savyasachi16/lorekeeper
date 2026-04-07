import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Vault } from './vault.js';

export const LorekeeperConfig = z.object({
  version: z.literal(1),
  template: z.string(),
  ingested: z.array(
    z.object({
      source: z.string(),
      ingestedAt: z.string(),
    }),
  ),
});

export type LorekeeperConfig = z.infer<typeof LorekeeperConfig>;

const CONFIG_REL = path.join('.lorekeeper', 'config.json');

export async function loadConfig(vault: Vault): Promise<LorekeeperConfig> {
  const abs = path.join(vault.root, CONFIG_REL);
  const raw = await fs.readFile(abs, 'utf8');
  return LorekeeperConfig.parse(JSON.parse(raw));
}

export async function saveConfig(vault: Vault, config: LorekeeperConfig): Promise<void> {
  const abs = path.join(vault.root, CONFIG_REL);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function defaultConfig(template: string): LorekeeperConfig {
  return {
    version: 1,
    template,
    ingested: [],
  };
}
