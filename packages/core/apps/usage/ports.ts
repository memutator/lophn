import { definePort } from "../../../protocol/base/mod.ts";
import type { Workspace } from "../../../protocol/lophn-agent/workspaces.ts";

export type StaticToolUse = {
  tool: string;
  // null이면 Home이다.
  workspace: Workspace | null;
};

export type StaticEventSubscriber = {
  event: string;
  // null이면 Home이다.
  workspace: Workspace | null;
};

// 사용 관계가 agent·session·job의 정본을 알아내는 길. sessions·jobs·agents는 apps의 것이 아니므로
// 구현은 조립(core/main)이 tx와 snapshot마다 꽂는다.
export interface UsagePorts {
  // session이 놓인 곳. home이면 workspace가 null이다. session이 없으면 null이다.
  sessionWorkspace(session: string): { workspace: Workspace | null } | null;
  // 활성 job(tool_run 등)이 정적으로 가리키는 앱 command 사용처.
  declaredToolUsers?(app: string): readonly StaticToolUse[];
  // 활성 job(event trigger 등)이 정적으로 구독하는 앱 event 사용처(원격 machine 제외).
  declaredEventSubscribers?(app: string): readonly StaticEventSubscriber[];
  // 이 앱이 할당된 외부 활성 agent의 workspace 목록(public skill 사용처 수 산출용).
  assignedAppWorkspaces?(
    appSlug: string,
    appId: string,
  ): readonly (Workspace | null)[];
}

export const usagePorts = definePort<UsagePorts>("apps.usage");
