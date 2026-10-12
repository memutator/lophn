// live preview가 그릴 것을 syntax tree와 선택에서 계산한 순수 span이다. CodeMirror
// decoration으로 바꾸는 일은 live-preview.ts가 한다. DOM 없이 테스트하려고 나눴다.
//
// 규칙 하나: 커서나 선택이 요소 안에 있으면 그 요소는 원문을 보이고
// 표지 문자는 muted로 남는다. 밖이면 표지를 숨기고 읽기 모양으로 그린다.
import type { EditorState, Text } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

export type Span =
  | { kind: "hide"; from: number; to: number }
  | { kind: "mark"; from: number; to: number; cls: string; href?: string }
  | { kind: "line"; from: number; cls: string }
  | { kind: "bullet"; from: number; to: number }
  | { kind: "task"; from: number; to: number; checked: boolean; line: number }
  | { kind: "rule"; from: number; to: number }
  | { kind: "lang"; at: number; name: string }
  | {
    kind: "image";
    from: number;
    to: number;
    src: string;
    alt: string;
    replace: boolean;
  };

/** 통째로 그리는 block. CodeMirror는 block decoration을 state에서만 받는다. */
export type Block =
  | {
    kind: "table";
    from: number;
    to: number;
    rows: string[][];
    align: Align[];
  }
  | {
    kind: "frontmatter";
    from: number;
    to: number;
    fields: [string, string][];
  };

export type Align = "left" | "center" | "right" | null;

interface Selection {
  from: number;
  to: number;
}

function selections(state: EditorState): Selection[] {
  return state.selection.ranges.map((range) => ({
    from: range.from,
    to: range.to,
  }));
}

/** 선택이 [from, to]에 닿는지. 끝을 포함해 바로 뒤 커서도 안으로 센다. */
export function touches(
  ranges: readonly Selection[],
  from: number,
  to: number,
): boolean {
  return ranges.some((range) => range.from <= to && range.to >= from);
}

/** 파일 맨 위 frontmatter(`---` … `---`) 범위. */
export function frontmatterRange(
  doc: Text,
): { from: number; to: number } | null {
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== "---") return null;
  for (let number = 2; number <= doc.lines; number += 1) {
    const text = doc.line(number).text.trimEnd();
    if (text === "---" || text === "...") {
      return { from: 0, to: doc.line(number).to };
    }
  }
  return null;
}

/**
 * 단순 YAML frontmatter의 key/value. 중첩·여러 줄 값은 첫 줄 원문으로 보인다. 두 열은
 * 보기일 뿐이고 원문은 click 한 번 거리다.
 */
export function frontmatterFields(source: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of source.split("\n").slice(1, -1)) {
    const match = /^([A-Za-z0-9_][\w.-]*)\s*:\s*(.*)$/.exec(line);
    if (match) out.push([match[1]!, unquote(match[2]!.trim())]);
    else if (out.length > 0 && /^\s+-\s+/.test(line)) {
      const last = out[out.length - 1]!;
      const item = unquote(line.replace(/^\s+-\s+/, "").trim());
      last[1] = last[1] ? `${last[1]}, ${item}` : item;
    }
  }
  return out;
}

function unquote(value: string): string {
  const match = /^(["'])(.*)\1$/.exec(value);
  return match ? match[2]! : value;
}

/** 표 원문의 칸. 두 번째 줄은 정렬로 읽는다. */
export function parseTable(
  source: string,
): { rows: string[][]; align: Align[] } {
  const lines = source.split("\n").filter((line) => line.trim() !== "");
  const cells = (line: string) => {
    let text = line.trim();
    if (text.startsWith("|")) text = text.slice(1);
    if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
    return text.split(/(?<!\\)\|/).map((cell) =>
      cell.trim().replace(/\\\|/g, "|")
    );
  };
  const rows: string[][] = [];
  let align: Align[] = [];
  lines.forEach((line, index) => {
    if (
      index === 1 && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line)
    ) {
      align = cells(line).map((cell) =>
        cell.startsWith(":") && cell.endsWith(":")
          ? "center"
          : cell.endsWith(":")
          ? "right"
          : cell.startsWith(":")
          ? "left"
          : null
      );
    } else rows.push(cells(line));
  });
  return { rows, align };
}

const INLINE_STYLE: Record<string, string> = {
  Emphasis: "cm-lp-em",
  StrongEmphasis: "cm-lp-strong",
  Strikethrough: "cm-lp-strike",
  InlineCode: "cm-lp-code",
};
const INLINE_MARK = new Set(["EmphasisMark", "StrikethroughMark", "CodeMark"]);

/** from~to 사이의 inline·line span. focused가 false면 커서 자리도 원문을 보이지 않는다. */
export function previewSpans(
  state: EditorState,
  from = 0,
  to = state.doc.length,
  focused = true,
): Span[] {
  const doc = state.doc;
  const ranges = focused ? selections(state) : [];
  const front = frontmatterRange(doc);
  const spans: Span[] = [];
  const lineOf = (position: number) => doc.lineAt(position);
  const hideOrMute = (active: boolean, start: number, end: number) =>
    spans.push(
      active
        ? { kind: "mark", from: start, to: end, cls: "cm-lp-marker" }
        : { kind: "hide", from: start, to: end },
    );
  // 표지와 그 뒤 빈칸 하나(`# `, `> `).
  const withSpace = (node: SyntaxNode) =>
    doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;

  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (front && node.from < front.to) {
        // parser는 frontmatter를 문단과 setext 제목으로 읽는다. 두 열 block이 그린다.
        return node.to > front.to;
      }
      const name = node.name;
      const heading = /^ATXHeading([1-6])$/.exec(name);
      if (heading) {
        spans.push({
          kind: "line",
          from: lineOf(node.from).from,
          cls: `cm-lp-h${heading[1]}`,
        });
        return;
      }
      if (/^SetextHeading[12]$/.test(name)) {
        spans.push({
          kind: "line",
          from: lineOf(node.from).from,
          cls: `cm-lp-h${name.endsWith("1") ? 1 : 2}`,
        });
        return;
      }
      if (name === "HeaderMark") {
        const line = lineOf(node.from);
        const active = touches(ranges, line.from, line.to);
        // setext 밑줄은 따로 한 줄이다. ATX `#`만 숨긴다.
        if (node.from === line.from || /^\s*#/.test(line.text)) {
          hideOrMute(active, node.from, withSpace(node.node));
        }
        return;
      }
      if (name in INLINE_STYLE) {
        spans.push({
          kind: "mark",
          from: node.from,
          to: node.to,
          cls: INLINE_STYLE[name]!,
        });
        const active = touches(ranges, node.from, node.to);
        for (
          let child = node.node.firstChild;
          child;
          child = child.nextSibling
        ) {
          if (INLINE_MARK.has(child.name)) {
            hideOrMute(active, child.from, child.to);
          }
        }
        return;
      }
      if (name === "Link") {
        const active = touches(ranges, node.from, node.to);
        const url = node.node.getChild("URL");
        const href = url ? doc.sliceString(url.from, url.to) : undefined;
        const marks = node.node.getChildren("LinkMark");
        const textFrom = marks[0]?.to ?? node.from;
        const textTo = marks[1]?.from ?? node.to;
        if (active) {
          spans.push({
            kind: "mark",
            from: node.from,
            to: node.to,
            cls: "cm-lp-link-source",
            href,
          });
          for (const mark of marks) {
            spans.push({
              kind: "mark",
              from: mark.from,
              to: mark.to,
              cls: "cm-lp-marker",
            });
          }
        } else if (marks.length >= 2) {
          spans.push({ kind: "hide", from: node.from, to: textFrom });
          spans.push({
            kind: "mark",
            from: textFrom,
            to: textTo,
            cls: "cm-lp-link",
            href,
          });
          spans.push({ kind: "hide", from: textTo, to: node.to });
        }
        return false;
      }
      if (
        name === "URL" && node.node.parent?.name !== "Link" &&
        node.node.parent?.name !== "Image"
      ) {
        spans.push({
          kind: "mark",
          from: node.from,
          to: node.to,
          cls: "cm-lp-link",
          href: doc.sliceString(node.from, node.to),
        });
        return;
      }
      if (name === "Image") {
        const active = touches(ranges, node.from, node.to);
        const url = node.node.getChild("URL");
        const marks = node.node.getChildren("LinkMark");
        const alt = marks.length >= 2
          ? doc.sliceString(marks[0]!.to, marks[1]!.from)
          : "";
        if (active) {
          spans.push({
            kind: "mark",
            from: node.from,
            to: node.to,
            cls: "cm-lp-marker",
          });
        }
        spans.push({
          kind: "image",
          from: node.from,
          to: node.to,
          src: url ? doc.sliceString(url.from, url.to) : "",
          alt,
          replace: !active,
        });
        return false;
      }
      if (name === "ListItem") {
        const mark = node.node.getChild("ListMark");
        if (!mark) return;
        const line = lineOf(mark.from);
        // 읽기 목록과 같은 들임이다. 중첩은 원문 들임이 더한다.
        spans.push({ kind: "line", from: line.from, cls: "cm-lp-list" });
        const active = touches(ranges, line.from, line.to);
        const task = node.node.getChild("Task")?.getChild("TaskMarker") ?? null;
        if (task && !active) {
          const end = doc.sliceString(task.to, task.to + 1) === " "
            ? task.to + 1
            : task.to;
          spans.push({
            kind: "task",
            from: mark.from,
            to: end,
            checked: /x/i.test(doc.sliceString(task.from, task.to)),
            line: line.from,
          });
        } else if (
          !active && /^[-*+]$/.test(doc.sliceString(mark.from, mark.to))
        ) {
          spans.push({ kind: "bullet", from: mark.from, to: mark.to });
        } else {
          spans.push({
            kind: "mark",
            from: mark.from,
            to: mark.to,
            cls: active ? "cm-lp-marker" : "cm-lp-number",
          });
        }
        return;
      }
      if (name === "Blockquote") {
        for (let position = node.from; position <= node.to;) {
          const line = lineOf(position);
          spans.push({ kind: "line", from: line.from, cls: "cm-lp-quote" });
          if (line.to + 1 > node.to) break;
          position = line.to + 1;
        }
        return;
      }
      if (name === "QuoteMark") {
        const line = lineOf(node.from);
        hideOrMute(
          touches(ranges, line.from, line.to),
          node.from,
          withSpace(node.node),
        );
        return;
      }
      if (name === "HorizontalRule") {
        if (!touches(ranges, node.from, node.to)) {
          spans.push({ kind: "rule", from: node.from, to: node.to });
        }
        return;
      }
      if (name === "FencedCode" || name === "CodeBlock") {
        const active = touches(ranges, node.from, node.to);
        const first = lineOf(node.from).number;
        const last = lineOf(node.to).number;
        for (let number = first; number <= last; number += 1) {
          const line = doc.line(number);
          const edge = name === "FencedCode" &&
            (number === first || number === last);
          const classes = ["cm-lp-codeblock"];
          if (number === first) classes.push("cm-lp-codeblock-first");
          if (number === last) classes.push("cm-lp-codeblock-last");
          if (edge && !active) classes.push("cm-lp-fence");
          spans.push({ kind: "line", from: line.from, cls: classes.join(" ") });
          if (edge && !active && line.to > line.from) {
            spans.push({ kind: "hide", from: line.from, to: line.to });
          } else if (edge) {
            spans.push({
              kind: "mark",
              from: line.from,
              to: line.to,
              cls: "cm-lp-marker",
            });
          }
        }
        const info = node.node.getChild("CodeInfo");
        if (info && !active) {
          spans.push({
            kind: "lang",
            at: lineOf(node.from).from,
            name: doc.sliceString(info.from, info.to),
          });
        }
        return false;
      }
      if (name === "HTMLBlock" || name === "CommentBlock") {
        for (
          let number = lineOf(node.from).number;
          number <= lineOf(node.to).number;
          number += 1
        ) {
          spans.push({
            kind: "line",
            from: doc.line(number).from,
            cls: "cm-lp-html",
          });
        }
        return false;
      }
      if (name === "Table") return false;
    },
  });
  return spans;
}

/** 선택이 안에 없는 표와 frontmatter. 통째로 그린다. */
export function previewBlocks(state: EditorState, focused = true): Block[] {
  const doc = state.doc;
  const ranges = focused ? selections(state) : [];
  const out: Block[] = [];
  const front = frontmatterRange(doc);
  if (front && !touches(ranges, front.from, front.to)) {
    out.push({
      kind: "frontmatter",
      ...front,
      fields: frontmatterFields(doc.sliceString(front.from, front.to)),
    });
  }
  syntaxTree(state).iterate({
    enter(node) {
      if (front && node.from < front.to) return node.to > front.to;
      if (node.name !== "Table") return;
      if (!touches(ranges, node.from, node.to)) {
        const start = doc.lineAt(node.from).from;
        const end = doc.lineAt(node.to).to;
        out.push({
          kind: "table",
          from: start,
          to: end,
          ...parseTable(doc.sliceString(start, end)),
        });
      }
      return false;
    },
  });
  return out;
}

/** 원문이 보이는 링크에서 Mod-click이 따라갈 주소. */
export function linkAt(state: EditorState, position: number): string | null {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, 1);
    node;
    node = node.parent
  ) {
    if (node.name === "URL") return state.doc.sliceString(node.from, node.to);
    if (node.name === "Link") {
      const url = node.getChild("URL");
      return url ? state.doc.sliceString(url.from, url.to) : null;
    }
  }
  return null;
}
