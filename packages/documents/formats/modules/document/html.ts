import { parse, type DefaultTreeAdapterTypes } from "npm:parse5@8.0.1";
import type { HeadingSpan } from "../../pure/sections.ts";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type TextNode = DefaultTreeAdapterTypes.TextNode;

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
  title: string | null;
};

type Cursor = { line: number; column: number };

function advance(cursor: Cursor, value: string): void {
  for (const character of value) {
    if (character === "\n") {
      cursor.line += 1;
      cursor.column = 1;
    } else cursor.column += 1;
  }
}

function attribute(element: Element, name: string): string | null {
  const found = element.attrs.find((item) => item.name === name);
  return found === undefined ? null : found.value;
}

function hidden(element: Element): boolean {
  if (element.attrs.some((item) => item.name === "hidden")) return true;
  return attribute(element, "aria-hidden") === "true";
}

function isElement(node: Node): node is Element {
  return node.nodeName !== "#text" && node.nodeName !== "#comment" &&
    node.nodeName !== "#documentType" && node.nodeName !== "#document" &&
    node.nodeName !== "#document-fragment";
}

function textOf(node: Node): string {
  if (node.nodeName === "#text") return (node as TextNode).value;
  if (!isElement(node)) return "";
  return node.childNodes.map(textOf).join("");
}

function documentTitle(root: Node): string | null {
  let title: string | null = null;
  const visit = (node: Node): void => {
    if (!isElement(node)) return;
    if (node.tagName === "title" && title === null) {
      title = textOf(node).replace(/\s+/g, " ").trim();
    }
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return title === null || title.length === 0 ? null : title;
}

type Piece = { text: string; heading: Element | null };

function visiblePieces(
  node: Node,
  inheritedHidden: boolean,
  wrapperUsed: Set<Element>,
  out: Piece[],
): void {
  if (node.nodeName === "#text") {
    if (!inheritedHidden) out.push({ text: (node as TextNode).value, heading: null });
    return;
  }
  if (!isElement(node)) return;
  if (EXCLUDED.has(node.tagName) || inheritedHidden || hidden(node)) return;
  const heading = HEADING.test(node.tagName);
  if (heading) out.push({ text: "", heading: node });
  for (const child of node.childNodes) {
    visiblePieces(child, inheritedHidden, wrapperUsed, out);
  }
  if (heading) out.push({ text: "\n", heading: null });
}

function headingAnchor(
  element: Element,
  wrapperUsed: Map<Element, true>,
): string | null {
  const own = attribute(element, "id");
  if (own !== null && own.length > 0) return own;
  let parent = element.parentNode;
  while (parent !== null && isElement(parent)) {
    if (parent.tagName === "section") {
      const id = attribute(parent, "id");
      if (id !== null && id.length > 0 && !wrapperUsed.has(parent)) {
        wrapperUsed.set(parent, true);
        return id;
      }
      return null;
    }
    parent = parent.parentNode;
  }
  return null;
}

// 정적 parse만 한다. script·style·template·nav·textarea·head·title·pre·hidden은 본문에서 뺀다.
export function extractHtml(source: string): HtmlExtract {
  const document = parse(source);
  const pieces: Piece[] = [];
  const claimed = new Map<Element, true>();
  visiblePieces(document, false, new Set(), pieces);
  const cursor: Cursor = { line: 1, column: 1 };
  let text = "";
  const headings: HeadingSpan[] = [];
  for (const piece of pieces) {
    if (piece.heading !== null) {
      const title = textOf(piece.heading).replace(/\s+/g, " ").trim();
      const start = cursor.line;
      headings.push({
        title,
        level: Number(piece.heading.tagName.slice(1)),
        startLine: start,
        endLine: start,
        anchor: headingAnchor(piece.heading, claimed),
      });
      continue;
    }
    text += piece.text;
    advance(cursor, piece.text);
  }
  if (!text.endsWith("\n")) text += "\n";
  return { text, headings, title: documentTitle(document) };
}
