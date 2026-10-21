import { ok, type Result } from "../../../base/mod.ts";
import type {
  AgentAssignment,
  ShellRuleLayers,
} from "../../../protocol/approvals/mod.ts";
import type { AppGrant } from "../../../protocol/apps/grants.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { ToolEffect } from "../../../protocol/lophn-agent/tool-values.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";
import { judge } from "../../approvals/gate/mod.ts";
import type { VerifiedCaller } from "./caller.ts";

export type CallGateDeps = {
  assignmentOf(agent: AgentRef): Result<AgentAssignment>;
  appGrantsOf(app: Id<"app">): Promise<Result<readonly AppGrant[]>>;
};

// 앱 tool 판정은 shell 규칙을 보지 않는다.
const NO_SHELL_RULES: ShellRuleLayers = { floor: [], layers: [] };

// 사람 자신의 동작은 이 판정을 거치지 않는다. 묻지 않고 막기만 한다:
// agent는 할당(judge)으로, 앱은 부른 앱의 active grant `app.call`로 본다.
// judge가 ask를 내도 run-loop tool gate가 이미 물은 것이라 지나간다.
export async function callAllowed(
  caller: Exclude<VerifiedCaller, { kind: "person" }>,
  target: { app: Id<"app">; tool: string; effect: ToolEffect },
  deps: CallGateDeps,
): Promise<Result<boolean>> {
  if (caller.kind === "agent") {
    const assignment = deps.assignmentOf(caller.agent);
    if (!assignment.ok) return assignment;
    const judged = judge(
      { kind: "app_tool", ...target },
      assignment.value,
      NO_SHELL_RULES,
      "attended",
    );
    return ok(judged.kind !== "deny");
  }
  const grants = await deps.appGrantsOf(caller.app);
  if (!grants.ok) return grants;
  return ok(
    grants.value.some((grant) =>
      grant.status === "active" && grant.scope.kind === "app.call" &&
      grant.scope.app === target.app &&
      grant.scope.app_tools.includes(target.tool)
    ),
  );
}
