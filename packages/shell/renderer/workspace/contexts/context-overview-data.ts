// Overview 카드와 화살표를 계약과 개수에서 뽑는다. 순서는 계약의 type·관계 순서를 그대로 따른다.
import type { BundleContent, ContextOverview } from "./source.ts";

export interface EntityCard {
  readonly name: string;
  /** 다른 context에서 온 개체면 그 context 이름. */
  readonly from: string | null;
  readonly meaning: string;
  /** 다른 context에서 온 개체는 개수를 모른다. */
  readonly count: number | null;
  /** 가진 것: key field와 관계를 잇는 field를 뺀 field 이름, 계약의 field 순서. */
  readonly has: readonly string[];
  readonly example: { readonly key: string; readonly path: string } | null;
}

export interface EntityEdge {
  readonly from: string;
  readonly to: string;
  readonly label: string;
}

export interface OverviewModel {
  readonly cards: readonly EntityCard[];
  readonly edges: readonly EntityEdge[];
}

type Contract = BundleContent["contract"];

/** 계약의 type 순서 뒤에 다른 context에서 온 개체를 처음 나온 순서로 붙인다. */
export function buildOverviewModel(
  contract: BundleContent | null,
  overview: ContextOverview,
): OverviewModel {
  const counts = new Map(overview.types.map((it) => [it.type, it.count]));
  if (contract === null) {
    return {
      cards: overview.types.map((it) => ({
        name: it.type,
        from: null,
        meaning: "",
        count: it.count,
        has: [],
        example: null,
      })),
      edges: [],
    };
  }
  const types: Contract["types"] = contract.contract.types;
  const inside = new Set(types.map((type) => type.name));
  const outside = new Map<string, string>();
  const edges: EntityEdge[] = [];
  for (const type of types) {
    for (const relation of type.relations) {
      const slash = relation.to.lastIndexOf("/");
      const target = relation.to.slice(slash + 1);
      if (slash >= 0) {
        if (!outside.has(target)) {
          outside.set(target, relation.to.slice(0, slash));
        }
      } else if (!inside.has(target)) {
        continue;
      }
      edges.push({ from: type.name, to: target, label: relation.label });
    }
  }
  const cards: EntityCard[] = types.map((type) => {
    const linking = new Set(type.relations.map((relation) => relation.via));
    const example = contract.examples.find((item) =>
      item.kind === "entity" && item.expect.type === type.name
    );
    return {
      name: type.name,
      from: null,
      meaning: type.summary,
      count: counts.get(type.name) ?? 0,
      has: type.fields
        .map((field) => field.name)
        .filter((name) => name !== type.key && !linking.has(name)),
      example: example?.kind === "entity"
        ? { key: example.expect.key, path: example.path }
        : null,
    };
  });
  for (const [name, context] of outside) {
    cards.push({
      name,
      from: context,
      meaning: "",
      count: null,
      has: [],
      example: null,
    });
  }
  return { cards, edges };
}
