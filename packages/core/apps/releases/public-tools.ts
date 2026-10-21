// release가 지우는 공개 tool과, 그것을 다른 domain이 쓰는지의 판정. 막지 않고 준비 결과의 알림으로 싣는다.
// 비교 재료는 active release에 고정된 blueprint와 새 blueprint의 tool이다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { domainLookupPort } from "../../../protocol/domains/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type { Blueprint } from "../blueprint/mod.ts";
import { appToolUsers, usagePorts } from "../usage/mod.ts";
import { loadActiveBlueprint } from "./store.ts";

type Tool = Blueprint["tools"][number];

// 공개였던 tool이 사라졌거나 비공개가 됐으면 지운 것이다.
export function removedPublicOf(
  previous: readonly Tool[],
  next: readonly Tool[],
): string[] {
  const after = new Map(next.map((tool) => [tool.name, tool]));
  return previous
    .filter((tool) => tool.public && after.get(tool.name)?.public !== true)
    .map((tool) => tool.name)
    .sort();
}

// 지우는 공개 tool 가운데 다른 domain이 쓰는 것을 tool별로 묶는다. domain은 이름으로 낸다.
// 이전 active release가 없거나 지우는 tool이 없으면 비어 있다.
export function removedPublicToolsOf(
  tx: Pick<Tx, "sql" | "port">,
  app: string,
  nextTools: readonly Tool[],
): Result<{ tool: string; domains: string[] }[]> {
  const previous = loadActiveBlueprint(tx.sql, app);
  if (!previous.ok) return previous;
  if (previous.value === null) return ok([]);
  const removed = removedPublicOf(previous.value.blueprint.tools, nextTools);
  if (removed.length === 0) return ok([]);
  let ports, lookup;
  try {
    ports = tx.port(usagePorts);
    lookup = tx.port(domainLookupPort);
  } catch {
    return err({ code: "unavailable", message: "app usage is unavailable" });
  }
  const users = appToolUsers(tx.sql, ports, app);
  if (!users.ok) return users;
  const byTool = new Map<string, Set<string>>();
  for (const user of users.value) {
    if (!removed.includes(user.tool)) continue;
    const names = byTool.get(user.tool) ?? new Set<string>();
    names.add(lookup.get(user.domain)?.name ?? user.domain);
    byTool.set(user.tool, names);
  }
  return ok(
    [...byTool]
      .map(([tool, names]) => ({ tool, domains: [...names].sort() }))
      .sort((a, b) => a.tool < b.tool ? -1 : 1),
  );
}
