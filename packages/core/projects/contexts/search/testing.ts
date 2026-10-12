// 검색 test가 같이 쓰는 fixture 읽기와 행 만들기.
import {
  type BundleContent,
  bundleContentSchema,
} from "../../../../protocol/projects/mod.ts";
import type { Row, SearchEntity } from "./types.ts";

const testdata = new URL("../testdata/", import.meta.url);

export function fixtureBundle(): BundleContent {
  return bundleContentSchema.parse(
    JSON.parse(
      Deno.readTextFileSync(new URL("eval-project.contract.json", testdata)),
    ),
  );
}

// 추출 정답 그대로(추출 순서).
export function fixtureEntities(): SearchEntity[] {
  return JSON.parse(
    Deno.readTextFileSync(
      new URL("expected/eval-project.entities.json", testdata),
    ),
  );
}

export function entityOf(
  entities: readonly SearchEntity[],
  type: string,
  key: string,
): { entity: SearchEntity; index: number } {
  const index = entities.findIndex((e) => e.type === type && e.key === key);
  if (index < 0) throw new Error(`no ${type} ${key}`);
  return { entity: entities[index], index };
}

export function rowOf(
  entities: readonly SearchEntity[],
  base: [string, string],
  aliases: Record<string, [string, string]> = {},
): Row {
  const b = entityOf(entities, ...base);
  return {
    base: b.entity,
    base_index: b.index,
    aliases: Object.fromEntries(
      Object.entries(aliases).map(([alias, ref]) => [
        alias,
        entityOf(entities, ...ref),
      ]),
    ),
  };
}

// 행을 짧게 비교한다: "Type:key" 또는 "Type:key+alias=Type:key".
export function brief(row: Row): string {
  const aliases = Object.entries(row.aliases).map(([alias, a]) =>
    `+${alias}=${a.entity.type}:${a.entity.key}`
  );
  return `${row.base.type}:${row.base.key}${aliases.join("")}`;
}
