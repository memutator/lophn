import { type DefaultTreeAdapterTypes, parse } from "parse5";
import type { HeadingSpan, LineRange } from "../../pure/module.ts";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type TextNode = DefaultTreeAdapterTypes.TextNode;
type Location = {
  startLine: number;
  endLine: number;
};

const HEADING = /^h([1-6])$/;
const EXCLUDED = new Set([
  "script",
  "style",
  "template",
  "nav",
  "textarea",
  "head",
  "title",
  "pre",
]);

export type HtmlExtract = {
  text: string;
  headings: HeadingSpan[];
  omitted: LineRange[];
  title: string | null;
};

function attribute(element: Element, name: string): string | null {
  const found = element.attrs.find((item) => item.name === name);
  return found === undefined ? null : found.value;
}

function hidden(element: Element): boolean {
  if (element.attrs.some((item) => item.name === "hidden")) return true;
  return attribute(element, "aria-hidden") === "true";
}

function isElement(node: Node): node is Element {
  return !node.nodeName.startsWith("#");
}

function locationOf(node: Node): Location | null {
  const located = node as Node & { sourceCodeLocation?: Location | null };
  return located.sourceCodeLocation ?? null;
}

function rangeOf(node: Node): LineRange | null {
  const location = locationOf(node);
  if (location === null) return null;
  return {
    start_line: location.startLine,
    end_line: location.endLine,
  };
}

function textOf(node: Node): string {
  if (node.nodeName === "#text") return (node as TextNode).value;
  if (!isElement(node)) return "";
  return node.childNodes.map(textOf).join("");
}

function documentTitle(root: Node): string | null {
  let title: string | null = null;
  const visit = (node: Node): void => {
    if (isElement(node) && node.tagName === "title" && title === null) {
      title = textOf(node).replace(/\s+/g, " ").trim();
    }
    const kids = (node as { childNodes?: Node[] }).childNodes ?? [];
    for (const child of kids) visit(child);
  };
  visit(root);
  return title === null || title === "" ? null : title;
}

function headingAnchor(
  element: Element,
  claimed: Set<Element>,
): string | null {
  const own = attribute(element, "id");
  if (own !== null && own.length > 0) return own;
  let parent = element.parentNode;
  while (parent !== null && isElement(parent)) {
    if (parent.tagName === "section") {
      const id = attribute(parent, "id");
      if (id !== null && id.length > 0 && !claimed.has(parent)) {
        claimed.add(parent);
        return id;
      }
      return null;
    }
    parent = parent.parentNode;
  }
  return null;
}

function collect(
  node: Node,
  inheritedHidden: boolean,
  claimed: Set<Element>,
  headings: HeadingSpan[],
  omitted: LineRange[],
): void {
  if (!isElement(node)) {
    const kids = (node as { childNodes?: Node[] }).childNodes ?? [];
    for (const child of kids) {
      collect(child, inheritedHidden, claimed, headings, omitted);
    }
    return;
  }
  const excluded = EXCLUDED.has(node.tagName) || inheritedHidden ||
    hidden(node);
  if (excluded) {
    const range = rangeOf(node);
    if (range !== null) omitted.push(range);
    return;
  }
  const match = HEADING.exec(node.tagName);
  if (match !== null) {
    const location = locationOf(node);
    const line = location?.startLine ?? 1;
    headings.push({
      title: textOf(node).replace(/\s+/g, " ").trim(),
      level: Number(match[1]),
      startLine: line,
      endLine: location?.endLine ?? line,
      anchor: headingAnchor(node, claimed),
    });
  }
  for (const child of node.childNodes) {
    collect(child, inheritedHidden, claimed, headings, omitted);
  }
}

// 정적 parse만 한다. script는 실행하지 않고 제외 구역은 본문에서 뺀다.
const XML_DECLARATION = /^<\?xml\b[^?]*\?>\s*/;

export function extractHtml(source: string): HtmlExtract {
  // HTML parser는 XML 선언을 만나면 나머지를 주석으로 버린다. 줄 수는 유지한다.
  const declaration = XML_DECLARATION.exec(source);
  const skipped = declaration?.[0] ?? "";
  const lineOffset = skipped.length === 0 ? 0 : skipped.split("\n").length - 1;
  const document = parse(source.slice(skipped.length), {
    sourceCodeLocationInfo: true,
  });
  const headings: HeadingSpan[] = [];
  const omitted: LineRange[] = [];
  collect(document, false, new Set(), headings, omitted);
  const shift = (line: number) => line + lineOffset;
  return {
    text: source,
    headings: headings.map((heading) => ({
      ...heading,
      startLine: shift(heading.startLine),
      endLine: shift(heading.endLine),
    })),
    omitted: omitted.map((range) => ({
      start_line: shift(range.start_line),
      end_line: shift(range.end_line),
    })),
    title: documentTitle(document),
  };
}
