import type { Id } from "../../protocol/base/ids.ts";
import type { SessionOpenMode } from "../../protocol/lophn-agent/agent-values.ts";
import type {
  CallAddressInput,
  CallAskKind,
  CallFailReason,
  CallFrom,
  CallRef,
  CallReply,
  CallState,
} from "../../protocol/lophn-agent/calls.ts";
import {
  type ContentBlock,
  textBlocks,
} from "../../protocol/lophn-agent/content-block.ts";
import type { NoticeKind } from "../../protocol/lophn-agent/input-tags.ts";
import type { InputDelivery } from "../../protocol/lophn-agent/inputs.ts";
import type { PermissionMode } from "../../protocol/lophn-agent/turn-values.ts";
import type { AgentAddress } from "../../protocol/lophn-agent/workspaces.ts";
import type { WorkflowOrigin } from "../../protocol/workflows/values.ts";
import type { RoutedInput, TargetSession } from "./ports.ts";

// 순수 함수만 둔다. 받는 곳 해석 순서, 실패 이유를 오류로 바꾸는 규칙, 실패 알림 글.

// zod가 읽은 ID는 글자라서 port가 요구하는 모양으로 좁힌다.
export const sesId = (value: string) => value as Id<"ses">;
export const calId = (value: string) => value as Id<"cal">;

// route 한 번의 입력이다. 사람, program, agent가 모두 이 모양으로 넣는다.
export type RouteInput = {
  from: CallFrom;
  to: CallAddressInput;
  reply: CallReply;
  body: ContentBlock[];
  refs: readonly CallRef[];
  reply_to: string | null;
  // agent가 보낸 call에만 있다(tool call ID).
  dedup: string | null;
  kind: RoutedInput["kind"];
  delivery: InputDelivery;
  // 사람 메시지는 보내는 쪽이 먼저 session 기록에 쓴 message ID를 싣는다.
  message?: string | null;
  // reaction이면 그 사실 이름.
  event?: string | null;
  // step이면 그 workflow instance와 step 이름.
  step?: { instance: Id<"wfi">; step: string } | null;
  // 이 컴퓨터로 넘긴 step이면 받은 session에 적을 workflow_origin. 다른 컴퓨터에서 받은 step은 그 기계의 project id라 싣지 않는다.
  workflowOrigin?: WorkflowOrigin | null;
  // session을 탭으로 열지 background로 돌릴지. 없으면 agent 정의와 내장 기본을 따른다.
  open?: SessionOpenMode;
  // notice면 그 종류.
  notice?: NoticeKind | null;
  // agent의 SendCall·ReplyCall과 run이 넣은 사람 메시지(`SendMessage`의 `unattended: true`)가 싣는다. 없으면 false.
  unattended?: boolean;
  // 앱 화면이 보낸 사람 메시지의 이름표(MessageReceived가 싣는다).
  via?: { app: Id<"app">; slug: string } | null;
  // 팀 자식의 질문·승인이 부모에게 가는 call이면 그 종류. 답은 보낸 session의 queue로 가지 않고 topic으로 main thread에 간다.
  ask?: CallAskKind | null;
  // `team spawn`이면 true: 받는 곳의 새 session은 보낸 session의 자식(spawned_by)으로 열리고 workspace를 빼면 보낸 session의 workspace다.
  spawn?: boolean;
  // 다른 컴퓨터에서 받은 call은 보낸 기계가 정한 call id를 그대로 쓴다.
  call?: string;
  // 새 session을 열 때 agent 정의의 skip을 따를지. 다른 컴퓨터에서 받은 call만 싣는다(받는 기계의 허락). 없으면 정의대로다.
  // 다른 컴퓨터의 `team spawn --on`이 연 팀원: 그 기계가 지은 session id와 그 기계의 부모 session.
  member?: { id: Id<"ses">; parent: Id<"ses"> };
  skipAllowed?: boolean;
  // workflow participant 등 새 session을 열 때 쓸 권한 단계.
  permissionMode?: PermissionMode;
  // 새 project session이 묶일 git worktree id(없으면 team spawn inherit 규칙 또는 원본 폴더).
  worktreeId?: Id<"wkt"> | null;
};

export type RouteResult = {
  // agent가 보낸 call만 ID가 있다. 사람 메시지와 program 입력은 null이다.
  call: string | null;
  state: CallState;
  fail_reason: CallFailReason | null;
  session: string | null;
};

// 보낸 쪽이 쓴 받는 곳이 어느 모양인지.
type Addressing =
  | { form: "session"; session: string }
  | { form: "address"; address: AgentAddress }
  | { form: "address_or_session"; address: AgentAddress; session: string };

export function addressingOf(to: CallAddressInput): Addressing {
  if ("agent" in to) {
    if ("session" in to) {
      const { session, fallback: _fallback, ...address } = to;
      return { form: "address_or_session", address, session };
    }
    return { form: "address", address: to };
  }
  return { form: "session", session: to.session };
}

// 규칙 2. spawn된 session의 call은 부모, 형제, 자기 밑 전체에게만 닿는다. 팀 밖(spawned_by 없음) session은 제한이 없다.
export function teamMayReach(
  find: (session: Id<"ses">) => TargetSession | null,
  sender: TargetSession,
  receiver: TargetSession,
): boolean {
  if (sender.spawned_by === null) return true;
  if (
    receiver.session === sender.spawned_by ||
    receiver.spawned_by === sender.spawned_by
  ) {
    return true;
  }
  for (
    let up = receiver.spawned_by;
    up !== null;
    up = find(up)?.spawned_by ?? null
  ) {
    if (up === sender.session) return true;
  }
  return false;
}

// `team spawn`이 새 session을 연 뒤 main thread가 자식 탭을 열도록 commit 뒤에 넘기는 일의 이름이다.
export const TEAM_SPAWNED_TOPIC = "router.team-spawned";

// agent의 call이 새 session을 열었다(`{caller, session}`, `team spawn`은 제외). main thread가 그 session의 Agent 탭을 요청한다.
export const CALL_SESSION_OPENED_TOPIC = "router.call-session-opened";

// workflow step이 `open: "tab"`으로 session을 열거나 넘겼다(`{session}`). main thread가 GUI 탭 팀원이 아닌 session의 Agent 탭을 workflow desk에 연다.
export const WORKFLOW_SESSION_OPENED_TOPIC = "router.workflow-session-opened";

// 부모가 ask call에 답했다(`{call, decision, text}`). main thread가 짝인 request나 질문을 푼다.
export const ASK_ANSWERED_TOPIC = "router.ask-answered";
// 부모가 답하지 않고 끝나 ask call이 receiver_ended로 닫혔다(`{call}`). main thread가 짝을 거절·취소로 푼다.
export const ASK_ENDED_TOPIC = "router.ask-ended";

// 앱이 보낸 call이 끝났다(답, 실패, 취소, 답 없는 call의 소비). commit 뒤 main thread가 그 앱에 `call.settled` event를 낸다.
export const APP_CALL_SETTLED_TOPIC = "router.app-call-settled";

// agent session이 보낸 outgoing call(ask 제외)이 accepted에서 벗어났다(done, failed, cancelled).
// commit 뒤 workflow agent()의 열린 call 정산 대기를 깨우는 데 쓴다.
export const AGENT_CALL_SETTLED_TOPIC = "router.agent-call-settled";

export type AgentCallSettledNotice = {
  session: Id<"ses">;
  call: Id<"cal">;
  state: Exclude<CallState, "accepted">;
  fail_reason: CallFailReason | null;
};

// 다른 컴퓨터에서 온 step 입력의 본문 앞 고정 줄이다. step 입력은 보낸 쪽이 program이라 다른 컴퓨터에서 왔다는 표시가 본문에 있어야
// 이력 재생이 같은 글을 만든다. 받는 기계의 본문 준비와 Router가 같은 글을 쓴다.
export function remoteStepBody(
  computer: string,
  body: readonly ContentBlock[],
): ContentBlock[] {
  return [
    {
      type: "text",
      text: `This step comes from a workflow on the computer ${computer}. Report it with \`lophn workflow report\` here as usual; the report goes back to that computer.`,
    },
    ...body,
  ];
}

// outbox에 mail을 더한 tx가 commit됐다(`{peer}`). main thread의 drain이 그 기계로 낸다.
export const MAIL_QUEUED_TOPIC = "router.mail-queued";

export function isFinished(state: CallState): boolean {
  return state !== "accepted";
}

// 사람이 보낸 쪽일 때 배달 실패를 오류 코드로 돌려준다.
export function failureCode(
  reason: CallFailReason,
): "not_found" | "conflict" | "unavailable" {
  switch (reason) {
    case "not_found":
      return "not_found";
    case "closed":
      return "conflict";
    case "skipped":
      return "conflict";
    case "receiver_ended":
    case "lophn_restarted":
    case "expired":
    case "old_version":
      return "unavailable";
  }
}

// 실패를 보낸 session에 돌려주는 입력의 글이다. 고정 문구라 앞단이 미리 blob으로 준비해 둔다.
export const FAILURE_TEXTS: Record<CallFailReason, string> = {
  not_found: "The call was not delivered: no such agent or session.",
  closed:
    "The call was not delivered: that session is closed. Call its agent and workspace to open a new session.",
  receiver_ended: "The receiving session ended without replying.",
  lophn_restarted: "lophn restarted before the receiving session got the call.",
  expired: "The call expired before the other computer took it.",
  skipped: "The person on the other computer chose not to run this call.",
  old_version:
    "The other computer runs an older lophn that cannot take this call; update lophn there.",
};

// 받는 컴퓨터가 사람의 명단에서 빠져 보낸 call이 닿을 길이 없다(not_found의 다른 글).
export const LEFT_ROSTER_TEXT =
  "The other computer is no longer one of the person's computers; the call was closed.";

// 받는 session이 이미 가져가 일하던 call이 재시작으로 끊겼다(lophn_restarted의 다른 글: 기본 글은 가져가기 전에 잃은 call이다).
// 다른 컴퓨터의 글은 그 기계가 실패 mail의 본문으로 싣는다.
export const TAKEN_RESTART_TEXTS = {
  local:
    "lophn restarted while the receiving session was working on this call.",
  remote:
    "lophn restarted on the other computer while the receiving session was working on this call.",
} as const;

// 취소 알림은 글이 없다. 알림 종류(call_cancelled)가 말한다.
export const CANCEL_TEXT = "";

// route가 보낸 쪽에 돌려주는 입력의 꼴이다. call 행이 없는 program 입력과 같다.
export function failureInput(
  call: Id<"cal">,
  reason: CallFailReason,
  unattended: boolean,
): RoutedInput {
  return {
    kind: "reply",
    from: { kind: "program" },
    call,
    reply_to: call,
    body: textBlocks(FAILURE_TEXTS[reason]),
    refs: [],
    delivery: "next_turn",
    message: null,
    reply: null,
    outcome: { state: "failed", reason },
    event: null,
    notice: null,
    step: null,
    unattended,
  };
}
