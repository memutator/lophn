// Markdown 읽기 renderer가 그리는 값. React와 Lezer를 모르는 순수 데이터다.
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "emphasis" | "strong" | "strike"; children: Inline[] }
  | { kind: "code"; text: string }
  // href가 없으면 허용하지 않은 주소라 글로만 보인다.
  | { kind: "link"; href?: string; children: Inline[] }
  | { kind: "image"; src?: string; alt: string }
  | { kind: "break" };

export type Align = "left" | "center" | "right" | undefined;

export type Block =
  | { kind: "heading"; level: number; id: string; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "code"; language?: string; text: string }
  | { kind: "quote"; children: Block[] }
  | {
    kind: "list";
    ordered: boolean;
    start?: number;
    items: ListItem[];
  }
  | { kind: "rule" }
  // raw HTML은 실행하지 않고 원문 글로 보인다.
  | { kind: "html"; text: string }
  | {
    kind: "table";
    align: Align[];
    header: Inline[][];
    rows: Inline[][][];
  };

export interface ListItem {
  // task list 항목이면 체크 여부, 아니면 undefined.
  task?: boolean;
  children: Block[];
}

export interface OutlineItem {
  id: string;
  title: string;
  level: number;
}

export interface MarkdownDocument {
  blocks: Block[];
  outline: OutlineItem[];
}

export function plainText(inlines: readonly Inline[]): string {
  return inlines.map((inline) => {
    switch (inline.kind) {
      case "text":
      case "code":
        return inline.text;
      case "image":
        return inline.alt;
      case "break":
        return " ";
      default:
        return plainText(inline.children);
    }
  }).join("");
}

// 제목 id는 글자·숫자만 남긴 소문자 slug이고, 같은 문서 안에서 겹치면 -1, -2를 붙인다.
export function slugger(): (title: string) => string {
  const used = new Set<string>();
  return (title) => {
    const base = title.toLowerCase().normalize("NFKC")
      .replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/[\s-]+/g, "-") ||
      "section";
    let id = base;
    for (let count = 1; used.has(id); count += 1) id = `${base}-${count}`;
    used.add(id);
    return id;
  };
}
