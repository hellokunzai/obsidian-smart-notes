import * as yaml from "js-yaml";

export interface FrontmatterResult {
  data: Record<string, unknown>;
  hasFrontmatter: boolean;
  bodyStart: number;
  raw: string;
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  if (!m) {
    return { data: {}, hasFrontmatter: false, bodyStart: 0, raw: "" };
  }
  let data: unknown = {};
  try {
    data = yaml.load(m[1]) ?? {};
  } catch {
    data = {};
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    data = {};
  }
  return {
    data: data as Record<string, unknown>,
    hasFrontmatter: true,
    bodyStart: m[0].length,
    raw: m[1],
  };
}

export function serializeFrontmatter(data: Record<string, unknown>): string {
  return `---\n${yaml.dump(data, { lineWidth: -1, noRefs: true })}---\n`;
}

/**
 * Replace the frontmatter block with `props` (the complete new frontmatter).
 * Falls back to prepending a new frontmatter block when none exists.
 */
export function mergeFrontmatter(
  content: string,
  props: Record<string, unknown>
): string {
  const { hasFrontmatter, bodyStart } = parseFrontmatter(content);
  const newFm = serializeFrontmatter(props);
  if (hasFrontmatter) {
    return newFm + content.slice(bodyStart);
  }
  return newFm + content;
}
