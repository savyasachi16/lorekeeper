import { z } from 'zod';

/**
 * Zod schemas for page frontmatter. These are advisory: the agent is trusted
 * to follow the vault's `CLAUDE.md` schema contract, but we can validate pages
 * client-side during `lint` to flag drift.
 */

export const BasePageFrontmatter = z.object({
  type: z.string(),
  title: z.string(),
  tags: z.array(z.string()).optional(),
});

export const PaperFrontmatter = BasePageFrontmatter.extend({
  type: z.literal('paper'),
  authors: z.array(z.string()).optional(),
  year: z.number().int().optional(),
  venue: z.string().optional(),
  source: z.string(),
  ingested: z.string(),
});

export const ConceptFrontmatter = BasePageFrontmatter.extend({
  type: z.literal('concept'),
});

export const AuthorFrontmatter = BasePageFrontmatter.extend({
  type: z.literal('author'),
  affiliation: z.string().optional(),
});

export const MethodFrontmatter = BasePageFrontmatter.extend({
  type: z.literal('method'),
});

export const AnyPageFrontmatter = z.discriminatedUnion('type', [
  PaperFrontmatter,
  ConceptFrontmatter,
  AuthorFrontmatter,
  MethodFrontmatter,
]);

export type AnyPageFrontmatter = z.infer<typeof AnyPageFrontmatter>;
