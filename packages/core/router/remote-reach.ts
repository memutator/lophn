import { err, ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import {
  agentHandleKey,
  LOPHN_AGENT_HANDLE,
} from "../../protocol/lophn-agent/agent-values.ts";
import {
  type CallPolicy,
  isPrivate,
} from "../../protocol/lophn-agent/call-policy.ts";
import type { RemoteWorkspace } from "../../protocol/lophn-agent/calls.ts";
import type {
  AgentAddress,
  AgentId,
  Workspace,
} from "../../protocol/lophn-agent/workspaces.ts";
import type { Sql } from "../../protocol/server/mod.ts";
import { loadRecords } from "../folder/import/deps.ts";
import { routerEnvironment } from "./environment.ts";
import type { SessionDirectory } from "./ports.ts";
import type { RouterDeps } from "./router.ts";

// 보내는 입구(main thread)가 mail을 넣기 전에 묻는 것. session·project·앱은 Router의 SessionDirectory port로 읽는다.

type ReadSql = Pick<Sql, "get" | "all">;

function depsOf(sql: ReadSql): Result<RouterDeps> {
  const environment = routerEnvironment();
  if (!environment.ok) return environment;
  // 읽기만 한다. commit 뒤 할 일(port)은 session을 열 때만 쓴다.
  const view = {
    sql,
    port: () => {
      throw new Error("a read-only router view has no ports");
    },
  };
  return ok(environment.value.deps(view, () => ""));
}

function directoryOf(sql: ReadSql): Result<SessionDirectory> {
  const deps = depsOf(sql);
  return deps.ok ? ok(deps.value.directory) : deps;
}

// 보낸 session이 다른 컴퓨터에 닿아도 되는가. 받은 mail로 열린 session은 목록과 명함을 읽지 못하고 call도 보내지 못한다. 다른 컴퓨터가
// 연 팀원만 call을 보내고(`sending`) 그 기계로만 보내는지는 컴퓨터를 푼 뒤 돌려준 `opened_by_machine`으로 본다.
export function remoteReach(
  sql: ReadSql,
  session: Id<"ses">,
  policy: CallPolicy,
  sending = false,
): Result<{
  workspace: Workspace | null;
  agent: AgentId;
  opened_by_machine: Id<"mch"> | null;
}> {
  const directory = directoryOf(sql);
  if (!directory.ok) return directory;
  const target = directory.value.find(session);
  if (target === null) {
    return err({ code: "not_found", message: "session not found" });
  }
  const { workspace, agent } = target.agent;
  if (isPrivate(policy, workspace)) {
    return err({
      code: "forbidden",
      message: "a private workspace does not reach another computer",
    });
  }
  // 받은 일을 또 다른 기계로 넘기지 않는다. 팀원은 자기를 연 기계의 부모에게 보낸다.
  if (target.opened_by_machine !== null) {
    if (!sending) {
      return err({
        code: "forbidden",
        message:
          "a session opened by mail from another computer does not list another computer",
      });
    }
    if (target.spawned_by === null) {
      return err({
        code: "forbidden",
        message:
          "a session opened by mail from another computer does not send to another computer",
      });
    }
  }
  return ok({ workspace, agent, opened_by_machine: target.opened_by_machine });
}

function crossing(
  directory: SessionDirectory,
  workspace: Workspace | null,
): Result<RemoteWorkspace> {
  if (workspace === null) return ok({ home: true });
  if (workspace.kind === "app") return ok({ app: workspace.id });
  return projectCrossing(directory, workspace.id);
}

function projectCrossing(
  directory: SessionDirectory,
  project: string,
): Result<RemoteWorkspace> {
  const identity = directory.identityOfProject(project);
  // 이름은 이 컴퓨터에서 푼다. 다른 컴퓨터에만 있는 project는 기계를 건너는 id로만 닿는다.
  if (!identity.ok && identity.error.code === "not_found") {
    return err({
      code: "not_found",
      message: `no project ${project} on this computer; name a project that is only on the other computer by its cross-computer id (pri_…) from lophn project identity there or agent list --on`,
    });
  }
  if (!identity.ok) return identity;
  return ok({ project: identity.value });
}

function appIdFromFolderRecords(
  sql: ReadSql,
  me: Id<"mch">,
  slug: string,
  targetMachine?: Id<"mch">,
): Id<"app"> | null {
  let stored: ReturnType<typeof loadRecords>;
  try {
    stored = loadRecords(sql, me);
  } catch {
    return null;
  }
  const matches = stored.apps.filter(
    (row) =>
      row.forgotten_at === null &&
      row.record.slug === slug &&
      (targetMachine === undefined || row.machine === targetMachine),
  );
  if (matches.length === 0) return null;
  // 대상 기계가 없을 때는 여러 기계의 서로 다른 앱과 겹치지 않을 때만 id로 푼다.
  if (targetMachine === undefined) {
    const ids = new Set(matches.map((row) => row.app));
    if (ids.size !== 1) return null;
    return matches[0].app;
  }
  let best = matches[0];
  for (const row of matches.slice(1)) {
    if (row.record.updated_at > best.record.updated_at) best = row;
  }
  return best.app;
}

// 받는 쪽이 remote mail의 `{ app }` slug를 이 기계의 앱 id로 푼다. 없거나 router가 아직 연결되지 않았으면 null이다.
export function localAppIdOf(sql: ReadSql, ref: string): Id<"app"> | null {
  if (ref.startsWith("app_")) return ref as Id<"app">;
  const directory = directoryOf(sql);
  if (!directory.ok) return null;
  const app = directory.value.appIdOf(ref);
  return app.ok ? app.value : null;
}

// 이 기계의 workspace 이름을 기계를 건너는 꼴로 바꾼다. 이름이 없으면 지금 call의 규칙과 같다: handle `lophn`은 부른 쪽 workspace,
// 다른 agent는 home이다.
export function remoteWorkspaceOf(
  sql: ReadSql,
  name: AgentAddress["workspace"],
  handle: string,
  callerWorkspace: Workspace | null,
  // `team spawn`은 이 컴퓨터에서처럼 workspace를 빼면 어느 agent든 부른 쪽 workspace다.
  spawn = false,
  targetMachine?: Id<"mch">,
): Result<RemoteWorkspace> {
  const deps = depsOf(sql);
  if (!deps.ok) return deps;
  const { directory } = deps.value;
  if (name === undefined) {
    return spawn ||
      agentHandleKey(handle) === agentHandleKey(LOPHN_AGENT_HANDLE)
      ? crossing(directory, callerWorkspace)
      : ok({ home: true });
  }
  if ("home" in name) return ok({ home: true });
  if ("project" in name) {
    return name.project.startsWith("pri_")
      ? ok({ project: name.project })
      : projectCrossing(directory, name.project);
  }
  if (name.app.startsWith("app_")) return ok({ app: name.app });
  const app = directory.appIdOf(name.app);
  if (app.ok) return ok({ app: app.value });
  if (app.error.code !== "not_found") return app;
  const fromFolder = appIdFromFolderRecords(
    sql,
    deps.value.self() as Id<"mch">,
    name.app,
    targetMachine,
  );
  return ok({ app: fromFolder ?? name.app });
}
