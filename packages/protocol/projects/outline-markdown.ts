// md 목차 parser. shell editor의 Outline, context의 `outline`·`section` kind, 준비 worker가
// 같은 코드를 불러야 같은 파일에서 같은 tree를 얻으므로 contracts에 둔다.
// 의존성·시각·무작위·IO가 없다.
//
// 입력 text는 UTF-8로 읽은 문자열이다. parser가 BOM 제거 → CRLF/CR을 LF로 → NFC를 직접 적용하고,
// 줄 번호와 codepoint 수는 이 정규화한 텍스트 기준이다(`text.split("\n")`의 조각 하나가 한 줄이며,
// 끝의 개행 뒤 빈 조각도 한 줄로 센다: documents/formats의 document module과 같다).

import { sha256Hex } from "./outline-markdown-sha256.ts";

type OutlineRange = {
  // 1-based, inclusive.
  start_line: number;
  end_line: number;
};

type OutlineNode = {
  // 한 outline 안에서 유일. 명시 anchor 우선, 없으면 제목 slug, 같은 부모 아래 중복은 `-2`부터,
  // 부모가 있으면 `부모key/자기slug`. outline은 모든 heading의 tree이고 heading node만 담는다. 첫 heading 앞 본문은 node가 아니며 줄 범위로 읽는다. 유일한 h1도 level 1 node이고 그 아래 heading은 자식이다.
  key: string;
  title: string;
  parent: string | null;
  // 원문 순서, 0부터.
  position: number;
  // 1..6. 건너뛴 level은 그대로 두고 가장 가까운 낮은 level의 heading 아래에 둔다.
  level: number;
  anchor: string | null;
  // heading 줄과 자식 section을 뺀 자체 본문. 한 줄도 없으면 null(빈 줄뿐인 본문은 null이 아니다).
  own_range: OutlineRange | null;
  // heading 줄부터 하위 section 끝까지(setext면 밑줄 줄 포함).
  subtree_range: OutlineRange;
  // 자체 본문의 Unicode codepoint 수. own_range의 줄을 "\n"으로 이은 글자 수.
  characters: number;
  // ceil(characters / 3). 실제 model token 수가 아니다.
  estimated_tokens: number;
  // own_range의 줄을 "\n"으로 이은 문자열(UTF-8)의 SHA-256 소문자 hex. own_range가 null이면 빈 문자열의 hash.
  body_hash: string;
  children_count: number;
};

type OutlineReady = {
  status: "ready";
  // 유일한 h1의 표시 제목. h1이 없거나 둘 이상이면 null. 그 h1은 sections에도 level 1 node로 든다.
  title: string | null;
  line_count: number;
  characters: number;
  sections: OutlineNode[];
};

type OutlineUnsupported = {
  status: "unsupported";
  media_type: string;
};

type OutlineResult = OutlineReady | OutlineUnsupported;

type Heading = {
  title: string;
  level: number;
  anchor: string | null;
  // heading 줄(setext면 글자 줄)과 끝 줄(setext면 밑줄 줄). 1-based.
  start_line: number;
  end_line: number;
};

const ATX = /^( {0,3})(#{1,6})([ \t]+(.*))?$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const SETEXT = /^( {0,3})(=+|-+)[ \t]*$/;
const FRONT_START = /^---[ \t]*$/;
const FRONT_END = /^(?:---|\.\.\.)[ \t]*$/;
const PRE_OPEN = /^[ \t]*<pre(?:\s[^>]*)?>[ \t]*$/i;
const PRE_CLOSE = /<\/pre>/i;
const CONTROL = /\p{Cc}/u;
const ANCHOR_TAIL = /[ \t]+\{#([^}\s]+)\}[ \t]*$/;

function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

function countCodepoints(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

// 뒤의 `{#anchor}`를 떼고 anchor를 돌려준다. 제어 문자가 든 anchor는 anchor로 보지 않는다.
function splitAnchor(raw: string): { text: string; anchor: string | null } {
  const match = ANCHOR_TAIL.exec(raw);
  if (match === null || CONTROL.test(match[1] ?? "")) {
    return { text: raw, anchor: null };
  }
  return { text: raw.slice(0, match.index), anchor: match[1] ?? null };
}

// ATX 닫는 `#` 열은 공백이 앞서야 떼고, 제목이 `#`뿐이면 빈 제목이다.
function atxTitle(rest: string): { title: string; anchor: string | null } {
  const { text, anchor } = splitAnchor(rest.trim());
  const title = text.replace(/(^|[ \t]+)#+[ \t]*$/, "").trim();
  return { title, anchor };
}

function atxHeading(line: string, lineNumber: number): Heading | null {
  const match = ATX.exec(line);
  if (match === null) return null;
  const shown = atxTitle(match[4] ?? "");
  return {
    title: shown.title,
    level: (match[2] ?? "").length,
    anchor: shown.anchor,
    start_line: lineNumber,
    end_line: lineNumber,
  };
}

function setextHeading(
  lines: readonly string[],
  index: number,
): Heading | null {
  if (index + 1 >= lines.length) return null;
  const underline = SETEXT.exec(lines[index + 1] ?? "");
  const text = lines[index] ?? "";
  if (underline === null || isBlank(text) || text.startsWith("    ")) {
    return null;
  }
  if (/^ {0,3}(```|~~~)/.test(text)) return null;
  const shown = splitAnchor(text.trim());
  return {
    title: shown.text.trim(),
    level: (underline[2] ?? "").startsWith("=") ? 1 : 2,
    anchor: shown.anchor,
    start_line: index + 1,
    end_line: index + 2,
  };
}

// 앞의 front matter 끝 줄 번호(없으면 0).
function frontMatterEnd(lines: readonly string[]): number {
  if (!FRONT_START.test(lines[0] ?? "")) return 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (FRONT_END.test(lines[index] ?? "")) return index + 1;
  }
  return 0;
}

// ATX·setext heading만 뽑는다. front matter·fence·HTML pre 안은 heading으로 보지 않는다.
function scanHeadings(lines: readonly string[]): Heading[] {
  const headings: Heading[] = [];
  let index = frontMatterEnd(lines);
  let fence: { mark: string; length: number } | null = null;
  let pre = false;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (fence !== null) {
      const close = FENCE.exec(line);
      const run = close?.[2] ?? "";
      if (
        close !== null &&
        run.startsWith(fence.mark) &&
        run.length >= fence.length &&
        (close[3] ?? "").trim() === ""
      )
        fence = null;
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
      const run = opened[2] ?? "`";
      fence = { mark: run.slice(0, 1), length: run.length };
      index += 1;
      continue;
    }
    if (PRE_OPEN.test(line)) {
      pre = true;
      index += 1;
      continue;
    }
    const heading = atxHeading(line, index + 1) ?? setextHeading(lines, index);
    if (heading !== null) {
      headings.push(heading);
      index += heading.end_line - heading.start_line + 1;
      continue;
    }
    index += 1;
  }
  return headings;
}

// 문자·숫자·공백·하이픈만 남긴다. `&`는 버리고 남은 공백은 각각 하이픈이 되어 `A & B`는 `a--b`가 된다.
function slugFromTitle(title: string): string {
  let slug = "";
  for (const character of title.toLowerCase()) {
    if (character === " " || character === "\t") slug += "-";
    else if (
      character === "-" ||
      /^\p{L}$/u.test(character) ||
      /^\p{N}$/u.test(character)
    )
      slug += character;
  }
  return slug.length === 0 ? "section" : slug;
}

function normalize(text: string): string {
  const withoutBom = text.startsWith("﻿") ? text.slice(1) : text;
  return withoutBom
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .normalize("NFC");
}

function buildNodes(
  lines: readonly string[],
  headings: readonly Heading[],
): OutlineNode[] {
  const used = new Set<string>();
  const siblingCounts = new Map<string, Map<string, number>>();
  const stack: OutlineNode[] = [];
  const nodes: OutlineNode[] = [];
  for (const [position, heading] of headings.entries()) {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= heading.level)
      stack.pop();
    const parent = stack.length === 0 ? null : stack[stack.length - 1]!;
    const slug = (heading.anchor ?? slugFromTitle(heading.title)).normalize(
      "NFC",
    );
    const base = parent === null ? slug : `${parent.key}/${slug}`;
    const parentKey = parent?.key ?? "";
    let counts = siblingCounts.get(parentKey);
    if (counts === undefined) {
      counts = new Map();
      siblingCounts.set(parentKey, counts);
    }
    const count = (counts.get(slug) ?? 0) + 1;
    counts.set(slug, count);
    let key = count === 1 ? base : `${base}-${count}`;
    for (let suffix = count + 1; used.has(key); suffix += 1) {
      key = `${base}-${suffix}`;
    }
    used.add(key);

    let next: Heading | undefined;
    let subtreeEnd = lines.length;
    for (let after = position + 1; after < headings.length; after += 1) {
      const candidate = headings[after]!;
      next ??= candidate;
      if (candidate.level <= heading.level) {
        subtreeEnd = candidate.start_line - 1;
        break;
      }
    }
    const ownStart = heading.end_line + 1;
    const ownEnd = next === undefined ? lines.length : next.start_line - 1;
    const own =
      ownStart <= ownEnd ? { start_line: ownStart, end_line: ownEnd } : null;
    const body =
      own === null
        ? ""
        : lines.slice(own.start_line - 1, own.end_line).join("\n");
    const characters = countCodepoints(body);
    const node: OutlineNode = {
      key,
      title: heading.title,
      parent: parent?.key ?? null,
      position,
      level: heading.level,
      anchor: heading.anchor,
      own_range: own,
      subtree_range: { start_line: heading.start_line, end_line: subtreeEnd },
      characters,
      estimated_tokens: Math.ceil(characters / 3),
      body_hash: sha256Hex(body),
      children_count: 0,
    };
    if (parent !== null) parent.children_count += 1;
    nodes.push(node);
    stack.push(node);
  }
  return nodes;
}

function isMarkdown(mediaType: string): boolean {
  const essence = (mediaType.split(";")[0] ?? "").trim().toLowerCase();
  return essence === "text/markdown" || essence === "text/x-markdown";
}

// 형식마다 parser를 붙이는 자리는 이 함수 하나다. 지금은 text/markdown·text/x-markdown만 해석한다.
export function parseOutline(mediaType: string, text: string): OutlineResult {
  if (!isMarkdown(mediaType)) {
    return { status: "unsupported", media_type: mediaType };
  }
  const normalized = normalize(text);
  const lines = normalized.split("\n");
  const headings = scanHeadings(lines);
  const sections = buildNodes(lines, headings);
  const h1 = sections.filter((node) => node.level === 1);
  return {
    status: "ready",
    title: h1.length === 1 ? h1[0]!.title : null,
    line_count: lines.length,
    characters: countCodepoints(normalized),
    sections,
  };
}

// ---------- 새 목차 parser ----------
// key·anchor·token 수·hash 없이 제목 tree와 줄 범위만 돌려준다. ATX와 setext 제목만 보고
// front matter와 fenced code 안은 제외한다. 줄을 건너뛴 level은 가장 가까운 위 level 아래에 둔다.

export type MarkdownOutlineNode = {
  level: number;
  title: string;
  // 제목 줄과 자식 section을 뺀 자체 본문. 한 줄도 없으면 null.
  own_range: OutlineRange | null;
  // 제목 줄(setext면 밑줄 줄 포함)부터 다음 같거나 적은 level 제목 직전까지.
  subtree_range: OutlineRange;
  children: MarkdownOutlineNode[];
};

type PlainHeading = {
  level: number;
  title: string;
  start_line: number;
  end_line: number;
};

function plainHeadings(lines: readonly string[]): PlainHeading[] {
  const headings: PlainHeading[] = [];
  let index = frontMatterEnd(lines);
  let fence: { mark: string; length: number } | null = null;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const run = FENCE.exec(line);
    if (fence !== null) {
      const marks = run?.[2] ?? "";
      if (
        run !== null &&
        marks.startsWith(fence.mark) &&
        marks.length >= fence.length &&
        (run[3] ?? "").trim() === ""
      )
        fence = null;
      index += 1;
      continue;
    }
    if (run !== null) {
      const marks = run[2] ?? "`";
      fence = { mark: marks.slice(0, 1), length: marks.length };
      index += 1;
      continue;
    }
    const atx = ATX.exec(line);
    if (atx !== null) {
      headings.push({
        level: (atx[2] ?? "").length,
        title: (atx[4] ?? "")
          .trim()
          .replace(/(^|[ \t]+)#+[ \t]*$/, "")
          .trim(),
        start_line: index + 1,
        end_line: index + 1,
      });
      index += 1;
      continue;
    }
    const underline = SETEXT.exec(lines[index + 1] ?? "");
    if (underline !== null && !isBlank(line) && !line.startsWith("    ")) {
      headings.push({
        level: (underline[2] ?? "").startsWith("=") ? 1 : 2,
        title: line.trim(),
        start_line: index + 1,
        end_line: index + 2,
      });
      index += 2;
      continue;
    }
    index += 1;
  }
  return headings;
}

export function parseMarkdownOutline(text: string): MarkdownOutlineNode[] {
  const lines = normalize(text).split("\n");
  const headings = plainHeadings(lines);
  const roots: MarkdownOutlineNode[] = [];
  const stack: MarkdownOutlineNode[] = [];
  for (const [position, heading] of headings.entries()) {
    let end = lines.length;
    for (const later of headings.slice(position + 1)) {
      if (later.level <= heading.level) {
        end = later.start_line - 1;
        break;
      }
    }
    const next = headings[position + 1];
    const ownStart = heading.end_line + 1;
    const ownEnd = next === undefined ? lines.length : next.start_line - 1;
    const node: MarkdownOutlineNode = {
      level: heading.level,
      title: heading.title,
      own_range:
        ownStart <= ownEnd ? { start_line: ownStart, end_line: ownEnd } : null,
      subtree_range: { start_line: heading.start_line, end_line: end },
      children: [],
    };
    while (
      stack.length > 0 &&
      stack[stack.length - 1]!.level >= heading.level
    ) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
    stack.push(node);
  }
  return roots;
}
