import {
  CONTEXT_TEXT_TAG,
  type ContextText,
  type ContextTextLevel,
  contextTextSchema,
} from "../../../protocol/lophn-agent/context-text.ts";
import { toWireToolName } from "../../../protocol/lophn-agent/tool-catalog.ts";
import { escapeTagBody, scrubAttribute } from "./input-tags.ts";

// context 글이다. 적용된 판에서 결정적으로 조립하고 계약 원문(자료 위치, 읽는 방식, 값 type, rule,
// 검색 script)은 넣지 않는다. 호출하는 쪽이 core 읽기로 `ContextRead`를 모으고 이 파일은 글만 만든다.

export type FolderRead = { path: string; description: string };

export type ContextRead = {
  name: string;
  // 적용된 판 번호
  version: number;
  purpose: string;
  project: {
    name: string;
    purpose: string;
    folders: readonly FolderRead[];
    subfolders: readonly FolderRead[];
  };
  // 계약의 type. 다른 context의 type을 가리키는 `to`는 이미 `context/Type` 꼴이다.
  types: readonly {
    name: string;
    summary: string;
    fields: readonly { name: string }[];
    relations: readonly {
      label: string;
      to: string;
      cardinality: "one" | "optional" | "many";
    }[];
  }[];
  searches: readonly {
    name: string;
    title: string;
    inputs: readonly { name: string; required: boolean }[];
  }[];
  glossary: readonly { term: string; meaning: string }[];
};

// 코드 단위 순서다. locale에 기대지 않는다.
function byKey<T>(key: (item: T) => string) {
  return (a: T, b: T) => {
    const x = key(a);
    const y = key(b);
    return x < y ? -1 : x > y ? 1 : 0;
  };
}

function sorted<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort(byKey(key));
}

// 같은 판이면 입력 배열 순서와 상관없이 같은 값이다.
export function buildContextText(read: ContextRead): ContextText {
  return contextTextSchema.parse({
    name: read.name,
    version: `r${read.version}`,
    purpose: read.purpose,
    project: {
      name: read.project.name,
      purpose: read.project.purpose,
      folders: sorted(read.project.folders, (f) => f.path),
      subfolders: sorted(read.project.subfolders, (f) => f.path),
    },
    types: sorted(read.types, (t) => t.name).map((type) => ({
      name: type.name,
      summary: type.summary,
      fields: sorted(type.fields, (f) => f.name).map((f) => f.name),
      relations: sorted(
        type.relations,
        (r) => `${r.label}\0${r.to}`,
      ).map((r) => ({
        label: r.label,
        target: r.to,
        count: r.cardinality === "many" ? "many" : "one",
      })),
    })),
    searches: sorted(read.searches, (s) => s.name).map((search) => ({
      name: search.name,
      inputs: sorted(search.inputs, (i) => i.name).map((i) => ({
        name: i.name,
        optional: !i.required,
      })),
      description: search.title,
    })),
    glossary: sorted(read.glossary, (g) => g.term),
  });
}

function folderLine(folder: FolderRead): string {
  return `${folder.path} (${folder.description})`;
}

function projectLines(project: ContextText["project"]): string[] {
  const lines = [`Project: ${project.name}. ${project.purpose}`];
  if (project.folders.length > 0) {
    lines.push(`  Folders: ${project.folders.map(folderLine).join(", ")}`);
  }
  for (const folder of project.subfolders) {
    lines.push(`    ${folderLine(folder)}`);
  }
  return lines;
}

function fullLines(text: ContextText, withProject: boolean): string[] {
  const lines = [`Purpose: ${text.purpose}`];
  if (withProject) lines.push(...projectLines(text.project));
  lines.push("Types");
  for (const type of text.types) {
    const fields = type.fields.length > 0
      ? ` Fields: ${type.fields.join(", ")}.`
      : "";
    const summary = type.summary.endsWith(".")
      ? type.summary
      : `${type.summary}.`;
    lines.push(`- ${type.name}: ${summary}${fields}`);
    if (type.relations.length > 0) {
      lines.push(
        `  Relations: ${
          type.relations.map((r) => `${r.label} → ${r.target} (${r.count})`)
            .join(", ")
        }`,
      );
    }
  }
  if (text.searches.length > 0) {
    lines.push("Searches");
    for (const search of text.searches) {
      const inputs = search.inputs
        .map((i) => i.optional ? `${i.name}?` : i.name).join(", ");
      lines.push(`- ${search.name}(${inputs}): ${search.description}`);
    }
  }
  if (text.glossary.length > 0) {
    lines.push("Glossary");
    for (const entry of text.glossary) {
      lines.push(`- ${entry.term}: ${entry.meaning}`);
    }
  }
  return lines;
}

// `names`는 목적과 type 이름만, `count`는 개수와 읽는 tool 안내만 쓴다.
// `project: false`는 place 정보가 같은 project 줄을 이미 가질 때 한 번만 두려는 것이다.
export function renderContextText(
  text: ContextText,
  level: ContextTextLevel,
  options: { project?: boolean } = {},
): string {
  let lines: string[];
  if (level === "full") {
    lines = fullLines(text, options.project ?? true);
  } else if (level === "names") {
    lines = [
      `Purpose: ${text.purpose}`,
      `Types: ${text.types.map((t) => t.name).join(", ")}`,
    ];
  } else {
    lines = [
      `${text.types.length} types, ${text.searches.length} searches, ${text.glossary.length} glossary terms. Read it with ${
        toWireToolName("context.get")
      }.`,
    ];
  }
  const attrs = ` name="${scrubAttribute(text.name)}" version="${
    scrubAttribute(text.version)
  }"`;
  return `<${CONTEXT_TEXT_TAG}${attrs}>\n${
    escapeTagBody(lines.join("\n"))
  }\n</${CONTEXT_TEXT_TAG}>`;
}
