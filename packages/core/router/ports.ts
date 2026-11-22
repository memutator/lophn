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
  MailDelivery,
} from "../../protocol/lophn-agent/calls.ts";
import type { Mail } from "../../protocol/lophn-agent/mail.ts";
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
  // lophn은 queue를 run-loop가 가져가고, harness는 runtime이 harness인 session의 queue를 core 안 extension host의 `harness` extension이 가져간다.
  transport: "lophn" | "harness";
  agent: AgentAtWorkspace;
  // archive, 지움, workspace 보관이면 false(새 입력을 받지 않는다).
  accepting: boolean;
  // 행이 열려 있다(lifecycle open). 다른 컴퓨터에서 도는 팀원의 자리는 accepting이 늘 false라 팀원으로 살아 있는지를 이것으로 본다.
  open: boolean;
  // `team spawn`으로 열린 session이면 연 session. 팀 규칙이 보낸 쪽과 받는 쪽의 관계를 이걸로 푼다.
  spawned_by: Id<"ses"> | null;
  // 다른 컴퓨터에서 온 mail이 연 session이면 그 기계. 그 session은 다른 컴퓨터로 보내지 못하고, 그 기계의 mail만 이 session에 이어 들어간다.
  opened_by_machine: Id<"mch"> | null;
  // 다른 컴퓨터에 연 팀원(`team spawn --on`)의 행이면 그 기계. turn은 그 기계에서 돌고 이 기계의 행은 팀 tree의 자리다.
  runs_on: Id<"mch"> | null;
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
  // 앱 화면이 보낸 사람 메시지의 이름표. 보낸 쪽(from)과 model이 받는 글은 바꾸지 않는다.
  via?: { app: Id<"app">; slug: string } | null;
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
  // skipAllowed가 아니면 agent 정의가 skip이어도 묻는 session으로 연다(다른 컴퓨터의 mail은 받는 기계의 허락이 있을 때만 skip을 따른다).
  // 없으면 정의대로다.
  open(
    tx: Tx,
    agent: AgentAtWorkspace,
    opener: CallFrom,
    spawnedBy: Id<"ses"> | null,
    options?: {
      skipAllowed?: boolean;
      // 다른 컴퓨터의 `team spawn --on`: 그 기계가 지은 id와 그 기계의 부모 session. 상한은 그 기계가 셌다.
      member?: { id: Id<"ses">; parent: Id<"ses"> };
    },
  ): Result<TargetSession>;
  // `team spawn --on`: 다른 컴퓨터에서 도는 팀원의 자리를 이 기계의 부모 밑에 연다. 팀 상한을 센다(넘으면 conflict).
  openMember(
    tx: Tx,
    parent: Id<"ses">,
    handle: string,
    machine: Id<"mch">,
  ): Result<TargetSession>;
  // 열린 session을 사람의 archive처럼 끝낸다(도는 turn, 받은 call, queue). 이미 끝났으면 false다. 다른 컴퓨터가 팀원을 끝냈거나
  // 연 기계가 팀원을 닫았을 때 쓴다.
  archive(tx: Tx, session: Id<"ses">): Result<boolean>;
  // 그 기계에서 도는 이 기계 팀원의 열린 자리.
  membersOn(tx: Tx, machine: Id<"mch">): Id<"ses">[];
  // 그 기계가 이 기계에 연 팀원의 열린 session.
  membersFrom(tx: Tx, machine: Id<"mch">): Id<"ses">[];
  // 그 session 밑에 연, 다른 컴퓨터에서 도는 팀원의 열린 자리.
  membersUnder(tx: Tx, parent: Id<"ses">): Id<"ses">[];
  // 기계를 건너는 project 정체(`pri_`)로 이 기계의 project를 찾는다. 없으면 null이다.
  projectOfIdentity(identity: string): Id<"prj"> | null;
  // 이 기계의 project(id나 정확한 이름)의 기계를 건너는 정체. 없는 project는 not_found, 정체가 없으면 null이다.
  identityOfProject(project: string): Result<Id<"pri">>;
  // 이 기계의 앱(id, slug, 표시 이름)의 id.
  appIdOf(app: string): Result<Id<"app">>;

  // 앱의 slug와 보관 여부. 없는 앱은 null이다.
  app(id: string): { slug: string; archived: boolean } | null;
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
  // 취소 입력(notice)을 넣는다. 받는 session이 이미 가져간 call이다.
  cancel(
    tx: Tx,
    target: TargetSession | null,
    call: Id<"cal">,
    unattended: boolean,
  ): Result<void>;
  // 아직 가져가지 않은 call의 입력을 commit 뒤 queue에서 거둔다. 그 session은 닫힌 call을 받지 않는다.
  withdraw(tx: Tx, target: TargetSession, call: Id<"cal">): Result<void>;
}

export interface CallStore {
  insert(tx: Tx, record: AgentCallRow): Result<void>;
  // 같은 보낸 쪽(session이나 앱)과 dedup 값의 call.
  byDedup(tx: Tx, sender: CallFrom, dedup: string): AgentCallRow | null;
  read(tx: Tx, call: Id<"cal">): AgentCallRow | null;
  // 다른 컴퓨터에 연 팀원의 첫 call(연 기계의 spawn call, 도는 기계에서 그 session을 연 call). 없으면 null이다.
  memberCall(tx: Tx, session: Id<"ses">): AgentCallRow | null;
  move(
    tx: Tx,
    call: Id<"cal">,
    to: Exclude<CallState, "accepted">,
    reason: CallFailReason | null,
    // 앱이 보낸 result call의 답 글. 다른 call은 싣지 않는다.
    result?: string,
  ): Result<AgentCallRow>;
  // 받는 session의 turn이 그 call 입력을 가져갔는가.
  consumed(tx: Tx, call: Id<"cal">): boolean;
  // 받는 session의 turn이 이 입력을 가져갔음을 적는다. 답 없는 call은 여기서 done이 된다. 재시작 때 잃어버린 call을
  // 가리는 근거다.
  markConsumed(tx: Tx, call: Id<"cal">): Result<void>;
  // 끝나지 않았고 아직 가져가지 않은 call, 그리고 가져갔어도 끝나지 않은 ask call. queue와 앱 줄이 메모리라 lophn을 켤 때
  // 잃어버린 것이다. 다른 컴퓨터로 보낸 call은 이 기계의 queue에 없어 빠진다.
  lost(tx: Tx): readonly AgentCallRow[];
  // 다른 컴퓨터로 보낸 끝나지 않은 행의 배달 상태와 그 기계에서 받은 session(알면)을 적는다.
  setDelivery(
    tx: Tx,
    call: Id<"cal">,
    delivery: MailDelivery,
    session?: Id<"ses"> | null,
  ): Result<void>;
  // 이 session이 받은 끝나지 않은 call. archive나 지움에서 receiver_ended로 닫는다.
  openReceivedBy(tx: Tx, session: Id<"ses">): readonly AgentCallRow[];
  // 이 session이 보낸 끝나지 않은 ask call. session이 끝나면 취소한다(기다리던 짝은 거절로 풀린다).
  openAsksSentBy(tx: Tx, session: Id<"ses">): readonly AgentCallRow[];
  // 그 기계의 그 session이 보내 이 기계가 받은 끝나지 않은 call. 그 기계에서 도는 팀원의 자리가 끝나면 취소한다.
  openSentFromRemote(
    tx: Tx,
    machine: Id<"mch">,
    session: Id<"ses">,
  ): readonly AgentCallRow[];
}

// outbox에 넣을 mail. id와 seq는 넣을 때 정한다.
type Draft<M> = M extends Mail ? Omit<M, "id" | "seq"> : never;
export type MailDraft = Draft<Mail>;

// 다른 기계로 낼 mail. 받는 기계가 ack할 때까지 남는다.
export interface MailOutbox {
  // seq는 받는 기계(to_machine)마다 하나씩 는다.
  put(tx: Tx, draft: MailDraft): Result<Mail>;
  remove(tx: Tx, id: string): Result<void>;
  read(tx: Tx, id: string): Mail | null;
  // 그 call의 아직 내지 못한 call mail.
  callMailOf(tx: Tx, call: string): Mail | null;
  // 만료 시각(expires_at)이 now보다 앞인 줄.
  expired(tx: Tx, now: string): Mail[];
  // 이 기계가 다른 컴퓨터로 보내 그 기계의 대기 목록에 섰거나(held) 받았는지 모르는(unknown) 끝나지 않은 call 가운데 before보다 먼저 보낸 것.
  // 돌기 시작한(running) call은 빠진다: 나이가 아니라 답, 실패, 취소, 재시작 규칙으로 끝난다.
  sentOpenBefore(tx: Tx, before: string): string[];
  // 그 기계로 낼 줄 전부를 지운다(그 기계가 명단에서 빠졌다).
  dropPeer(tx: Tx, peer: string): void;
  // 이 기계가 그 기계로 보낸 끝나지 않은 call.
  openSentTo(tx: Tx, peer: string): string[];
}

export const MAIL_SEEN_STATES = [
  "applied",
  "held",
  "started",
  "skipped",
  "expired",
  "cancelled",
  "refused",
] as const;
export type MailSeenState = (typeof MAIL_SEEN_STATES)[number];

export type MailSeenRow = {
  origin: string;
  id: string;
  call: string;
  kind: Mail["kind"];
  state: MailSeenState;
  // 대기 목록에 선(held) 줄만 mail을 든다.
  mail: Mail | null;
  computer: string;
  arrived_at: string;
};

export type StepEnding =
  | CallFailReason
  | "closed_there"
  | "cancelled_here"
  | "left_roster";

// workflow가 다른 컴퓨터로 넘긴 step(보낸 쪽이 program인 call 행)의 끝과 바뀜을 workflows에 알린다. 구현은 wiring이 끼운다.
export interface SentSteps {
  // report 없이 끝났다. instance에 사람이 읽는 줄을 남긴다. closed_there는 그 컴퓨터에서 report 아닌 길로 닫힌 것(취소, call 답)이고
  // cancelled_here는 이 컴퓨터에서 그 call을 취소한 것이다.
  failed(tx: Tx, call: string, ending: StepEnding): Result<void>;
  // 배달 상태나 받은 session이 바뀌었다. instance를 보는 화면이 다시 읽는다.
  changed(tx: Tx, call: string): void;
}

// 받은 mail. 같은 mail id(보낸 기계마다)를 한 번만 적용한다.
export interface MailSeen {
  // 처음 본 mail이면 적고 true, 이미 본 것이면 false.
  mark(tx: Tx, row: MailSeenRow): boolean;
  read(tx: Tx, origin: string, id: string): MailSeenRow | null;
  // 그 기계가 그 call의 cancel mail을 보냈는지. 폴더 길은 cancel이 call보다 먼저 닿을 수 있다.
  cancelSeen(tx: Tx, origin: string, call: string): boolean;
  // 대기 목록에 선 줄의 끝(정함, 만료, 취소). 든 mail을 지운다.
  close(
    tx: Tx,
    origin: string,
    id: string,
    state: Exclude<MailSeenState, "applied" | "held" | "refused">,
  ): void;
  // 그 기계의 그 call로 대기 목록에 선 줄.
  heldOfCall(tx: Tx, origin: string, call: string): MailSeenRow | null;
  // 대기 목록에 선 모든 줄.
  held(tx: Tx): MailSeenRow[];
  // 대기 목록에 서지 않은 줄 가운데 before보다 먼저 닿은 것을 지운다.
  prune(tx: Tx, before: string): void;
}
