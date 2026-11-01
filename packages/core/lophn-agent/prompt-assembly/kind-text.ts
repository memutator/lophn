import {
  KIND_TEXT_TAG,
  type KindText,
  type KindTextLevel,
  kindTextSchema,
} from "../../../protocol/lophn-agent/kind-text.ts";
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
  fields: Record<
    string,
    {
      type: string;
      required?: boolean;
      list?: boolean;
      values?: readonly string[];
      to?: string;
    }
  >;
};

function kindEntries(
  kinds: readonly KindRead[],
): KindText["domains"][number]["kinds"] {
  return [...kinds]
    .sort((a, b) => cmp(a.name, b.name))
    .map((kind) => ({
      name: kind.name,
      summary: kind.summary,
      files: [...kind.files],
      key: kind.key,
      fields: Object.entries(kind.fields)
        .sort(([a], [b]) => cmp(a, b))
        .map(([name, field]) => ({
          name,
          type: field.type,
          required: field.required ?? false,
          list: field.list ?? false,
          detail:
            field.type === "enum"
              ? (field.values ?? []).join(", ")
              : field.type === "ref"
                ? (field.to ?? null)
                : null,
        })),
    }));
}

// domain 이름순으로 조립한다.
export function buildKindText(read: {
  domains: readonly {
    name: string;
    kinds: readonly KindRead[];
    warning: boolean;
  }[];
}): KindText {
  return kindTextSchema.parse({
    domains: [...read.domains]
      .sort((a, b) => cmp(a.name, b.name))
      .map((d) => ({
        domain: d.name,
        kinds: kindEntries(d.kinds),
        warning: d.warning,
      })),
  });
}

function fullLines(kinds: KindText["domains"][number]["kinds"]): string[] {
  const lines: string[] = [];
  for (const kind of kinds) {
    lines.push(`- ${kind.name}: ${kind.summary}`);
    lines.push(`  Files: ${kind.files.join(", ")}. Key: ${kind.key}.`);
    for (const field of kind.fields) {
      const detail = field.detail === null ? "" : ` (${field.detail})`;
      const flags = [field.required ? "required" : "", field.list ? "list" : ""]
        .filter((flag) => flag !== "")
        .join(", ");
      lines.push(
        `  - ${field.name}: ${field.type}${detail}${
          flags === "" ? "" : `, ${flags}`
        }`,
      );
    }
  }
  return lines;
}

// 글은 `Domain <name>` 머리 아래 domain마다 한 덩이다. level은 전체 예산에 걸려 모든 domain에 같이 쓴다.
// `names`는 kind 이름만, `count`는 개수와 읽는 명령 안내만 쓴다.
export function renderKindText(text: KindText, level: KindTextLevel): string {
  const lines: string[] = [];
  for (const { domain, kinds, warning } of text.domains) {
    lines.push(`Domain ${domain}`);
    if (level === "full") lines.push(...fullLines(kinds));
    else if (level === "names") {
      lines.push(`Kinds: ${kinds.map((k) => k.name).join(", ")}`);
    } else {
      lines.push(
        `${kinds.length} kinds. Inspect them with \`lophn kind check\` and read documents with \`lophn kind list\`.`,
      );
    }
    if (warning) {
      lines.push(
        "The kinds file has errors; `lophn kind check` lists them. The previous version is in use.",
      );
    }
  }
  return `<${KIND_TEXT_TAG}>\n${escapeTagBody(
    lines.join("\n"),
  )}\n</${KIND_TEXT_TAG}>`;
}
