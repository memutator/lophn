import { ok, type Result } from "../../../base/mod.ts";
import type {
  Assignment,
  ShellRuleLayers,
} from "../../../protocol/approvals/mod.ts";
import type { AppGrant } from "../../../protocol/apps/grants.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { ToolEffect } from "../../../protocol/lophn-agent/tool-values.ts";
import type { AgentId } from "../../../protocol/lophn-agent/workspaces.ts";
import { judge } from "../../approvals/gate/mod.ts";
import type { VerifiedCaller } from "./caller.ts";

export type CallGateDeps = {
  assignmentOf(agent: AgentId): Result<Assignment>;
  appGrantsOf(app: Id<"app">): Promise<Result<readonly AppGrant[]>>;
};

function assignmentOf(
  caller: AgentId,
  deps: CallGateDeps,
): Result<Pick<Assignment, "entries">> {
  return deps.assignmentOf(caller);
}

// 앱 tool 판정은 shell 규칙을 보지 않는다.
const NO_SHELL_RULES: ShellRuleLayers = { floor: [], layers: [] };

// 사람 자신의 동작은 이 판정을 거치지 않는다. 묻지 않고 막기만 한다:
// agent는 할당(judge)으로, 앱은 부른 앱의 active grant `app.call`로 본다.
// job(program)은 사람이 등록을 승인한 job이다. scheduler는 승인한 job만 돌리고, 할 일은 승인 뒤 바뀌지 않으며,
// program 자격은 core 안 run 연산만 만든다. 그래서 만든 agent의 할당을 보지 않는다.
// judge가 ask를 내도 run-loop tool gate가 이미 물은 것이라 지나간다.
export async function callAllowed(
  caller: Exclude<VerifiedCaller, { kind: "person" }>,
  target: {
    app: Id<"app">;
    tool: string;
    effect: ToolEffect;
    public: boolean;
  },
  deps: CallGateDeps,
): Promise<Result<boolean>> {
  if (caller.kind === "program") return ok(true);
  if (caller.kind === "flow") {
    // 할당은 호출 때 읽는다. flow 호출은 사람이 없는 호출이고 할당을 읽는 agent는 flow instance의 creator다.
    const assignment = assignmentOf(caller.agent, deps);
    if (!assignment.ok) return assignment;
    const judged = judge(
      {
        kind: "app_tool",
        app: target.app,
        tool: target.tool,
        effect: target.effect,
      },
      assignment.value,
      NO_SHELL_RULES,
      "unattended",
      false,
    );
    if (judged.kind === "deny") return ok(false);
    if (target.public) return ok(true);
    // agent의 tool 목록과 같은 규칙: 공개 tool이거나 creator가 그 앱 workspace에 있는 tool.
    return ok(
      caller.workspace?.kind === "app" && caller.workspace.id === target.app,
    );
  }
  if (caller.kind === "agent") {
    const assignment = assignmentOf(caller.agent, deps);
    if (!assignment.ok) return assignment;
    const judged = judge(
      {
        kind: "app_tool",
        app: target.app,
        tool: target.tool,
        effect: target.effect,
      },
      assignment.value,
      NO_SHELL_RULES,
      "attended",
      false,
    );
    return ok(judged.kind !== "deny");
  }
  const grants = await deps.appGrantsOf(caller.app);
  if (!grants.ok) return grants;
  return ok(
    grants.value.some(
      (grant) =>
        grant.status === "active" &&
        grant.scope.kind === "app.call" &&
        grant.scope.app === target.app &&
        grant.scope.app_tools.includes(target.tool),
    ),
  );
}
