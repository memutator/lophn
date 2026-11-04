// release가 지우는 공개 command와 공개 skill, 그것을 다른 앱·project가 쓰는지의 판정. 막지 않고 준비 결과의 알림으로 싣는다.
// 비교 재료는 active release에 고정된 선언과 새 선언이다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type { AppDeclaration } from "../declaration/mod.ts";
import { appToolUsers, usagePorts } from "../usage/mod.ts";
import { appAssignees } from "../usage/users.ts";
import { loadActiveDeclaration } from "./store.ts";

type Tool = AppDeclaration["commands"][number];
type Skill = NonNullable<AppDeclaration["skills"]>[number];

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

// 지우는 공개 tool 가운데 다른 앱·project가 쓰는 것이다.
// 이전 active release가 없거나 지우는 tool이 없으면 비어 있다.
export function removedPublicToolsOf(
  tx: Pick<Tx, "sql" | "port">,
  app: string,
  nextTools: readonly Tool[],
): Result<{ tool: string }[]> {
  const previous = loadActiveDeclaration(tx.sql, app);
  if (!previous.ok) return previous;
  if (previous.value === null) return ok([]);
  const removed = removedPublicOf(
    previous.value.declaration.commands,
    nextTools,
  );
  if (removed.length === 0) return ok([]);
  let ports;
  try {
    ports = tx.port(usagePorts);
  } catch {
    return err({ code: "unavailable", message: "app usage is unavailable" });
  }
  const users = appToolUsers(tx.sql, ports, app);
  if (!users.ok) return users;
  const used = new Set(users.value.map((user) => user.tool));
  return ok(removed.filter((tool) => used.has(tool)).map((tool) => ({ tool })));
}

// 공개였던 skill이 사라졌거나 비공개가 됐으면 지운 것이다.
export function removedPublicSkillsIn(
  previous: readonly Skill[],
  next: readonly Skill[],
): string[] {
  const after = new Map(next.map((skill) => [skill.name, skill]));
  return previous
    .filter((skill) => skill.public && after.get(skill.name)?.public !== true)
    .map((skill) => skill.name)
    .sort();
}

// 지우는 공개 skill을 싣는다. 그 앱을 할당받은 agent가 없으면 받는 쪽이 없어 싣지 않는다.
export function removedPublicSkillsOf(
  tx: Pick<Tx, "sql">,
  app: string,
  nextSkills: readonly Skill[],
): Result<{ skill: string }[]> {
  const previous = loadActiveDeclaration(tx.sql, app);
  if (!previous.ok) return previous;
  const removed = removedPublicSkillsIn(
    previous.value?.declaration.skills ?? [],
    nextSkills,
  );
  if (removed.length === 0) return ok([]);
  const assignees = appAssignees(tx.sql, app);
  if (!assignees.ok) return assignees;
  if (assignees.value.length === 0) return ok([]);
  return ok(removed.map((skill) => ({ skill })));
}
