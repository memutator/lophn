// 시작 type의 개체로 행을 만들고 follow로 별칭 개체를 붙인다(inner join).
import type {
  Contract,
  SearchFollow,
  SearchQuery,
} from "../../../contracts/documents/mod.ts";
import type { InputValues, Row, SearchEntity } from "./types.ts";
import { evaluate } from "./where.ts";

type Hit = { entity: SearchEntity; index: number };

function hasLink(entity: SearchEntity, relation: string, targetKey?: string) {
  return entity.links.some((link) =>
    link.relation === relation &&
    (targetKey === undefined || link.target_key === targetKey)
  );
}

// 출발 개체에서 relation으로 닿는 개체를 추출 순서대로 모은다.
function matches(
  follow: SearchFollow,
  source: SearchEntity,
  contract: Contract,
  entities: readonly SearchEntity[],
): Hit[] {
  const hits: Hit[] = [];
  if (follow.direction === "forward") {
    const declared = contract.types
      .find((type) => type.name === source.type)
      ?.relations.find((relation) => relation.name === follow.relation);
    if (declared === undefined) return hits;
    const targets = new Set(
      source.links.filter((link) => link.relation === follow.relation)
        .map((link) => link.target_key),
    );
    entities.forEach((entity, index) => {
      if (entity.type === declared.to && targets.has(entity.key)) {
        hits.push({ entity, index });
      }
    });
    return hits;
  }
  const declaring = new Set(
    contract.types
      .filter((type) =>
        type.relations.some((relation) =>
          relation.name === follow.relation && relation.to === source.type
        )
      )
      .map((type) => type.name),
  );
  entities.forEach((entity, index) => {
    if (
      declaring.has(entity.type) &&
      hasLink(entity, follow.relation, source.key)
    ) {
      hits.push({ entity, index });
    }
  });
  return hits;
}

export function expandFollows(
  query: SearchQuery,
  contract: Contract,
  entities: readonly SearchEntity[],
  inputs: InputValues,
): Row[] {
  let rows: Row[] = [];
  entities.forEach((entity, index) => {
    if (entity.type === query.from) {
      rows.push({ base: entity, base_index: index, aliases: {} });
    }
  });
  for (const follow of query.follow) {
    const next: Row[] = [];
    for (const row of rows) {
      const source = follow.from === undefined
        ? row.base
        : row.aliases[follow.from]?.entity;
      if (source === undefined) continue;
      for (const hit of matches(follow, source, contract, entities)) {
        const candidate: Row = {
          ...row,
          aliases: { ...row.aliases, [follow.as]: hit },
        };
        if (
          follow.where === undefined ||
          evaluate(follow.where, candidate, inputs)
        ) {
          next.push(candidate);
        }
      }
    }
    rows = next;
  }
  return rows;
}
