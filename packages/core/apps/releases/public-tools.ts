// release가 바꾸거나 지우는 공개 계약(command·skill·event)과 외부 사용 수 산출. 막지 않고 준비 결과의 알림으로 싣는다.
// 비교 재료는 active release에 고정된 선언과 새 선언이다. P12: 외부 이름은 싣지 않고 개수만 싣는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { ContractChange } from "../../../protocol/apps/releases.ts";
import type { Workspace } from "../../../protocol/lophn-agent/workspaces.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import { type AppDeclaration, canonicalJson } from "../declaration/mod.ts";
import { loadApp, loadApps } from "../registration/store.ts";
import { appToolUsers, usagePorts } from "../usage/mod.ts";
import { loadActiveDeclaration } from "./store.ts";

type Tool = AppDeclaration["commands"][number];
type Skill = NonNullable<AppDeclaration["skills"]>[number];
type EventDecl = NonNullable<AppDeclaration["events"]>[number];

export type ContractDiff = {
  surface: ContractChange["surface"];
  name: string;
  change: ContractChange["change"];
};

const SURFACE_ORDER: Record<ContractChange["surface"], number> = {
  command: 0,
  skill: 1,
  event: 2,
};

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

// 지우거나 비공개로 바꾸는 공개 skill 전부를 싣는다.
export function removedPublicSkillsOf(
  tx: Pick<Tx, "sql">,
  app: string,
  nextSkills: readonly Skill[],
): Result<{ skill: string }[]> {
  const previous = loadActiveDeclaration(tx.sql, app);
  if (!previous.ok) return previous;
  return ok(
    removedPublicSkillsIn(
      previous.value?.declaration.skills ?? [],
      nextSkills,
    ).map((skill) => ({ skill })),
  );
}

// 이전 활성 선언과 새 선언 사이에서 지워졌거나 정규화 JSON이 바뀐 공개 command·공개 skill·선언 event를 낸다.
// JSON Schema 호환성 검사는 하지 않는다: 달라졌으면 agent가 판단한다.
export function diffReleaseContracts(
  previous: Pick<AppDeclaration, "commands" | "skills" | "events">,
  next: Pick<AppDeclaration, "commands" | "skills" | "events">,
): ContractDiff[] {
  const diffs: ContractDiff[] = [];

  const nextCommands = new Map(next.commands.map((item) => [item.name, item]));
  for (const prev of previous.commands) {
    if (!prev.public) continue;
    const curr = nextCommands.get(prev.name);
    if (curr === undefined || !curr.public) {
      diffs.push({ surface: "command", name: prev.name, change: "removed" });
    } else if (canonicalJson(prev as never) !== canonicalJson(curr as never)) {
      diffs.push({ surface: "command", name: prev.name, change: "changed" });
    }
  }

  const nextSkills = new Map(
    (next.skills ?? []).map((item) => [item.name, item]),
  );
  for (const prev of previous.skills ?? []) {
    if (!prev.public) continue;
    const curr = nextSkills.get(prev.name);
    if (curr === undefined || !curr.public) {
      diffs.push({ surface: "skill", name: prev.name, change: "removed" });
    } else if (canonicalJson(prev as never) !== canonicalJson(curr as never)) {
      diffs.push({ surface: "skill", name: prev.name, change: "changed" });
    }
  }

  const nextEvents = new Map<string, EventDecl>(
    (next.events ?? []).map((item) => [item.name, item]),
  );
  for (const prev of previous.events ?? []) {
    const curr = nextEvents.get(prev.name);
    if (curr === undefined) {
      diffs.push({ surface: "event", name: prev.name, change: "removed" });
    } else if (canonicalJson(prev as never) !== canonicalJson(curr as never)) {
      diffs.push({ surface: "event", name: prev.name, change: "changed" });
    }
  }

  diffs.sort(
    (a, b) =>
      SURFACE_ORDER[a.surface] - SURFACE_ORDER[b.surface] ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return diffs;
}

function externalWorkspaceKey(
  app: string,
  workspace: Workspace | null,
): string | null {
  if (workspace === null) return "home";
  if (workspace.kind === "app" && workspace.id === app) return null;
  return `${workspace.kind}:${workspace.id}`;
}

// 이전 active release와 비교해 바뀐·지워진 계약마다 외부 사용처 개수를 채운다(P12: 외부 이름은 절대 싣지 않는다).
export function contractChangesOf(
  tx: Pick<Tx, "sql" | "port">,
  app: string,
  nextDeclaration: AppDeclaration,
): Result<ContractChange[]> {
  const previous = loadActiveDeclaration(tx.sql, app);
  if (!previous.ok) return previous;
  if (previous.value === null) return ok([]);

  const diffs = diffReleaseContracts(
    previous.value.declaration,
    nextDeclaration,
  );
  if (diffs.length === 0) return ok([]);

  let ports;
  try {
    ports = tx.port(usagePorts);
  } catch {
    return err({ code: "unavailable", message: "app usage is unavailable" });
  }

  const target = loadApp(tx.sql, app);
  if (!target.ok) return target;
  const appSlug = target.value?.slug ?? null;

  const commandUsers = new Map<string, Set<string>>();
  if (diffs.some((d) => d.surface === "command")) {
    const users = appToolUsers(tx.sql, ports, app);
    if (!users.ok) return users;
    for (const use of users.value) {
      const key = externalWorkspaceKey(app, use.workspace);
      if (key === null) continue;
      let set = commandUsers.get(use.tool);
      if (set === undefined) {
        set = new Set();
        commandUsers.set(use.tool, set);
      }
      set.add(key);
    }
    for (const use of ports.declaredToolUsers?.(app) ?? []) {
      const key = externalWorkspaceKey(app, use.workspace);
      if (key === null) continue;
      let set = commandUsers.get(use.tool);
      if (set === undefined) {
        set = new Set();
        commandUsers.set(use.tool, set);
      }
      set.add(key);
    }
  }

  const eventSubscribers = new Map<string, Set<string>>();
  if (diffs.some((d) => d.surface === "event")) {
    const addEventSub = (event: string, workspace: Workspace | null) => {
      const key = externalWorkspaceKey(app, workspace);
      if (key === null) return;
      let set = eventSubscribers.get(event);
      if (set === undefined) {
        set = new Set();
        eventSubscribers.set(event, set);
      }
      set.add(key);
    };
    const activeApps = loadApps(tx.sql, "active");
    if (!activeApps.ok) return activeApps;
    for (const other of activeApps.value) {
      if (other.id === app) continue;
      const decl = loadActiveDeclaration(tx.sql, other.id);
      if (!decl.ok) return decl;
      for (const sub of decl.value?.declaration.subscriptions ?? []) {
        if (sub.machine !== undefined) continue;
        if (
          sub.source === app ||
          (appSlug !== null && sub.source === appSlug)
        ) {
          addEventSub(sub.event, { kind: "app", id: other.id });
        }
      }
    }
    for (const sub of ports.declaredEventSubscribers?.(app) ?? []) {
      addEventSub(sub.event, sub.workspace);
    }
  }

  return ok(
    diffs.map((diff) => ({
      surface: diff.surface,
      name: diff.name,
      change: diff.change,
      external_user_count:
        diff.surface === "command"
          ? (commandUsers.get(diff.name)?.size ?? 0)
          : diff.surface === "skill"
            ? 0
            : (eventSubscribers.get(diff.name)?.size ?? 0),
    })),
  );
}
