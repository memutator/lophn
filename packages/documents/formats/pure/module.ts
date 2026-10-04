import type {
  FormatDiagnostic,
  FormatValidationResult,
  SectionExtractionResult,
} from "../../../contracts/documents/mod.ts";
import type { FormatModuleInput, InputIssue } from "./input.ts";
import { sha256Text } from "./sha256.ts";

export type LineRange = { start_line: number; end_line: number };

export type HeadingSpan = {
  title: string;
  level: number;
  startLine: number;
  endLine: number;
  anchor: string | null;
};

type Built = {
  title: string;
  level: number;
  anchor: string | null;
  explicit: boolean;
  slug: string;
  key: string;
  parent: string | null;
  position: number;
  startLine: number;
  endLine: number;
  own: LineRange[];
};

const CONTROL = /\p{Cc}/u;

function linesOf(text: string): string[] {
  return text.split("\n");
}

function codePoints(value: string): number {
  return [...value].length;
}

// 문자·숫자·공백·하이픈만 남긴다. `&`는 버리고 남은 공백은 각각 하이픈이 되어 `A & B`는 `a--b`가 된다.
export function slugFromTitle(title: string): string {
  const kept = [...title.toLowerCase()].filter((character) => {
    if (character === " " || character === "-" || character === "\t") {
      return true;
    }
    return /^\p{L}$/u.test(character) || /^\p{N}$/u.test(character);
  }).join("");
  const slug = [...kept].map((character) =>
    character === " " || character === "\t" ? "-" : character
  ).join("");
  return slug.length === 0 ? "section" : slug;
}

function uniqueKey(used: Map<string, true>, key: string): string {
  if (!used.has(key)) {
    used.set(key, true);
    return key;
  }
  let suffix = 2;
  while (used.has(`${key}-${suffix}`)) suffix += 1;
  const next = `${key}-${suffix}`;
  used.set(next, true);
  return next;
}

function bodyOf(lines: readonly string[], range: LineRange): string {
  return lines.slice(range.start_line - 1, range.end_line).join("\n");
}

function subtract(
  range: LineRange,
  holes: readonly LineRange[],
): LineRange[] {
  let cursor = range.start_line;
  const kept: LineRange[] = [];
  for (const hole of holes) {
    if (hole.end_line < cursor || hole.start_line > range.end_line) continue;
    if (hole.start_line > cursor) {
      kept.push({ start_line: cursor, end_line: hole.start_line - 1 });
    }
    cursor = Math.max(cursor, hole.end_line + 1);
  }
  if (cursor <= range.end_line) {
    kept.push({ start_line: cursor, end_line: range.end_line });
  }
  return kept;
}

export type SectionBuild = {
  text: string;
  headings: readonly HeadingSpan[];
  // 유일한 h1의 표시 제목. section과 body_hash에서는 뺀다.
  documentTitle: string | null;
  // front matter처럼 대표 텍스트에는 남고 section 본문에서는 빼는 줄.
  omitted: readonly LineRange[];
};

export type SectionDiagnostic = {
  file: string;
  line: number;
  message: string;
};

export type SectionTree =
  | {
    ok: true;
    title: string | null;
    sections: SectionExtractionResult extends { sections: infer S } ? S
      : never;
    diagnostics: SectionDiagnostic[];
  }
  | { ok: false; reason: string; line?: number };

// heading span으로 key·parent·범위·본문 hash를 만든다. 가짜 parent는 만들지 않는다.
export function buildSections(source: SectionBuild): SectionTree {
  const lines = linesOf(source.text);
  const spans = [...source.headings].sort((left, right) =>
    left.startLine - right.startLine
  );
  const omitted = [...source.omitted].sort((left, right) =>
    left.start_line - right.start_line
  );
  const used = new Map<string, true>();
  const siblingCounts = new Map<string, Map<string, number>>();
  const stack: Built[] = [];
  const built: Built[] = [];
  const diagnostics: SectionDiagnostic[] = [];
  const explicitKeys = new Map<string, number>();

  for (const [position, span] of spans.entries()) {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= span.level) {
      stack.pop();
    }
    const parent = stack.length === 0 ? null : stack[stack.length - 1]!;
    const explicit = span.anchor !== null && span.anchor.length > 0;
    const slug = explicit ? span.anchor! : slugFromTitle(span.title);
    if (CONTROL.test(slug)) {
      return {
        ok: false,
        reason: "explicit anchor contains a control character",
        line: span.startLine,
      };
    }
    const base = parent === null ? slug : `${parent.key}/${slug}`;
    if (explicit && explicitKeys.has(base)) {
      diagnostics.push({
        file: "",
        line: span.startLine,
        message: `duplicate explicit anchor ${base}`,
      });
      continue;
    }
    if (explicit) explicitKeys.set(base, span.startLine);
    const parentKey = parent === null ? "" : parent.key;
    let counts = siblingCounts.get(parentKey);
    if (counts === undefined) {
      counts = new Map();
      siblingCounts.set(parentKey, counts);
    }
    const count = (counts.get(slug) ?? 0) + 1;
    counts.set(slug, count);
    const key = explicit || count === 1
      ? uniqueKey(used, base)
      : uniqueKey(used, `${base}-${count}`);
    const next = spans.slice(position + 1).find((item) =>
      item.level <= span.level
    );
    const endLine = next === undefined ? lines.length : next.startLine - 1;
    const node: Built = {
      title: span.title,
      level: span.level,
      anchor: explicit ? span.anchor : null,
      explicit,
      slug,
      key,
      parent: parent?.key ?? null,
      position,
      startLine: span.startLine,
      endLine: Math.max(span.startLine, endLine),
      own: [],
    };
    built.push(node);
    stack.push(node);
  }

  for (const node of built) {
    const children = built.filter((item) => item.parent === node.key);
    const holes = [
      ...omitted,
      { start_line: node.startLine, end_line: node.startLine },
      ...children.map((child) => ({
        start_line: child.startLine,
        end_line: child.endLine,
      })),
    ];
    node.own = subtract(
      { start_line: node.startLine, end_line: node.endLine },
      holes,
    );
  }

  const preambleEnd = spans[0]?.startLine ?? lines.length + 1;
  const preambleHoles = omitted.filter((range) => range.end_line < preambleEnd);
  if (source.documentTitle !== null && spans[0] !== undefined) {
    preambleHoles.push({
      start_line: spans[0].startLine,
      end_line: spans[0].startLine,
    });
  }
  const preambleRanges = subtract(
    { start_line: 1, end_line: Math.max(1, preambleEnd - 1) },
    preambleHoles,
  ).filter((range) => bodyOf(lines, range).replace(/\s+/g, "").length > 0);
  const sections: Extract<SectionTree, { ok: true }>["sections"] = [];
  if (preambleRanges.length > 0) {
    const subtree = {
      start_line: 1,
      end_line: Math.max(1, preambleEnd - 1),
    };
    sections.push({
      key: "_preamble",
      title: "",
      parent: null,
      position: 0,
      level: 0,
      anchor: null,
      own_ranges: preambleRanges,
      subtree_range: subtree,
      characters: codePoints(
        preambleRanges.map((range) => bodyOf(lines, range)).join("\n"),
      ),
      body_hash: sha256Text(
        preambleRanges.map((range) => bodyOf(lines, range)).join("\n"),
      ),
    });
  }
  for (const node of built) {
    const bodies = node.own.map((range) => bodyOf(lines, range));
    sections.push({
      key: node.key,
      title: node.title,
      parent: node.parent,
      position: sections.length,
      level: node.level,
      anchor: node.anchor,
      own_ranges: node.own,
      subtree_range: { start_line: node.startLine, end_line: node.endLine },
      characters: codePoints(bodies.join("\n")),
      body_hash: sha256Text(bodies.join("\n")),
    });
  }
  return { ok: true, title: source.documentTitle, sections, diagnostics };
}

export function readyExtraction(
  input: FormatModuleInput,
  text: string,
  tree: Extract<SectionTree, { ok: true }>,
): SectionExtractionResult {
  return {
    input_hash: input.input_hash,
    module_hash: input.module_hash,
    status: "ready",
    title: tree.title,
    text,
    text_hash: sha256Text(text),
    sections: tree.sections,
  };
}

export function unsupportedExtraction(
  input: FormatModuleInput,
): SectionExtractionResult {
  return {
    input_hash: input.input_hash,
    module_hash: input.module_hash,
    status: "unsupported",
    title: null,
    sections: [],
  };
}

function diagnostic(
  issue: InputIssue,
  file: string | undefined,
): FormatDiagnostic {
  return {
    severity: "error",
    code: issue.code,
    message: issue.message,
    file: issue.file ?? file ?? null,
    start_line: issue.line ?? null,
    end_line: issue.line ?? null,
    column: issue.column ?? null,
  };
}

export function validationFrom(
  input: FormatModuleInput,
  issues: readonly InputIssue[],
  file?: string,
): FormatValidationResult {
  const diagnostics = issues.map((issue) => diagnostic(issue, file));
  return {
    input_hash: input.input_hash,
    module_hash: input.module_hash,
    status: diagnostics.length === 0 ? "passed" : "failed",
    diagnostics,
    error_count: diagnostics.length,
    warning_count: 0,
  };
}
