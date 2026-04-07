import matter from 'gray-matter';

export interface ParsedPage<T = Record<string, unknown>> {
  data: T;
  content: string;
}

/** Parse a markdown page with YAML frontmatter. */
export function parsePage<T = Record<string, unknown>>(raw: string): ParsedPage<T> {
  const parsed = matter(raw);
  return {
    data: parsed.data as T,
    content: parsed.content,
  };
}

/** Serialize frontmatter + body back into a markdown string. */
export function serializePage<T extends Record<string, unknown>>(
  data: T,
  content: string,
): string {
  return matter.stringify(content, data);
}
