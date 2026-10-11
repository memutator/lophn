// 출처 kind별로 field가 쓸 수 있는 FieldFrom과 path capture 이름. docs/domain-model/documents/contexts.md의 Field 표를 옮긴 것이다.
import type {
  ContextSourceKind,
  ContractSource,
  FieldFrom,
} from "../../../contracts/documents/mod.ts";

type FromKind = FieldFrom["kind"];

const DOCUMENT_FROMS: readonly FromKind[] = [
  "frontmatter",
  "yaml",
  "section",
  "path",
  "title",
  "links",
  "outline",
];

const FROMS_BY_SOURCE: Record<ContextSourceKind, readonly FromKind[]> = {
  folder: ["path", "yaml"],
  docs: DOCUMENT_FROMS,
  series: DOCUMENT_FROMS,
  index: DOCUMENT_FROMS,
  section: ["path", "title", "section", "links", "outline"],
  outline: ["path", "title"],
  "app-data": ["item"],
};

// 번호 자리의 이름. documents/series의 번호 자리 문법 `{(n|major|minor|patch)(([+-])(\d+))?(:(\d+))?}`에서 온다.
const PLACEHOLDER = /\{(n|major|minor|patch)(?=[+\-:}])/g;

// 출처가 from을 쓸 수 있는지. folder의 yaml은 file 유무를 여기서 보지 않는다(yaml_file_required가 본다).
export function fromAllowed(source: ContractSource, from: FieldFrom): boolean {
  if (!FROMS_BY_SOURCE[source.kind].includes(from.kind)) return false;
  if (from.kind !== "yaml" || source.kind === "folder") return true;
  // 문서 출처의 yaml은 file 없이 개체 문서를 읽는다.
  return from.file === undefined;
}

// path가 잡을 수 있는 이름. path를 쓸 수 없는 출처는 빈 목록이다.
export function pathCaptures(source: ContractSource): readonly string[] {
  switch (source.kind) {
    case "series": {
      const placeholders = [...source.pattern.matchAll(PLACEHOLDER)].map((
        match,
      ) => match[1]);
      return [...placeholders, "file", "path"];
    }
    case "folder":
      return ["folder", "path"];
    case "docs":
    case "index":
    case "section":
    case "outline":
      return ["file", "path"];
    case "app-data":
      return [];
  }
}
