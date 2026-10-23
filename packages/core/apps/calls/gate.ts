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
  // program·flow caller의 domain 거르기 재료. creator(또는 PM)가 맡은 domain id와 앱 domain 이름의 id다.
  agentDomainsOf(agent: AgentRef): Result<readonly string[]>;
  toolDomainOf(app: Id<"app">, name: string): Result<string | null>;
};

// 앱 tool 판정은 shell 규칙을 보지 않는다.
const NO_SHELL_RULES: ShellRuleLayers = { floor: [], layers: [] };

// 사람 자신의 동작은 이 판정을 거치지 않는다. 묻지 않고 막기만 한다:
// agent는 할당(judge)으로, 앱은 부른 앱의 active grant `app.call`로 본다.
// judge가 ask를 내도 run-loop tool gate가 이미 물은 것이라 지나간다.
export async function callAllowed(
  caller: Exclude<VerifiedCaller, { kind: "person" }>,
  target: {
    app: Id<"app">;
    tool: string;
    effect: ToolEffect;
    public: boolean;
    domain: string;
  },
  deps: CallGateDeps,
): Promise<Result<boolean>> {
  if (caller.kind === "program" || caller.kind === "flow") {
    // 할당은 호출 때 읽는다. job과 flow 호출은 사람이 없는 호출이다.
    // 할당을 읽는 agent는 job의 creator 또는 flow instance의 project PM이다.
    const assignment = deps.assignmentOf(caller.agent);
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
    );
    if (judged.kind === "deny") return ok(false);
    if (target.public) return ok(true);
    // agent의 tool 목록과 같은 규칙: 공개 tool이거나 creator가 맡은 domain의 tool.
    // 읽지 못하면 막는다.
    const id = deps.toolDomainOf(target.app, target.domain);
    const domains = deps.agentDomainsOf(caller.agent);
    if (!id.ok || !domains.ok || id.value === null) return ok(false);
    return ok(domains.value.includes(id.value));
  }
  if (caller.kind === "agent") {
    const assignment = deps.assignmentOf(caller.agent);
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
