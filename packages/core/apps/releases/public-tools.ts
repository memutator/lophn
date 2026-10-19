// release가 바꾸는 tool 선언과, 그것을 다른 project가 쓰는지의 판정. activation 막기(start·block)와
// 바뀐 사실 알리기(complete)가 같은 재료를 쓴다. 비교 재료는 release에 고정된 blueprint다.
import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import type { ReleaseRecord } from "../../../protocol/apps/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type { Blueprint } from "../blueprint/mod.ts";
import { appProjectOf } from "../lookups.ts";
import { appToolUsers, type ToolUser, usagePorts } from "../usage/mod.ts";
import { loadActiveBlueprint, loadStoredBlueprint } from "./store.ts";

type Tool = Blueprint["tools"][number];

export type ToolDiff = {
  added: string[];
  removed: string[];
  changed: string[];
};

// input schema, output schema, effect, public 가운데 하나라도 다르면 바뀐 것이다. 이름순으로 낸다.
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

// 지운 공개 tool 가운데 다른 project가 쓰는 것.
export function blockedBy(
  removedPublic: readonly string[],
  users: readonly ToolUser[],
): string[] {
  const used = new Set(users.map((user) => user.tool));
  return removedPublic.filter((name) => used.has(name));
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

// 이 release가 active가 되면 지워질 공개 tool 가운데 다른 project가 쓰는 것. 비면 막지 않는다.
export function blockedToolsOf(
  tx: Reader,
  release: ReleaseRecord,
): Result<string[]> {
  const both = toolsOfBoth(tx, release);
  if (!both.ok) return both;
  if (both.value === null) return ok([]);
  const removed = removedPublicOf(both.value.previous, both.value.next);
  if (removed.length === 0) return ok([]);
  const users = usersOf(tx, release.app);
  if (!users.ok) return users;
  return ok(blockedBy(removed, users.value));
}

// release가 active가 될 때 알릴 project와 tool. 그 앱의 project는 바뀐 tool 전부를, 다른 project는 자기가 쓰는
// 바뀌거나 지워진 공개 tool만 받는다. 이전 release가 아직 active일 때 불러야 사용 관계가 이전 선언으로 읽힌다.
export function changeNoticesOf(
  tx: Reader,
  release: ReleaseRecord,
): Result<{ project: string; tools: string[] }[]> {
  const both = toolsOfBoth(tx, release);
  if (!both.ok) return both;
  if (both.value === null) return ok([]);
  const diff = diffTools(both.value.previous, both.value.next);
  const touched = [...diff.removed, ...diff.changed];
  const all = [...diff.added, ...touched].sort();
  if (all.length === 0) return ok([]);
  const own = appProjectOf(tx.sql, release.app);
  if (own === null) {
    return err({ code: "internal", message: "app has no project" });
  }
  const notices = new Map<string, string[]>([[own, all]]);
  if (touched.length > 0) {
    const users = usersOf(tx, release.app);
    if (!users.ok) return users;
    const byProject = new Map<string, Set<string>>();
    for (const user of users.value) {
      if (!touched.includes(user.tool)) continue;
      const names = byProject.get(user.project) ?? new Set<string>();
      names.add(user.tool);
      byProject.set(user.project, names);
    }
    for (const [project, names] of byProject) {
      notices.set(project, [...names].sort());
    }
  }
  return ok([...notices].map(([project, tools]) => ({ project, tools })));
}
