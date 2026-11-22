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
import { routerEnvironment } from "./environment.ts";
import type { SessionDirectory } from "./ports.ts";

// 보내는 입구(main thread)가 mail을 넣기 전에 묻는 것. session·project·앱은 Router의 SessionDirectory port로 읽는다.

type ReadSql = Pick<Sql, "get" | "all">;

function directoryOf(sql: ReadSql): Result<SessionDirectory> {
  const environment = routerEnvironment();
  if (!environment.ok) return environment;
  // 읽기만 한다. commit 뒤 할 일(port)은 session을 열 때만 쓴다.
  const view = {
    sql,
    port: () => {
      throw new Error("a read-only router view has no ports");
    },
  };
  return ok(environment.value.deps(view, () => "").directory);
}

// 보낸 session이 다른 컴퓨터에 닿아도 되는가.
export function remoteReach(
  sql: ReadSql,
  session: Id<"ses">,
  policy: CallPolicy,
): Result<{ workspace: Workspace | null; agent: AgentId }> {
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
  // 받은 일을 또 다른 기계로 넘기지 않는다.
  if (target.opened_by_machine !== null) {
    return err({
      code: "forbidden",
      message:
        "a session opened by mail from another computer does not send to another computer",
    });
  }
  return ok({ workspace, agent });
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

// 이 기계의 workspace 이름을 기계를 건너는 꼴로 바꾼다. 이름이 없으면 지금 call의 규칙과 같다: handle `lophn`은 부른 쪽 workspace,
// 다른 agent는 home이다.
export function remoteWorkspaceOf(
  sql: ReadSql,
  name: AgentAddress["workspace"],
  handle: string,
  callerWorkspace: Workspace | null,
  // `team spawn`은 이 컴퓨터에서처럼 workspace를 빼면 어느 agent든 부른 쪽 workspace다.
  spawn = false,
): Result<RemoteWorkspace> {
  const directory = directoryOf(sql);
  if (!directory.ok) return directory;
  if (name === undefined) {
    return spawn ||
      agentHandleKey(handle) === agentHandleKey(LOPHN_AGENT_HANDLE)
      ? crossing(directory.value, callerWorkspace)
      : ok({ home: true });
  }
  if ("home" in name) return ok({ home: true });
  if ("project" in name) {
    return name.project.startsWith("pri_")
      ? ok({ project: name.project })
      : projectCrossing(directory.value, name.project);
  }
  if (name.app.startsWith("app_")) return ok({ app: name.app });
  const app = directory.value.appIdOf(name.app);
  return app.ok ? ok({ app: app.value }) : app;
}
