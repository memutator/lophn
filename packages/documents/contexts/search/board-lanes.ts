// board lane의 순서: board_by가 enum field면 선언 순서, 아니면 값의 code unit 순.
import type {
  Contract,
  SearchQuery,
} from "../../../contracts/documents/mod.ts";

// board_by path가 가리키는 enum field의 선언 값. enum이 아니거나 풀 수 없으면 undefined.
export function declaredValues(
  contract: Contract,
  query: SearchQuery,
  path: string,
): readonly string[] | undefined {
  const dot = path.indexOf(".");
  const typeName = dot < 0
    ? query.from
    : aliasType(contract, query, path.slice(0, dot));
  if (typeName === undefined) return undefined;
  const field = dot < 0 ? path : path.slice(dot + 1);
  const found = contract.types.find((t) => t.name === typeName)?.fields.find((
    f,
  ) => f.name === field);
  return found?.value_type === "enum" ? found.values : undefined;
}

// 별칭이 붙는 type 이름. 다른 context의 type이거나 풀 수 없으면 undefined.
function aliasType(
  contract: Contract,
  query: SearchQuery,
  alias: string,
): string | undefined {
  const types = new Map<string, string | undefined>();
  for (const follow of query.follow) {
    const from = follow.from === undefined
      ? query.from
      : types.get(follow.from);
    types.set(follow.as, followTarget(contract, from, follow));
  }
  return types.get(alias);
}

function followTarget(
  contract: Contract,
  from: string | undefined,
  follow: SearchQuery["follow"][number],
): string | undefined {
  if (from === undefined) return undefined;
  if (follow.direction === "forward") {
    const to = contract.types.find((t) => t.name === from)?.relations.find((
      r,
    ) => r.name === follow.relation)?.to;
    return to === undefined || to.includes("/") ? undefined : to;
  }
  return contract.types.find((t) =>
    t.relations.some((r) => r.name === follow.relation && r.to === from)
  )?.name;
}

export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = typeof a === "string" ? a : JSON.stringify(a);
  const y = typeof b === "string" ? b : JSON.stringify(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
