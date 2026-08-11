import type { LinkStyle } from "../settings";

export function basename(path: string): string {
  const f = path.split("/").pop() ?? path;
  return f.replace(/\.md$/i, "");
}

function relativePath(fromPath: string, toPath: string): string {
  const fromParts = fromPath.split("/");
  fromParts.pop(); // drop filename
  const toParts = toPath.split("/");
  let i = 0;
  while (
    i < fromParts.length &&
    i < toParts.length &&
    fromParts[i] === toParts[i]
  ) {
    i++;
  }
  const up = fromParts.length - i;
  const down = toParts.slice(i);
  return [...Array(up).fill(".."), ...down].join("/");
}

/**
 * Build a link string from source note to target note.
 * - relative: [Title](relpath.md)  — Gitee-friendly default
 * - wikilink: [[Title]]
 */
export function formatLink(
  sourcePath: string,
  targetPath: string,
  linkStyle: LinkStyle
): string {
  const title = basename(targetPath);
  if (linkStyle === "wikilink") {
    return `[[${title}]]`;
  }
  const rel = relativePath(sourcePath, targetPath);
  return `[${title}](${rel})`;
}
