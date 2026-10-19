// release가 바꾸는 tool 선언과, 그것을 다른 domain이 쓰는지의 판정. activation 막기(start·block)와
// 바뀐 사실 알리기(complete)가 같은 재료를 쓴다. 비교 재료는 release에 고정된 blueprint다.
import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import type { ReleaseRecord } from "../../../protocol/apps/mod.ts";
import { domainLookupPort } from "../../../protocol/domains/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type { Blueprint } from "../blueprint/mod.ts";
import { appToolUsers, type ToolUser, usagePorts } from "../usage/mod.ts";
import { loadActiveBlueprint, loadStoredBlueprint } from "./store.ts";

type Tool = Blueprint["tools"][number];

export type ToolDiff = {
  added: string[];
  removed: string[];
  changed: string[];
};

// input schema, output schema, effect, public, domain 가운데 하나라도 다르면 바뀐 것이다. 이름순으로 낸다.
export function diffTools(
  previous: readonly Tool[],
  next: readonly Tool[],
): ToolDiff {
  const before = new Map(previous.map((tool) => [tool.name, tool]));
  const after = new Map(next.map((tool) => [tool.name, tool]));
  const shape = (tool: Tool) =>
    canonicalize({
      input: tool.inputSchema,
      output: tool.outputSchema ?? null,
      effect: tool.effect,
      public: tool.public,
      domain: tool.domain,
    });
  const diff: ToolDiff = { added: [], removed: [], changed: [] };
  for (const [name, tool] of after) {
    const old = before.get(name);
    if (old === undefined) diff.added.push(name);
    else if (shape(old) !== shape(tool)) diff.changed.push(name);
  }
  for (const name of before.keys()) {
    if (!after.has(name)) diff.removed.push(name);
  }
  for (const names of Object.values(diff)) names.sort();
  return diff;
}

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

type Reader = Pick<Tx, "sql" | "port">;

// 첫 activation(이전 active release가 없음)이면 null이다.
function toolsOfBoth(
  tx: Reader,
  release: ReleaseRecord,
): Result<{ previous: Tool[]; next: Tool[] } | null> {
  const previous = loadActiveBlueprint(tx.sql, release.app);
  if (!previous.ok) return previous;
  if (previous.value === null) return ok(null);
  const next = loadStoredBlueprint(tx.sql, release.id);
  if (!next.ok) return next;
  if (next.value === null) {
    return err({ code: "not_found", message: "release not found" });
  }
  return ok({
    previous: previous.value.blueprint.tools,
    next: next.value.blueprint.tools,
  });
}

// 읽기에 실패하면 err다. 호출한 쪽이 막는 쪽(fail closed)으로 쓴다.
function usersOf(tx: Reader, app: string): Result<ToolUser[]> {
  let ports;
  try {
    ports = tx.port(usagePorts);
  } catch {
    return err({ code: "unavailable", message: "app usage is unavailable" });
  }
  return appToolUsers(tx.sql, ports, app);
}

// tool의 domain 이름을 domain id로 바꾼다. 읽기에 실패하면 err다(호출한 쪽이 막는 쪽으로 쓴다).
function domainsByTool(
  tx: Reader,
  app: string,
  tools: readonly Tool[],
): Result<Map<string, string>> {
  let lookup;
  try {
    lookup = tx.port(domainLookupPort);
  } catch {
    return err({ code: "unavailable", message: "domains are unavailable" });
  }
  const ids = new Map(
    lookup.ofOwner({ kind: "app", id: app }).map((d) => [d.name, d.id]),
  );
  const byTool = new Map<string, string>();
  for (const tool of tools) {
    const id = ids.get(tool.domain);
    if (id === undefined) {
      return err({ code: "internal", message: "tool domain not found" });
    }
    byTool.set(tool.name, id);
  }
  return ok(byTool);
}

function grouped(entries: Iterable<[string, string]>) {
  const byDomain = new Map<string, Set<string>>();
  for (const [domain, tool] of entries) {
    const names = byDomain.get(domain) ?? new Set<string>();
    names.add(tool);
    byDomain.set(domain, names);
  }
  return [...byDomain]
    .map(([domain, names]) => ({ domain, tools: [...names].sort() }))
    .sort((a, b) => a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0);
}

export type DomainNotice = { domain: string; tools: string[] };

// 이 release가 active가 되면 지워질 공개 tool 가운데 다른 domain이 쓰는 것을 tool의 domain별로 묶는다. 비면 막지 않는다.
export function blockedToolsOf(
  tx: Reader,
  release: ReleaseRecord,
): Result<DomainNotice[]> {
  const both = toolsOfBoth(tx, release);
  if (!both.ok) return both;
  if (both.value === null) return ok([]);
  const removed = removedPublicOf(both.value.previous, both.value.next);
  if (removed.length === 0) return ok([]);
  const users = usersOf(tx, release.app);
  if (!users.ok) return users;
  const used = new Set(users.value.map((user) => user.tool));
  const blocked = removed.filter((name) => used.has(name));
  if (blocked.length === 0) return ok([]);
  const domains = domainsByTool(tx, release.app, both.value.previous);
  if (!domains.ok) return domains;
  return ok(grouped(blocked.map((name) => [domains.value.get(name)!, name])));
}

// release가 active가 될 때 알릴 domain과 tool. tool의 domain은 바뀐 tool 전부를, 다른 domain은 자기가 쓰는
// 바뀌거나 지워진 공개 tool만 받는다. 이전 release가 아직 active일 때 불러야 사용 관계가 이전 선언으로 읽힌다.
export function changeNoticesOf(
  tx: Reader,
  release: ReleaseRecord,
): Result<DomainNotice[]> {
  const both = toolsOfBoth(tx, release);
  if (!both.ok) return both;
  if (both.value === null) return ok([]);
  const { previous, next } = both.value;
  const diff = diffTools(previous, next);
  const touched = [...diff.removed, ...diff.changed];
  const all = [...diff.added, ...touched].sort();
  if (all.length === 0) return ok([]);
  const before = domainsByTool(tx, release.app, previous);
  if (!before.ok) return before;
  const after = domainsByTool(tx, release.app, next);
  if (!after.ok) return after;
  // domain이 바뀐 tool은 옛 domain과 새 domain 둘 다 받는다.
  const entries: [string, string][] = [];
  for (const name of all) {
    for (
      const domain of new Set([before.value.get(name), after.value.get(name)])
    ) {
      if (domain !== undefined) entries.push([domain, name]);
    }
  }
  if (touched.length > 0) {
    const users = usersOf(tx, release.app);
    if (!users.ok) return users;
    for (const user of users.value) {
      if (touched.includes(user.tool)) entries.push([user.domain, user.tool]);
    }
  }
  return ok(grouped(entries));
}
