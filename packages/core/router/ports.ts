import type { Result } from "../../base/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { CodingOptions } from "../../protocol/coding-agent/harness-id.ts";
import type {
  AgentCallRecord,
  CallAgent,
  CallFailReason,
  CallFrom,
  CallRef,
  CallReply,
  CallState,
  NamedAgent,
} from "../../protocol/lophn-agent/calls.ts";
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
  // lophn session은 run-loop 입력함, harness는 coding agent PTY다.
  transport: "lophn" | "harness";
  agent: CallAgent;
  // archive, 지움, place 보관이면 false(새 입력을 받지 않는다).
  accepting: boolean;
};

// 한 번 배달할 입력. 종류마다 tag를 고르는 것은 받는 쪽이 한다.
export type RoutedInput = {
  kind: RoutedInputKind;
  from: CallFrom;
  call: Id<"cal"> | null;
  reply_to: Id<"cal"> | null;
  body: string;
  refs: readonly CallRef[];
  // 사람 메시지만 steer가 될 수 있다.
  delivery: InputDelivery;
  // 받는 session 기록의 message. 사람 메시지는 보내는 쪽이 먼저 쓰고 그 id를 싣는다.
  // 나머지(call·reply·reaction·notice)는 null이고, transport가 배달하는 tx에서 기록을 쓴다.
  message: Id<"msg"> | null;
  // kind가 call일 때 답 방식.
  reply: CallReply | null;
  // kind가 reply일 때 그 call의 끝난 상태와 이유.
  outcome:
    | { state: Exclude<CallState, "accepted">; reason: CallFailReason | null }
    | null;
  // kind가 reaction이면 그 사실 이름.
  event: string | null;
  // kind가 notice면 그 종류.
  notice: NoticeKind | null;
  // 사람 메시지, reaction, coding agent 입력은 false. agent의 call과 답은 보낸 turn이 실은 표시.
  // 늦은 실패와 취소 알림은 그 call의 표시.
  unattended: boolean;
};

export interface SessionDirectory {
  find(session: Id<"ses">): TargetSession | null;
  // 이름(role, place의 project·앱 이름, Operator 이름)으로 받을 agent 하나를 고른다.
  // 이름을 짐작하지 않는다. 없으면 not_found.
  resolveAgent(named: NamedAgent): Result<CallAgent>;
  // 열린 session. 없으면 null.
  openOf(agent: CallAgent): TargetSession | null;
  open(tx: Tx, agent: CallAgent, opener: CallFrom): Result<TargetSession>;
  // session 목록 tool이 쓴다.
  listOpen(): readonly (TargetSession & { name: string })[];
}

export interface InputTransport {
  // lophn session이면 입력함에 넣고, harness session이면 PTY에 넣거나 그 앱의 줄에 세운다.
  // 'queued'는 받는 쪽이 돌고 있거나 줄에 서 있어 아직 turn이 안 시작됐다는 뜻이다.
  deliver(
    tx: Tx,
    target: TargetSession,
    input: RoutedInput,
    options: CodingOptions | null,
  ): Result<"delivered" | "queued">;
  // 취소 입력(notice)을 넣고, 줄에 서 있던 coding 맡기기는 줄에서 뺀다.
  cancel(
    tx: Tx,
    target: TargetSession | null,
    call: Id<"cal">,
    unattended: boolean,
  ): Result<void>;
  // 앱 줄에 서서 기다리는 coding 맡기기. session 목록 tool이 함께 보인다.
  queued(): readonly { call: Id<"cal">; app: Id<"app"> }[];
}

export interface CallStore {
  insert(tx: Tx, record: AgentCallRecord): Result<void>;
  byDedup(tx: Tx, sender: Id<"ses">, dedup: string): AgentCallRecord | null;
  read(tx: Tx, call: Id<"cal">): AgentCallRecord | null;
  move(
    tx: Tx,
    call: Id<"cal">,
    to: Exclude<CallState, "accepted">,
    reason: CallFailReason | null,
  ): Result<AgentCallRecord>;
  // 받는 session의 turn이 이 입력을 가져갔음을 적는다. 재시작 때 잃어버린 call을 가리는 근거다.
  markConsumed(tx: Tx, call: Id<"cal">): Result<void>;
  // 줄에서 기다리던 coding 맡기기가 나중에 session을 열었다. 받는 session을 적는다.
  setReceiver(tx: Tx, call: Id<"cal">, session: Id<"ses">): Result<void>;
  // 끝나지 않았고 아직 가져가지 않은 call. 입력함과 앱 줄이 메모리라 lophn을 켤 때 잃어버린 것이다.
  lost(tx: Tx): readonly AgentCallRecord[];
  // 이 session이 받은 끝나지 않은 call. archive나 지움에서 receiver_ended로 닫는다.
  openReceivedBy(tx: Tx, session: Id<"ses">): readonly AgentCallRecord[];
}
