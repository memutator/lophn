import { ok, type Result } from "../../../base/mod.ts";
import type { AppGrant } from "../../../protocol/apps/grants.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { ToolEffect } from "../../../protocol/lophn-agent/tool-values.ts";
import type {
  AgentId,
  Workspace,
} from "../../../protocol/lophn-agent/workspaces.ts";
import type { VerifiedCaller } from "./caller.ts";

export type CallGateDeps = {
  // 그 agent의 session에 그 앱의 skill이 닿는가(전역, workspace, agent 층의 배포). 앱 자기 workspace의 session도 닿는다.
  appReached(
    who: { agent: AgentId; workspace: Workspace | null },
    app: Id<"app">,
  ): Promise<Result<boolean>>;
  // run-loop Gate가 이 tool call을 run으로 끝냈는가(배포되어 있었거나 사람이 이 호출을 허락했다).
  gateRan(session: string, toolCall: string): boolean;
  appGrantsOf(app: Id<"app">): Promise<Result<readonly AppGrant[]>>;
  // 이 기계의 call 정책에서 그 앱의 workspace가 private인가.
  isPrivate(app: Id<"app">): boolean;
};

// 사람 자신의 동작은 이 판정을 거치지 않는다. 묻지 않고 막기만 한다:
// agent는 그 앱의 skill이 닿는지(배포)나 사람이 이 호출을 허락했는지로, 앱은 부른 앱의 active grant `app.call`로 본다.
// 묻는 것은 run-loop tool gate이고 여기는 그 결과를 한 번 더 확인한다: Gate를 지나지 않은 agent 호출(묻지 못하는 호출)은 닿지 않은 앱을 부르지 못한다.
// job(program)은 사람이 등록을 승인한 job이다. scheduler는 승인한 job만 돌리고, 할 일은 승인 뒤 바뀌지 않으며,
// program 자격은 core 안 run 연산만 만든다. 그래서 만든 agent의 배포를 보지 않는다.
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
  // 다른 컴퓨터가 넘긴 호출. 명단과 터미널 입력 허락은 입구(`apps/remote_call`)가 본다. 여기서는 이 기계가 내놓은 command만 지나가고
  // (같은 앱이 다른 컴퓨터에서 자기 자신 command를 부르는 것은 비공개 command도 지나간다),
  // 요청한 쪽이 agent나 앱이면 그 앱의 workspace가 private이 아니어야 한다. 사람의 화면과 터미널은 private도 부른다.
  // 요청한 쪽의 name과 agent 글은 다른 컴퓨터가 쓴 표시값이라 판정에 쓰지 않는다.
  if (caller.kind === "remote") {
    const sameApp =
      caller.requester.kind === "app" && caller.requester.app === target.app;
    if (!target.public && !sameApp) return ok(false);
    const { kind } = caller.requester;
    return ok(
      !((kind === "agent" || kind === "app") && deps.isPrivate(target.app)),
    );
  }
  // 구독은 발행한 앱이 내놓은 event를 받겠다고 선언한 것이다. 사람 허락도 grant도 묻지 않는다(roadmap 정한 것 16).
  if (caller.kind === "event") return ok(true);
  if (caller.kind === "flow") {
    // 배포는 호출 때 읽는다. flow 호출은 사람이 없는 호출이고 배포를 읽는 agent는 flow instance의 creator, workspace는 flow의 workspace다.
    const reached = await deps.appReached(
      { agent: caller.agent, workspace: caller.workspace },
      target.app,
    );
    if (!reached.ok) return reached;
    if (!reached.value) return ok(false);
    if (target.public) return ok(true);
    // agent의 tool 목록과 같은 규칙: 공개 tool이거나 creator가 그 앱 workspace에 있는 tool.
    return ok(
      caller.workspace?.kind === "app" && caller.workspace.id === target.app,
    );
  }
  if (caller.kind === "agent") {
    const own =
      caller.workspace?.kind === "app" && caller.workspace.id === target.app;
    // 비공개 command는 그 앱 workspace의 agent만 부른다.
    if (!target.public && !own) return ok(false);
    if (own) return ok(true);
    const reached = await deps.appReached(
      { agent: caller.agent, workspace: caller.workspace },
      target.app,
    );
    if (!reached.ok) return reached;
    return ok(reached.value || deps.gateRan(caller.session, caller.toolCall));
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
