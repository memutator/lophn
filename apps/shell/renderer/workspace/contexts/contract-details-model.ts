// Contract 탭이 그릴 값: 적용된 판의 계약 내용, 개체 수, 검사 보고를 화면이 쓸 모양으로 바꾼다.
// 글(t())은 화면 파일이 고른다. 이 파일은 글 없이 값만 만든다.
import type {
  BundleContent,
  ContractField,
  ContractSource,
  ContractType,
  DeclaredSearch,
} from "../../../../../packages/contracts/documents/context-contract.ts";
import type { BundleEntry, ContextOverview } from "./source.ts";

export interface FieldLine {
  readonly name: string;
  /** enum 값을 " | "로 이은 글. enum이 아니면 null. */
  readonly values: string | null;
  /** section에서 온 field의 heading. 아니면 null. */
  readonly section: string | null;
  readonly isPublic: boolean;
}

export interface RelationLine {
  readonly name: string;
  /** 다른 context의 type이면 `eval.Scenario`처럼 점으로 이은 이름. */
  readonly target: string;
  readonly isPublic: boolean;
}

export interface TypeCardModel {
  readonly name: string;
  readonly isPublic: boolean;
  readonly kind: ContractSource["kind"];
  readonly path: string;
  /** overview에 개수가 없으면 null. */
  readonly count: number | null;
  /** key와 관계 field는 뺀다. */
  readonly fields: readonly FieldLine[];
  readonly relations: readonly RelationLine[];
}

export interface GraphNode {
  /** 노드를 가리키는 안정된 이름: 이 context의 type은 type 이름, 다른 context의 type은 `eval/Scenario`. */
  readonly key: string;
  /** data 속성에 쓰는 type 이름(`Scenario`). */
  readonly name: string;
  /** 그림 안에 적는 글(`eval.Scenario`). */
  readonly label: string;
  readonly external: boolean;
}

export interface GraphEdge {
  /** GraphNode.key. */
  readonly from: string;
  readonly to: string;
  /** 도착 노드가 다른 context의 type이면 true. */
  readonly external: boolean;
}

export interface SearchRow {
  readonly title: string;
  readonly name: string;
  readonly pass: number;
  readonly fail: number;
}

export interface ContractModel {
  readonly types: readonly TypeCardModel[];
  readonly graph: {
    readonly nodes: readonly GraphNode[];
    readonly edges: readonly GraphEdge[];
  };
  readonly searches: readonly SearchRow[];
}

export function buildContractModel(
  content: BundleContent,
  overview: ContextOverview["types"],
  bundles: readonly BundleEntry[],
): ContractModel {
  const counts = new Map(
    overview.map((item) => [item.type, item.count] as const),
  );
  // 예시 검사 결과는 적용된 판의 검사 보고에서 온다.
  const applied = bundles.find((entry) => entry.bundle.status === "applied");
  const failed = new Set(
    (applied?.check?.findings ?? []).flatMap((finding) =>
      finding.kind === "example_mismatch" && finding.target !== null
        ? [finding.target]
        : []
    ),
  );
  return {
    types: content.contract.types.map((type) =>
      typeCard(type, counts.get(type.name) ?? null)
    ),
    graph: buildGraph(content.contract.types),
    searches: content.searches.map((search) =>
      searchRow(search, content.examples, failed)
    ),
  };
}

/** type 참조를 그림과 관계 글에 쓰는 이름으로 바꾼다: `harness/Change` → `harness.Change`. */
export function displayRef(ref: string): string {
  return ref.replace("/", ".");
}

/** type 참조에서 type 이름만 뽑는다: `harness/Change` → `Change`. */
function refName(ref: string): string {
  return ref.slice(ref.indexOf("/") + 1);
}

export function sourcePath(source: ContractSource): string {
  switch (source.kind) {
    case "folder":
      return `${source.root}/${source.child_pattern}`;
    case "docs":
      return source.paths.join(", ");
    case "series":
      return source.pattern;
    case "index":
      return source.document;
    case "section":
    case "outline":
      return source.documents?.join(", ") ?? source.from_type ?? "";
    case "app-data":
      return `${source.app} ${source.command}`;
  }
}

function typeCard(type: ContractType, count: number | null): TypeCardModel {
  const vias = new Set(type.relations.map((relation) => relation.via));
  return {
    name: type.name,
    isPublic: type.visibility === "public",
    kind: type.source.kind,
    path: sourcePath(type.source),
    count,
    fields: type.fields
      .filter((field) => field.name !== type.key && !vias.has(field.name))
      .map(fieldLine),
    relations: type.relations.map((relation) => ({
      name: relation.name,
      target: displayRef(relation.to),
      isPublic: relation.visibility === "public",
    })),
  };
}

function fieldLine(field: ContractField): FieldLine {
  return {
    name: field.name,
    values: field.values === undefined ? null : field.values.join(" | "),
    section: field.from.kind === "section" ? field.from.heading : null,
    isPublic: field.visibility === "public",
  };
}

function buildGraph(types: readonly ContractType[]): ContractModel["graph"] {
  const nodes = new Map<string, GraphNode>();
  for (const type of types) {
    nodes.set(type.name, {
      key: type.name,
      name: type.name,
      label: type.name,
      external: false,
    });
  }
  const edges: GraphEdge[] = [];
  for (const type of types) {
    for (const relation of type.relations) {
      const external = relation.to.includes("/");
      if (!nodes.has(relation.to)) {
        nodes.set(relation.to, {
          key: relation.to,
          name: refName(relation.to),
          label: displayRef(relation.to),
          external,
        });
      }
      edges.push({ from: type.name, to: relation.to, external });
    }
  }
  return { nodes: [...nodes.values()], edges };
}

function searchRow(
  search: DeclaredSearch,
  examples: BundleContent["examples"],
  failed: ReadonlySet<string>,
): SearchRow {
  const indexes = examples.flatMap((example, index) =>
    example.kind === "search" && example.search === search.name ? [index] : []
  );
  const fail =
    indexes.filter((index) => failed.has(`examples.${index}`)).length;
  return {
    title: search.title,
    name: search.name,
    pass: indexes.length - fail,
    fail,
  };
}
