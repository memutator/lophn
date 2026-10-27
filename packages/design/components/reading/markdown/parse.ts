// Lezer Markdown(편집기와 같은 parser)의 tree를 읽기 renderer의 순수 값으로 바꾼다.
// HTML은 해석하지 않고 원문 글로 남기며, link·image 주소는 safeUrl을 통과한 것만 쓴다.
import { GFM, parser } from "@lezer/markdown";
import {
  type Align,
  type Block,
  type Inline,
  type ListItem,
  type MarkdownDocument,
  type OutlineItem,
  plainText,
  slugger,
} from "./model.ts";
import { decodeEntity, unescapeText } from "./text.ts";
import { safeUrl } from "./url.ts";

const markdown = parser.configure([GFM]);

type Node = ReturnType<typeof markdown.parse>["topNode"];

export interface ParseOptions {
  // 문서 기준 상대 image 주소를 실제 주소로 바꾼다. 없으면 상대 image는 alt 글로만 보인다.
  resolveImage?: (relative: string) => string | undefined;
}

// 글 사이에 끼어 화면에 보이지 않는 표지 node.
const MARKS = new Set([
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "StrikethroughMark",
  "TableDelimiter",
  "TaskMarker",
  "LinkLabel",
  "LinkTitle",
  "CodeInfo",
]);

function childNodes(node: Node): Node[] {
  const found: Node[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    found.push(child);
  }
  return found;
}

function normalizeLabel(label: string): string {
  return label.slice(1, -1).trim().replace(/\s+/g, " ").toLowerCase();
}

class Reader {
  readonly references = new Map<string, string>();
  readonly outline: OutlineItem[] = [];
  readonly slug = slugger();
  readonly source: string;
  readonly options: ParseOptions;

  constructor(source: string, options: ParseOptions) {
    this.source = source;
    this.options = options;
  }

  text(node: Node): string {
    return this.source.slice(node.from, node.to);
  }

  collectReferences(node: Node): void {
    for (const child of childNodes(node)) {
      if (child.name === "LinkReference") {
        const label = child.getChild("LinkLabel");
        const url = child.getChild("URL");
        const key = label && normalizeLabel(this.text(label));
        if (key && url && !this.references.has(key)) {
          this.references.set(key, this.urlText(url));
        }
      } else if (child.firstChild) this.collectReferences(child);
    }
  }

  urlText(node: Node): string {
    const raw = this.text(node);
    const bare = raw.startsWith("<") && raw.endsWith(">")
      ? raw.slice(1, -1)
      : raw;
    return unescapeText(bare);
  }

  // node 안의 [from, to) 범위를 글과 inline node로 나눈다.
  inlines(node: Node, from = node.from, to = node.to): Inline[] {
    const out: Inline[] = [];
    let at = from;
    const pushText = (text: string) => {
      if (text === "") return;
      const last = out[out.length - 1];
      if (last?.kind === "text") last.text += text;
      else out.push({ kind: "text", text });
    };
    for (const child of childNodes(node)) {
      if (child.to <= from || child.from >= to) continue;
      pushText(this.source.slice(at, child.from));
      at = child.to;
      const inline = this.inline(child, pushText);
      if (inline) out.push(inline);
    }
    pushText(this.source.slice(at, to));
    return out;
  }

  inline(node: Node, pushText: (text: string) => void): Inline | undefined {
    switch (node.name) {
      case "Emphasis":
        return { kind: "emphasis", children: this.inlines(node) };
      case "StrongEmphasis":
        return { kind: "strong", children: this.inlines(node) };
      case "Strikethrough":
        return { kind: "strike", children: this.inlines(node) };
      case "InlineCode": {
        const marks = node.getChildren("CodeMark");
        const from = marks[0]?.to ?? node.from;
        const to = marks[1]?.from ?? node.to;
        return { kind: "code", text: this.source.slice(from, to) };
      }
      case "Link":
        return this.link(node);
      case "Image":
        return this.image(node);
      case "URL":
      case "Autolink": {
        const url = node.name === "URL" ? node : node.getChild("URL");
        const raw = url ? this.urlText(url) : this.text(node);
        return {
          kind: "link",
          href: safeUrl(raw, "link"),
          children: [{ kind: "text", text: raw }],
        };
      }
      case "HardBreak":
        return { kind: "break" };
      case "Escape":
        pushText(this.text(node).slice(1));
        return undefined;
      case "Entity":
        pushText(decodeEntity(this.text(node)));
        return undefined;
      default:
        // HTMLTag·Comment 같은 raw HTML은 원문 그대로 글이다.
        if (!MARKS.has(node.name)) pushText(this.text(node));
        return undefined;
    }
  }

  // 대괄호 안 글의 범위와 주소(직접 또는 reference)를 찾는다.
  target(node: Node): { from: number; to: number; raw?: string } {
    const marks = node.getChildren("LinkMark");
    const from = marks[0]?.to ?? node.from;
    const close = marks.find((mark) => this.text(mark) === "]");
    const to = close?.from ?? node.to;
    const url = node.getChild("URL");
    if (url) return { from, to, raw: this.urlText(url) };
    const label = node.getChild("LinkLabel");
    const key = label
      ? normalizeLabel(this.text(label))
      : normalizeLabel(`[${this.source.slice(from, to)}]`);
    return { from, to, raw: this.references.get(key) };
  }

  link(node: Node): Inline {
    const { from, to, raw } = this.target(node);
    const content = this.inlines(node, from, to);
    if (raw === undefined) {
      // 정의가 없는 reference는 link가 아니라 원문 대괄호 글이다.
      return {
        kind: "link",
        children: [
          { kind: "text", text: this.source.slice(node.from, from) },
          ...content,
          { kind: "text", text: this.source.slice(to, node.to) },
        ],
      };
    }
    return { kind: "link", href: safeUrl(raw, "link"), children: content };
  }

  image(node: Node): Inline {
    const { from, to, raw } = this.target(node);
    return {
      kind: "image",
      src: raw === undefined
        ? undefined
        : safeUrl(raw, "image", this.options.resolveImage),
      alt: plainText(this.inlines(node, from, to)),
    };
  }

  blocks(node: Node): Block[] {
    const out: Block[] = [];
    for (const child of childNodes(node)) {
      const block = this.block(child);
      if (block) out.push(block);
    }
    return out;
  }

  block(node: Node): Block | undefined {
    const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);
    if (heading) return this.heading(node, Number(heading[1]));
    switch (node.name) {
      case "Paragraph":
        return { kind: "paragraph", children: this.inlines(node) };
      case "FencedCode":
      case "CodeBlock": {
        const info = node.getChild("CodeInfo");
        const text = node.getChildren("CodeText").map((part) => this.text(part))
          .join("");
        // fence info는 언어 이름 뒤에 옵션을 더 쓸 수 있다(```ts title=app.ts). label은 첫 낱말만 쓴다.
        const language = info
          ? unescapeText(this.text(info)).trim().split(/\s+/)[0] || undefined
          : undefined;
        return { kind: "code", language, text };
      }
      case "Blockquote":
        return { kind: "quote", children: this.blocks(node) };
      case "BulletList":
      case "OrderedList":
        return this.list(node);
      case "HorizontalRule":
        return { kind: "rule" };
      case "HTMLBlock":
      case "CommentBlock":
      case "ProcessingInstructionBlock":
        return { kind: "html", text: this.text(node) };
      case "Table":
        return this.table(node);
      default:
        return undefined;
    }
  }

  heading(node: Node, level: number): Block {
    const content = this.inlines(node);
    trimEdges(content);
    const title = plainText(content);
    const id = this.slug(title);
    this.outline.push({ id, title, level });
    return { kind: "heading", level, id, children: content };
  }

  list(node: Node): Block {
    const ordered = node.name === "OrderedList";
    const items: ListItem[] = node.getChildren("ListItem").map((item) => {
      const task = item.getChild("Task");
      if (!task) return { children: this.blocks(item) };
      const marker = task.getChild("TaskMarker");
      // Task node는 첫 문단만 대신한다. 이어지는 문단·하위 목록·인용·code는 원래 순서대로 남긴다.
      const children: Block[] = [];
      for (const child of childNodes(item)) {
        if (child.name === "Task") {
          const content = this.inlines(task, marker?.to ?? task.from, task.to);
          trimEdges(content);
          children.push({ kind: "paragraph", children: content });
        } else {
          const block = this.block(child);
          if (block) children.push(block);
        }
      }
      return {
        task: marker ? /x/i.test(this.text(marker)) : false,
        children,
      };
    });
    const mark = node.getChild("ListItem")?.getChild("ListMark");
    const start = ordered && mark
      ? Number.parseInt(this.text(mark), 10)
      : undefined;
    return { kind: "list", ordered, start, items };
  }

  table(node: Node): Block {
    const cells = (row: Node | null) =>
      (row?.getChildren("TableCell") ?? []).map((cell) => {
        const content = this.inlines(cell);
        trimEdges(content);
        return content;
      });
    const delimiter = childNodes(node).find((child) =>
      child.name === "TableDelimiter"
    );
    const align: Align[] = delimiter
      ? this.text(delimiter).replace(/^\||\|$/g, "").split("|").map((part) => {
        const spec = part.trim();
        if (spec.startsWith(":") && spec.endsWith(":")) return "center";
        if (spec.endsWith(":")) return "right";
        if (spec.startsWith(":")) return "left";
        return undefined;
      })
      : [];
    return {
      kind: "table",
      align,
      header: cells(node.getChild("TableHeader")),
      rows: node.getChildren("TableRow").map((row) => cells(row)),
    };
  }
}

function trimEdges(content: Inline[]): void {
  const first = content[0];
  if (first?.kind === "text") first.text = first.text.trimStart();
  const last = content[content.length - 1];
  if (last?.kind === "text") last.text = last.text.trimEnd();
}

export function parseMarkdown(
  source: string,
  options: ParseOptions = {},
): MarkdownDocument {
  const reader = new Reader(source, options);
  const top = markdown.parse(source).topNode;
  reader.collectReferences(top);
  const blocks = reader.blocks(top);
  return { blocks, outline: reader.outline };
}
