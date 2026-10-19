import {
  KIND_TEXT_TAG,
  type KindText,
  type KindTextLevel,
  kindTextSchema,
} from "../../../protocol/lophn-agent/kind-text.ts";
import { toWireToolName } from "../../../protocol/lophn-agent/tool-catalog.ts";
import { escapeTagBody } from "./input-tags.ts";

// kind 글이다. 쓰고 있는 kinds 파일에서 결정적으로 조립한다. 같은 prefix가 turn마다 같아야 cache가 맞는다.

export type FolderRead = { path: string; description: string };

// 코드 단위 순서다. locale에 기대지 않는다.
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// protocol/projects의 `Kind`와 같은 모양이다(lophn-agent는 domain protocol을 import하지 않는다).
export type KindRead = {
  name: string;
  summary: string;
  files: readonly string[];
  key: string;
  fields: Record<string, {
    type: string;
    required?: boolean;
    list?: boolean;
    values?: readonly string[];
    to?: string;
  }>;
};

export function buildKindText(
  read: { kinds: readonly KindRead[]; warning: boolean },
): KindText {
  return kindTextSchema.parse({
    kinds: [...read.kinds].sort((a, b) => cmp(a.name, b.name)).map((kind) => ({
      name: kind.name,
      summary: kind.summary,
      files: kind.files,
      key: kind.key,
      fields: Object.entries(kind.fields).sort(([a], [b]) => cmp(a, b))
        .map(([name, field]) => ({
          name,
          type: field.type,
          required: field.required ?? false,
          list: field.list ?? false,
          detail: field.type === "enum"
            ? (field.values ?? []).join(", ")
            : field.type === "ref"
            ? field.to ?? null
            : null,
        })),
    })),
    warning: read.warning,
  });
}

function fullLines(text: KindText): string[] {
  const lines: string[] = [];
  for (const kind of text.kinds) {
    lines.push(`- ${kind.name}: ${kind.summary}`);
    lines.push(`  Files: ${kind.files.join(", ")}. Key: ${kind.key}.`);
    for (const field of kind.fields) {
      const detail = field.detail === null ? "" : ` (${field.detail})`;
      const flags = [field.required ? "required" : "", field.list ? "list" : ""]
        .filter((flag) => flag !== "").join(", ");
      lines.push(
        `  - ${field.name}: ${field.type}${detail}${
          flags === "" ? "" : `, ${flags}`
        }`,
      );
    }
  }
  return lines;
}

// `names`는 kind 이름만, `count`는 개수와 읽는 tool 안내만 쓴다.
export function renderKindText(text: KindText, level: KindTextLevel): string {
  let lines: string[];
  if (level === "full") lines = fullLines(text);
  else if (level === "names") {
    lines = [`Kinds: ${text.kinds.map((k) => k.name).join(", ")}`];
  } else {
    lines = [
      `${text.kinds.length} kinds. Inspect them with ${
        toWireToolName("kind.check")
      } and read documents with ${toWireToolName("kind.list")}.`,
    ];
  }
  if (text.warning) {
    lines.push(
      `The kinds file has errors; ${
        toWireToolName("kind.check")
      } lists them. The previous version is in use.`,
    );
  }
  return `<${KIND_TEXT_TAG}>\n${
    escapeTagBody(lines.join("\n"))
  }\n</${KIND_TEXT_TAG}>`;
}
