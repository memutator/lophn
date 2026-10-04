import type { HeadingSpan, LineRange } from "../../pure/sections.ts";

export type MarkdownScan = {
  headings: HeadingSpan[];
  omitted: LineRange[];
};

const ATX = /^( {0,3})(#{1,6})([ \t]+(.*))?$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const SETEXT = /^( {0,3})(=+|-+)[ \t]*$/;
const FRONT_START = /^---[ \t]*$/;
const FRONT_END = /^(?:---|\.\.\.)[ \t]*$/;
const PRE_OPEN = /^[ \t]*<pre(?:\s[^>]*)?>[ \t]*$/i;
const PRE_CLOSE = /<\/pre>/i;

function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

function displayTitle(raw: string): { title: string; anchor: string | null } {
  const match = /[ \t]+\{\#([^}\s]+)\}[ \t]*$/.exec(raw);
  if (match === null || match.index === undefined) {
    return { title: raw.replace(/[ \t]+(#*)[ \t]*$/, "").trim(), anchor: null };
  }
  return {
    title: raw.slice(0, match.index).replace(/[ \t]+#*[ \t]*$/, "").trim(),
    anchor: match[1] ?? null,
  };
}

function atx(line: string, lineNumber: number): HeadingSpan | null {
  const match = ATX.exec(line);
  if (match === null) return null;
  const marks = match[2] ?? "";
  const rest = match[4] ?? "";
  if (marks.length > 0 && match[3] === undefined && rest.length === 0) {
    // closing sequence 없는 `#`만 있는 줄도 ATX heading이다.
  }
  const shown = displayTitle(rest);
  return {
    title: shown.title,
    level: marks.length,
    startLine: lineNumber,
    endLine: lineNumber,
    anchor: shown.anchor,
  };
}

function setext(
  lines: readonly string[],
  index: number,
): HeadingSpan | null {
  if (index + 1 >= lines.length) return null;
  const underline = SETEXT.exec(lines[index + 1] ?? "");
  const text = lines[index] ?? "";
  if (underline === null || isBlank(text) || text.startsWith("    ")) return null;
  if (/^ {0,3}(```|~~~)/.test(text)) return null;
  const marks = underline[2] ?? "";
  const shown = displayTitle(text.trim());
  return {
    title: shown.title,
    level: marks.startsWith("=") ? 1 : 2,
    startLine: index + 1,
    endLine: index + 2,
    anchor: shown.anchor,
  };
}

// ATX·setext만 뽑는다. front matter·fence·HTML pre 안은 heading으로 보지 않는다.
export function scanMarkdown(text: string): MarkdownScan {
  const lines = text.split("\n");
  const headings: HeadingSpan[] = [];
  const omitted: LineRange[] = [];
  let index = 0;
  if (FRONT_START.test(lines[0] ?? "")) {
    let end = 1;
    while (end < lines.length && !FRONT_END.test(lines[end] ?? "")) end += 1;
    if (end < lines.length) {
      omitted.push({ start_line: 1, end_line: end + 1 });
      index = end + 1;
    }
  }
  let fence: { mark: string; length: number } | null = null;
  let pre = false;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    if (fence !== null) {
      const close = FENCE.exec(line);
      if (
        close !== null && (close[2] ?? "").startsWith(fence.mark) &&
        (close[2] ?? "").length >= fence.length && (close[3] ?? "").trim() === ""
      ) fence = null;
      index += 1;
      continue;
    }
    if (pre) {
      if (PRE_CLOSE.test(line)) pre = false;
      index += 1;
      continue;
    }
    const opened = FENCE.exec(line);
    if (opened !== null) {
      const mark = (opened[2] ?? "`").slice(0, 1);
      fence = { mark, length: (opened[2] ?? "").length };
      index += 1;
      continue;
    }
    if (PRE_OPEN.test(line)) {
      pre = true;
      index += 1;
      continue;
    }
    const heading = atx(line, lineNumber) ?? setext(lines, index);
    if (heading !== null) {
      headings.push(heading);
      index += heading.endLine - heading.startLine + 1;
      continue;
    }
    index += 1;
  }
  return { headings, omitted };
}
