import type { Result } from "../../base/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { ContentBlock } from "../../protocol/lophn-agent/content-block.ts";
import type {
  AgentCallRow,
  CallFailReason,
  CallFrom,
  CallRef,
  CallReply,
  CallState,
} from "../../protocol/lophn-agent/calls.ts";
import type {
  AgentRuntime,
  Modality,
} from "../../protocol/lophn-agent/agent-values.ts";
import type {
  AgentAddress,
  AgentAtWorkspace,
  AgentId,
} from "../../protocol/lophn-agent/workspaces.ts";
import type {
  InputDelivery,
  RoutedInputKind,
} from "../../protocol/lophn-agent/inputs.ts";
import type { NoticeKind } from "../../protocol/lophn-agent/input-tags.ts";

// Router가 바깥에서 받는 것들이다. Router는 feature module을 import하지 않고,
// 구현은 main/daemon/wiring/router.ts가 끼운다.

// 받는 session 하나. Router가 배달 길을 고르는 데 쓴다.
export type TargetSession = {
  session: Id<"ses">;
  // lophn은 queue를 run-loop가 가져가고, harness는 runtime이 harness인 session의 queue를 shell host가 가져간다.
  transport: "lophn" | "harness";
  agent: AgentAtWorkspace;
  // archive, 지움, workspace 보관이면 false(새 입력을 받지 않는다).
  accepting: boolean;
  // `team spawn`으로 열린 session이면 연 session. 팀 규칙이 보낸 쪽과 받는 쪽의 관계를 이걸로 푼다.
  spawned_by: Id<"ses"> | null;
};

// 한 번 배달할 입력. 종류마다 tag를 고르는 것은 받는 쪽이 한다.
export type RoutedInput = {
  kind: RoutedInputKind;
  from: CallFrom;
  call: Id<"cal"> | null;
  reply_to: Id<"cal"> | null;
  body: ContentBlock[];
  refs: readonly CallRef[];
  // 사람 메시지만 steer가 될 수 있다.
  delivery: InputDelivery;
  // 받는 session 기록의 message. 사람 메시지는 보내는 쪽이 먼저 쓰고 그 id를 싣는다.
  // 나머지(call·reply·reaction·notice·step)는 null이고, transport가 배달하는 tx에서 기록을 쓴다.
  message: Id<"msg"> | null;
  // kind가 call일 때 답 방식.
  reply: CallReply | null;
  // kind가 reply일 때 그 call의 끝난 상태와 이유.
  outcome: {
    state: Exclude<CallState, "accepted">;
    reason: CallFailReason | null;
  } | null;
  // kind가 reaction이면 그 사실 이름.
  event: string | null;
  // kind가 notice면 그 종류.
  notice: NoticeKind | null;
  // kind가 step이면 그 workflow instance와 step 이름.
  step: { instance: Id<"wfi">; step: string } | null;
  // 사람 메시지, reaction, coding agent 입력은 false. step은 workflow가 실은 표시(true). agent의 call과 답은 보낸 turn이 실은 표시.
  // 늦은 실패와 취소 알림은 그 call의 표시.
  unattended: boolean;
};

// agent 명함에서 call을 받는 데 쓰는 것. 입력 modality와 답 방식.
export type AgentAccepts = {
  name: string;
  input: readonly Modality[];
  replies: readonly CallReply[];
};

export interface SessionDirectory {
  find(session: Id<"ses">): TargetSession | null;
  // agent 이름과 workspace 이름으로 받을 session 하나를 고른다. workspace가 없으면 home이다.
  // 이름을 짐작하지 않는다. 없으면 not_found.
  resolveAddress(address: AgentAddress): Result<AgentAtWorkspace>;
  // spawnedBy는 `team spawn`이 연 session(팀의 부모)이고 그 밖의 call은 null이다. 팀이 상한을 넘으면 conflict.
  open(
    tx: Tx,
    agent: AgentAtWorkspace,
    opener: CallFrom,
    spawnedBy: Id<"ses"> | null,
  ): Result<TargetSession>;

  // 받는 agent의 명함. 명함을 못 읽는 agent는 null이고 검사하지 않는다.
  accepts(agent: AgentId): AgentAccepts | null;
  // session 목록 tool이 쓴다.
  listOpen(): readonly (TargetSession & {
    handle: string;
    name: string;
    description: string | null;
    runtime: AgentRuntime;
    title: string | null;
    last_active_at: string | null;
  })[];
}

export interface InputTransport {
  // 그 transport가 맡은 session의 queue에 넣는다.
  deliver(tx: Tx, target: TargetSession, input: RoutedInput): Result<void>;
  // 취소 입력(notice)을 넣는다.
  cancel(
    tx: Tx,
    target: TargetSession | null,
    call: Id<"cal">,
    unattended: boolean,
  ): Result<void>;
}

export interface CallStore {
  insert(tx: Tx, record: AgentCallRow): Result<void>;
  byDedup(tx: Tx, sender: Id<"ses">, dedup: string): AgentCallRow | null;
  read(tx: Tx, call: Id<"cal">): AgentCallRow | null;
  move(
    tx: Tx,
    call: Id<"cal">,
    to: Exclude<CallState, "accepted">,
    reason: CallFailReason | null,
  ): Result<AgentCallRow>;
  // 받는 session의 turn이 이 입력을 가져갔음을 적는다. 답 없는 call은 여기서 done이 된다. 재시작 때 잃어버린 call을
  // 가리는 근거다.
  markConsumed(tx: Tx, call: Id<"cal">): Result<void>;
  // 끝나지 않았고 아직 가져가지 않은 call, 그리고 가져갔어도 끝나지 않은 ask call. queue와 앱 줄이 메모리라 lophn을 켤 때
  // 잃어버린 것이다.
  lost(tx: Tx): readonly AgentCallRow[];
  // 이 session이 받은 끝나지 않은 call. archive나 지움에서 receiver_ended로 닫는다.
  openReceivedBy(tx: Tx, session: Id<"ses">): readonly AgentCallRow[];
}
