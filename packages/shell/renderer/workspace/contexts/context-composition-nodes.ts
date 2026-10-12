// Composition 트리의 모양을 계약에서 만든다. 화면에 나가는 글만 만들고 계약 말(kind·public)은 쓰지 않는다.
import { t } from "@lophn/wording";

import type { BundleContent, ContextOverview, ContextValue } from "./source.ts";

export interface CompositionNode {
  readonly id: string;
  readonly label: string;
  readonly children?: readonly CompositionNode[];
}

type ContractType = BundleContent["contract"]["types"][number];
type ContractField = ContractType["fields"][number];

/** 개체 줄의 자료 경로와, 그 자료가 폴더인지(아니면 문서인지). */
function material(source: ContractType["source"]): {
  readonly path: string;
  readonly folders: boolean;
} {
  switch (source.kind) {
    case "folder":
      return { path: source.root, folders: true };
    case "series":
      return { path: parentOf(source.pattern), folders: false };
    case "docs":
      return { path: source.paths.join(", "), folders: false };
    case "index":
      return { path: source.document, folders: false };
    case "section":
    case "outline":
      return {
        path: source.documents?.join(", ") ?? source.from_type ?? "",
        folders: false,
      };
    case "app-data":
      return { path: source.app, folders: false };
  }
}

function parentOf(pattern: string): string {
  const cut = pattern.lastIndexOf("/");
  return cut < 0 ? pattern : pattern.slice(0, cut);
}

/** 가진 것: 개체의 key와 관계로 이어지는 값을 뺀 field. */
function owned(type: ContractType): readonly ContractField[] {
  const via = new Set(type.relations.map((relation) => relation.via));
  return type.fields.filter((field) =>
    field.name !== type.key && field.from.kind !== "links" &&
    !via.has(field.name)
  );
}

function fieldText(field: ContractField): string {
  return field.from.kind === "section"
    ? t("contexts.label.composition-from-section", {
      name: field.name,
      heading: field.from.heading,
    })
    : field.name;
}

/** "harness/Change" → { context: "harness", type: "Change" }. 같은 context의 type이면 context가 없다. */
function target(to: string): { context: string | null; type: string } {
  const cut = to.indexOf("/");
  return cut < 0
    ? { context: null, type: to }
    : { context: to.slice(0, cut), type: to.slice(cut + 1) };
}

function typeNode(
  type: ContractType,
  count: number,
  outside: Map<string, string[]>,
): CompositionNode {
  const { path, folders } = material(type.source);
  const children: CompositionNode[] = [];
  const fields = owned(type);
  if (fields.length > 0) {
    children.push({
      id: `${type.name}/has`,
      label: t("contexts.label.composition-has", {
        fields: fields.map(fieldText).join(" · "),
      }),
    });
  }
  const links = type.relations.map((relation) => {
    const to = target(relation.to);
    if (to.context === null) {
      return t("contexts.label.composition-link", {
        label: relation.label,
        target: to.type,
      });
    }
    const types = outside.get(to.context) ?? [];
    if (!types.includes(to.type)) types.push(to.type);
    outside.set(to.context, types);
    return t("contexts.label.composition-link-outside", {
      label: relation.label,
      target: to.type,
      context: to.context,
    });
  });
  if (links.length > 0) {
    children.push({
      id: `${type.name}/links`,
      label: t("contexts.label.composition-links", {
        links: links.join(" · "),
      }),
    });
  }
  return {
    id: type.name,
    label: t(
      folders
        ? "contexts.label.composition-folders"
        : "contexts.label.composition-documents",
      { type: type.name, count, path },
    ),
    ...(children.length > 0 ? { children } : {}),
  };
}

/** 뿌리(context 이름) 아래에 개체를 계약 순서로, 맨 뒤에 다른 context에서 쓰는 개체를 놓는다. */
export function compositionTree(
  context: ContextValue,
  contract: BundleContent | null,
  overview: ContextOverview,
): CompositionNode {
  const counts = new Map(
    overview.types.map((entry) => [entry.type, entry.count]),
  );
  const outside = new Map<string, string[]>();
  const types = contract?.contract.types ?? [];
  const children: CompositionNode[] = types.map((type) =>
    typeNode(type, counts.get(type.name) ?? 0, outside)
  );
  for (const [other, names] of outside) {
    children.push({
      id: `uses/${other}`,
      label: t("contexts.label.composition-uses", {
        context: other,
        types: names.join(", "),
      }),
    });
  }
  return { id: context.id, label: context.title, children };
}
