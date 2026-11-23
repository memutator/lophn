import {
  type CallPolicy,
  mayReachWorkspace,
} from "../../protocol/lophn-agent/call-policy.ts";
import type { Workspace } from "../../protocol/lophn-agent/workspaces.ts";

export type EventWorkspace = { kind: "project" | "app"; id: string };

export type EventReachChecker = (
  from: EventWorkspace | null,
  to: EventWorkspace | null,
) => boolean;

// call 정책으로 workspace 도달 여부를 판정한다(jobs와 flow onEvent가 같은 규칙을 쓴다).
export function reachCheckerOf(policy: () => CallPolicy): EventReachChecker {
  return (from, to) =>
    mayReachWorkspace(
      policy(),
      from as Workspace | null,
      to as Workspace | null,
    );
}

export type AppEventPolicyInput = {
  // 구독자(job 또는 workflow의 project)의 workspace. Home이면 null이다.
  subscriberWorkspace: EventWorkspace | null;
  // 발행한 앱 id.
  sourceApp: string;
  // 이 event의 인과 앱 사슬(발행 앱 포함).
  appChain?: readonly string[];
  // 이 구독자가 직접 부르는 앱(예: job의 tool_run 대상 앱). 사슬에 이미 있으면 자기 고리다.
  excludedApp?: string;
  // 이 event를 낳은 workflow instance 사슬(직접 tool 호출·세션 workflow_origin·상위 workflow 포함).
  instanceChain?: readonly string[];
  // 구독 중인 workflow instance id. 인과 사슬에 있으면 자기 고리다.
  excludedInstance?: string;
  reaches: EventReachChecker;
};

// 앱 event를 구독자(job·flow onEvent)에게 넘겨도 되는지 판정한다.
export function allowAppEvent(input: AppEventPolicyInput): boolean {
  if (
    !input.reaches(input.subscriberWorkspace, {
      kind: "app",
      id: input.sourceApp,
    })
  ) {
    return false;
  }
  if (
    input.excludedApp !== undefined &&
    input.appChain?.includes(input.excludedApp) === true
  ) {
    return false;
  }
  if (
    input.excludedInstance !== undefined &&
    input.instanceChain?.includes(input.excludedInstance) === true
  ) {
    return false;
  }
  return true;
}

export type SessionEventPolicyInput = {
  // 구독자(job 또는 workflow의 project)의 workspace. Home이면 null이다.
  subscriberWorkspace: EventWorkspace | null;
  // event를 낸 session 정보. session이 없는 core event(예: call.settled)는 null이다.
  session: {
    id: string;
    workspace: EventWorkspace | null;
    // 비사람·자동화(job, workflow, team spawn, call, unattended run)로 열린 session임이 이미 확인됐는가.
    driven?: boolean;
  } | null;
  reaches: EventReachChecker;
  // session이 비사람·자동화로 열렸는지 추가로 확인한다(도달 검사 통과 뒤에만 부른다).
  isDrivenSession?: (sessionId: string) => boolean;
};

// lophn session event를 구독자(job·flow onEvent)에게 넘겨도 되는지 판정한다.
// 사람이 연 session(터미널·앱 화면 포함)만 깨우고 자동화 session은 고리를 막으려 제외한다.
export function allowSessionEvent(input: SessionEventPolicyInput): boolean {
  if (input.session === null) return false;
  if (!input.reaches(input.subscriberWorkspace, input.session.workspace)) {
    return false;
  }
  if (input.session.driven === true) return false;
  if (input.isDrivenSession?.(input.session.id) === true) return false;
  return true;
}
