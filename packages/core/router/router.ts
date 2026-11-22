import { err, ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import {
  blocksText,
  textBlocks,
  type ContentBlock,
} from "../../protocol/lophn-agent/content-block.ts";
import type {
  AgentCallRow,
  CallAddressInput,
  CallDecision,
  CallFailReason,
  CallFrom,
  CallRef,
  CallReply,
  CallState,
  CallTarget,
  RemoteAddress,
} from "../../protocol/lophn-agent/calls.ts";
import {
  LOPHN_AGENT_HANDLE,
  type Modality,
} from "../../protocol/lophn-agent/agent-values.ts";
import {
  type CallPolicy,
  isPrivate,
  mayCall,
  mayReachWorkspace,
} from "../../protocol/lophn-agent/call-policy.ts";
import {
  type Mail,
  type MailApplied,
  type MailAuthor,
  MAIL_EXPIRY_MS,
  MAIL_LATE_MS,
  MAIL_TEXT_MAX_BYTES,
  mailBodySchema,
  type TurnEndedKind,
} from "../../protocol/lophn-agent/mail.ts";
import { requesterName } from "../../protocol/machine/requester.ts";
import {
  type AgentAddress,
  type AgentAtWorkspace,
  type AgentId,
  isLophn,
  lophnIdOf,
  type Workspace,
} from "../../protocol/lophn-agent/workspaces.ts";
import { STATE_CHANGED_TOPIC } from "../storage/ledger/after-commit.ts";
import {
  addressingOf,
  APP_CALL_SETTLED_TOPIC,
  ASK_ANSWERED_TOPIC,
  CALL_SESSION_OPENED_TOPIC,
  ASK_ENDED_TOPIC,
  calId,
  FAILURE_TEXTS,
  failureCode,
  failureInput,
  isFinished,
  MAIL_QUEUED_TOPIC,
  LEFT_ROSTER_TEXT,
  remoteStepBody,
  type RouteInput,
  TAKEN_RESTART_TEXTS,
  type RouteResult,
  sesId,
  teamMayReach,
} from "./model.ts";
import type {
  CallStore,
  InputTransport,
  MailDraft,
  MailOutbox,
  MailSeen,
  SentSteps,
  StepEnding,
  RoutedInput,
  SessionDirectory,
  TargetSession,
} from "./ports.ts";

export type RouterDeps = {
  directory: SessionDirectory;
  transport: InputTransport;
  store: CallStore;
  // 다른 기계로 낼 mail과 받은 mail.
  outbox: MailOutbox;
  seen: MailSeen;
  // 이 기계(`machine.json`).
  self(): string;
  // workflow가 다른 컴퓨터로 넘긴 step의 끝과 바뀜.
  steps: SentSteps;
  // 지금 call 정책. 설정이 바뀌면 다음 call부터 닿는다.
  callPolicy(): CallPolicy;
  // commit 뒤 main thread에 일을 알린다(tx가 되돌아가면 버려진다). ask call의 답과 끝남이 이 길로 간다.
  announce(tx: Tx, topic: string, data: unknown): void;
};

// 받는 session의 transport에 따라 queue를 고른다. 받을 곳이 없는 취소는 lophn 쪽이 조용히 넘긴다.
export function transportBySession(
  transports: Record<TargetSession["transport"], InputTransport>,
): InputTransport {
  const of = (target: TargetSession | null) =>
    transports[target?.transport ?? "lophn"];
  return {
    deliver: (tx, target, input) => of(target).deliver(tx, target, input),
    cancel: (tx, target, call, unattended) =>
      of(target).cancel(tx, target, call, unattended),
  };
}

export interface Router {
  // 앱이 보내는 call의 보낸 쪽. 그 앱의 지금 slug로 얼린다. 없는 앱은 not_found, 보관한 앱은 conflict다.
  appSender(app: string): Result<Extract<CallFrom, { kind: "app" }>>;
  // 모든 보낸 쪽이 쓰는 입구. 사람, program, agent, 앱.
  route(tx: Tx, input: RouteInput): Result<RouteResult>;
  reply(
    tx: Tx,
    from: { session: string },
    input: {
      call: string;
      body: ContentBlock[];
      refs: CallRef[];
      unattended?: boolean;
      // ask = approval인 call의 답은 결정이 있어야 하고 다른 call의 답은 결정을 싣지 않는다.
      decision?: CallDecision;
      // core가 마지막 응답 글을 대신 보내는 답이다. 승인 call은 명시한 허락이 없으므로 거절로 닫는다.
      auto?: boolean;
    },
  ): Result<{ delivered: boolean; closed: boolean }>;
  cancel(
    tx: Tx,
    by: CallFrom,
    input: { call: string; reason?: string },
  ): Result<AgentCallRow>;
  // session을 archive하거나 지울 때 그 session이 받은 열린 call을 failed(receiver_ended)로 닫는다.
  failReceivedBy(tx: Tx, session: string): Result<void>;
  // 그 session이 받은 열린 call 하나를 failed(receiver_ended)로 닫는다. 받은 turn이 답 없이 끝났는데 session은 살아 있을 때다(GUI 탭 팀원).
  // 열린 call이 아니면(이미 답했거나 닫혔다) false다.
  failReceived(tx: Tx, session: string, call: string): Result<boolean>;
  // lophn을 켤 때 부른다. queue와 앱 줄이 메모리라 잃어버린 call을 failed(lophn_restarted)로 닫는다.
  // `notify`이면 보낸 session에 이유를 돌려준다. 닫은 수를 돌려준다.
  failLostOnStart(tx: Tx, notify: boolean): Result<number>;
  // 받는 session의 turn이 이 call의 입력을 가져갔다(turn을 시작할 때 부른다).
  markConsumed(tx: Tx, call: string): Result<void>;
  // 받는 session의 turn이 call을 가져간 뒤 끝나지 못했다(실패, 멈춤, 재시작). 아직 답하지 않은 result call을 보낸 쪽에 실패로 돌려준다.
  // 다른 컴퓨터에서 받은 workflow step(`step`)은 닫지 않고(뒤에 낸 report가 닿아야 한다) 보낸 기계에 program이 쓴 진행 줄 mail을 낸다.
  abandoned(
    tx: Tx,
    input: {
      call: string;
      session: string;
      ended: TurnEndedKind;
      step: boolean;
      notify: boolean;
    },
  ): Result<void>;
  // workflow의 step을 다른 컴퓨터의 참가자에게 call mail로 낸다. 보낸 쪽이 program인 행을 쓴다.
  sendStep(tx: Tx, input: SendStepInput): Result<{ call: string }>;
  // 다른 컴퓨터의 참가자가 낸 report(reply mail)를 받는다. mail을 본 것으로 적고, next가 있으면 그 step call을 끝낸다. 그 기계로 보낸
  // 열린 step call이 아니거나 이미 본 mail이면 conflict다(아무것도 바꾸지 않는다).
  acceptStepReport(
    tx: Tx,
    input: { mail: Mail; origin: MailOrigin },
  ): Result<{ closes: boolean }>;
  // 다른 컴퓨터에서 받은 step을 그 session이 report한다. 보낸 기계로 reply mail을 내고 next가 있으면 끝낸다.
  reportStep(tx: Tx, input: ReportStepInput): Result<void>;
  // 다른 컴퓨터의 agent에게 call mail을 낸다. 행이 있고 queue가 없다(앱이 보낸 call처럼). 검사는 main thread가 마쳤다.
  sendRemote(tx: Tx, input: SendRemoteInput): Result<SentRemote>;
  // 다른 컴퓨터에서 온 mail 하나를 적용한다. 같은 mail id는 한 번만 돈다.
  applyMail(tx: Tx, input: ApplyMailInput): Result<MailApplied>;
  // applyMail이 오류로 되돌아간 mail을 본 것으로 적고, call mail이면 실패 mail을 낸다.
  refuseMail(
    tx: Tx,
    input: { mail: Mail; origin: MailOrigin; reason: CallFailReason },
  ): Result<void>;
  // 낸 mail의 결과를 적는다.
  mailSent(
    tx: Tx,
    input: { mail: string; result: MailSendResult },
  ): Result<void>;
  // 받는 기계의 사람이 대기 목록의 mail을 정한다. 줄이 없으면 not_found, 이미 끝난 줄이면 conflict다. 만료됐으면 줄을 expired로
  // 닫고 {failed, expired}를 돌려준다(오류로 돌리면 닫은 것이 되돌아간다).
  decideHold(tx: Tx, input: DecideHoldInput): Result<MailApplied>;
  // 만료된 mail을 닫는다: 이 기계가 낸 줄(보낸 call은 expired로 끝낸다), 대기 목록의 줄. 오래 지난 받은 기록을 지운다.
  // removed는 사람의 명단에서 정해진 빼기로 빠진 기계다. 그 기계로 보낸 끝나지 않은 call은 곧바로 닫고 낼 줄은 지운다.
  sweepMail(
    tx: Tx,
    removed: readonly string[],
  ): Result<{ expired: number; gone: number }>;
}

export type SendStepInput = {
  instance: string;
  step: string;
  // mail을 쓴 쪽의 이름(hold card와 받은 쪽 표시).
  workflow: string;
  // 보내는 workspace(instance의 project). private이면 보내지 못한다.
  workspace: Workspace | null;
  peer: MailOrigin;
  address: RemoteAddress;
  body: ContentBlock[];
};

export type ReportStepInput = {
  call: string;
  session: string;
  text: string;
  next: string | null;
  choice: "new" | "same";
  unattended: boolean;
};

export type DecideHoldInput = {
  origin: string;
  mail: string;
  // drop은 사람의 결정이 아니다: 보낸 컴퓨터가 명단에 없어 줄을 닫는다.
  decision: "run_now" | "skip" | "drop";
  // 지금 그 기계에 준 허락. 정하는 때의 것을 쓴다.
  skipAllowed: boolean;
};

// mail을 보낸 기계. computer는 이 기계 명단의 그 컴퓨터 이름이다.
export type MailOrigin = { machine: string; computer: string };

export type SendRemoteInput = {
  session: string;
  dedup: string;
  self: string;
  peer: MailOrigin;
  address: RemoteAddress;
  reply: CallReply;
  body: ContentBlock[];
  unattended: boolean;
};

export type SentRemote = {
  call: string;
  state: CallState;
  fail_reason: CallFailReason | null;
};

export type ApplyMailInput = {
  mail: Mail;
  origin: MailOrigin;
  // 받는 기계의 사람이 그 기계에 허락을 주었으면 agent 정의의 skip을 따른다.
  skipAllowed: boolean;
  // 폴더 길은 답이 없어 받은 call의 상태를 state mail로 알린다.
  via: "link" | "folder";
};

export type MailSendResult =
  | { kind: "acked"; applied: MailApplied }
  | { kind: "unknown" }
  // 상대가 mail route를 모른다(옛 판).
  | { kind: "refused" };

const NOT_APPLIED: MailApplied = {
  delivery: null,
  reason: null,
  session: null,
};

// 받는 곳을 푼 결과. 실패하면 이유와, 행에 남길 수 있는 풀린 받는 곳(이름을 못 풀었으면 null)이다.
type Resolved =
  | { ok: true; to: CallTarget; target: TargetSession; opened?: boolean }
  | { ok: false; reason: CallFailReason; to: CallTarget | null };

function failed(reason: CallFailReason, to: CallTarget | null): Resolved {
  return { ok: false, reason, to };
}

const MODALITY_OF = {
  text: "text",
  image: "image",
  resource_link: "file",
  resource: "file",
} as const satisfies Record<ContentBlock["type"], Modality>;

export function createRouter(deps: RouterDeps): Router {
  const {
    directory,
    transport,
    store,
    outbox,
    seen,
    self,
    callPolicy,
    announce,
  } = deps;

  function open(
    tx: Tx,
    from: CallFrom,
    agent: AgentAtWorkspace,
    to: CallTarget,
    spawn: boolean,
    skipAllowed: boolean | undefined,
  ): Result<Resolved> {
    const opened = directory.open(
      tx,
      agent,
      from,
      spawn && from.kind === "agent" ? sesId(from.session) : null,
      { skipAllowed },
    );
    if (opened.ok) {
      return ok({ ok: true, to, target: opened.value, opened: true });
    }
    // spawn은 실패를 call의 실패가 아니라 오류로 돌린다(팀이 가득 찬 conflict가 closed로 바뀌지 않게).
    if (spawn) return opened;
    if (opened.error.code === "conflict") return ok(failed("closed", to));
    if (opened.error.code === "not_found") return ok(failed("not_found", to));
    return opened;
  }

  // 받는 곳 해석 순서. 이름은 정확히 맞는 것만 푼다.
  function resolve(
    tx: Tx,
    from: CallFrom,
    input: RouteInput,
  ): Result<Resolved> {
    const addressing = addressingOf(input.to);
    let address: AgentAddress;
    let session: string | null = null;
    switch (addressing.form) {
      case "session": {
        const to: CallTarget = {
          kind: "open_session",
          session: addressing.session,
        };
        const target = directory.find(sesId(addressing.session));
        if (target === null) return ok(failed("not_found", to));
        if (!target.accepting) return ok(failed("closed", to));
        return ok({ ok: true, to, target });
      }
      case "address":
        address = addressing.address;
        break;
      case "address_or_session":
        address = addressing.address;
        session = addressing.session;
        break;
    }
    const resolved = directory.resolveAddress(address);
    if (!resolved.ok) {
      return resolved.error.code === "not_found"
        ? ok(failed("not_found", null))
        : resolved;
    }
    const spawn = input.spawn === true;
    // workspace를 빼면 spawn과 lophn(workspace마다 하나)은 부른 쪽 workspace에 열린다. 다른 agent의 call은 home이다.
    // 앱이 보낸 call은 workspace를 빼면 모든 agent가 그 앱 workspace에 열린다(앱 화면이 여는 session과 같다).
    const inCaller =
      address.workspace === undefined &&
      (from.kind === "app" ||
        (from.kind === "agent" && (spawn || isLophn(resolved.value.agent))));
    const callerWorkspace =
      from.kind === "app"
        ? ({ kind: "app", id: from.app } as Workspace)
        : inCaller && from.kind === "agent"
          ? (directory.find(sesId(from.session))?.agent.workspace ?? null)
          : null;
    const agent = inCaller
      ? {
          agent: isLophn(resolved.value.agent)
            ? lophnIdOf(callerWorkspace)
            : resolved.value.agent,
          workspace: callerWorkspace,
        }
      : resolved.value;
    if (session === null) {
      const to: CallTarget = { kind: "new_session", agent };
      return open(tx, from, agent, to, spawn, input.skipAllowed);
    }
    const to: CallTarget = {
      kind: "open_session_or_new",
      session,
      agent,
    };
    const target = directory.find(sesId(session));
    if (target !== null && target.accepting) {
      return ok({ ok: true, to, target });
    }
    return open(tx, from, agent, to, spawn, input.skipAllowed);
  }

  function inputOf(input: RouteInput, call: string | null): RoutedInput {
    return {
      kind: input.kind,
      // step 입력은 늘 program이 보낸 것이다(다른 컴퓨터에서 온 step도 행의 보낸 쪽만 remote다).
      from: input.kind === "step" ? { kind: "program" } : input.from,
      call: call === null ? null : calId(call),
      reply_to: input.reply_to === null ? null : calId(input.reply_to),
      body: input.body,
      refs: input.refs,
      delivery: input.kind === "message" ? input.delivery : "next_turn",
      message:
        input.message === undefined || input.message === null
          ? null
          : (input.message as Id<"msg">),
      reply: input.kind === "call" ? input.reply : null,
      outcome: null,
      event: input.event ?? null,
      notice: input.notice ?? null,
      step: input.step ?? null,
      via: input.via ?? null,
      unattended: input.unattended === true,
    };
  }

  // 배달 뒤에 늦게 알게 된 실패를 보낸 session에 새 입력으로 돌려준다. 보낸 session이 없어졌으면 조용히 둔다.
  function notifyFailed(
    tx: Tx,
    sender: string,
    call: string,
    reason: CallFailReason,
    unattended: boolean,
    // 이유의 기본 글 대신 쓸 글(가져간 뒤 재시작, 다른 컴퓨터가 실은 글).
    body?: ContentBlock[],
  ): Result<void> {
    const target = directory.find(sesId(sender));
    if (target === null || !target.accepting) return ok(undefined);
    const input = failureInput(calId(call), reason, unattended);
    const delivered = transport.deliver(
      tx,
      target,
      body === undefined ? input : { ...input, body },
    );
    return delivered.ok ? ok(undefined) : delivered;
  }

  function newRecord(
    tx: Tx,
    call: string,
    from: CallFrom,
    input: Omit<RouteInput, "to">,
    to: CallTarget,
    receiver: string | null,
    state: CallState,
    reason: CallFailReason | null,
  ): AgentCallRow {
    const at = tx.now();
    return {
      call,
      from,
      to,
      receiver_session: receiver,
      reply: input.reply,
      state,
      fail_reason: reason,
      dedup: input.dedup,
      unattended: input.unattended === true,
      ask: input.ask ?? null,
      created_at: at,
      state_changed_at: at,
      result: null,
      delivery: null,
      remote_session: null,
    };
  }

  // 배달 실패. 조용히 버리지 않는다.
  function deliveryFailed(
    tx: Tx,
    input: Omit<RouteInput, "to">,
    to: CallTarget | null,
    reason: CallFailReason,
  ): Result<RouteResult> {
    const from = input.from;
    if (from.kind === "human") {
      return err({ code: failureCode(reason), message: FAILURE_TEXTS[reason] });
    }
    if (
      from.kind !== "agent" &&
      from.kind !== "app" &&
      from.kind !== "remote"
    ) {
      return ok({
        call: null,
        state: "failed",
        fail_reason: reason,
        session: null,
      });
    }
    const call = input.call ?? tx.newId("cal");
    // 이름을 못 푼 call은 받는 곳을 적을 수 없어 행이 없다. ID와 이유는 그대로 돌려준다.
    if (to !== null) {
      const record = newRecord(
        tx,
        call,
        from,
        input,
        to,
        null,
        "failed",
        reason,
      );
      const stored = store.insert(tx, record);
      if (!stored.ok) return stored;
      changedIfRemote(tx, record);
    }
    return ok({ call, state: "failed", fail_reason: reason, session: null });
  }

  // agent가 보낸 call만 받는 agent의 명함으로 거른다. err로 돌려 tx가 되돌아가므로 call 행도 새 session도 남지 않는다.
  function refusal(
    agent: AgentId,
    input: RouteInput,
  ): Result<RouteResult> | null {
    const accepts = directory.accepts(agent);
    if (accepts === null) return null;
    const missing = [
      ...new Set(input.body.map((block) => MODALITY_OF[block.type])),
    ].filter((modality) => !accepts.input.includes(modality));
    if (missing.length > 0) {
      return err({
        code: "invalid_input",
        message: `agent ${accepts.name} does not accept ${missing.join(", ")} input`,
      });
    }
    if (!accepts.replies.includes(input.reply)) {
      return err({
        code: "invalid_input",
        message: `agent ${accepts.name} does not support reply "${input.reply}"`,
      });
    }
    return null;
  }

  // agent가 보낸 call만 workspace 정책과 agent 정책으로 거른다. refusal과 같이 err로 돌려 tx가 되돌아간다.
  function policyRefusal(
    sender: string,
    to: AgentAtWorkspace,
    reply: RouteInput["reply"],
  ): Result<RouteResult> | null {
    const from = directory.find(sesId(sender));
    if (from === null) {
      return err({ code: "not_found", message: "sender session not found" });
    }
    return mayCall(callPolicy(), from.agent, to, reply)
      ? null
      : err({
          code: "forbidden",
          message: "the call policy does not allow this call",
        });
  }

  // 앱이 보낸 call은 그 앱 workspace에서 닿을 수 있는 workspace의 session과 agent로만 간다. agent 쌍 규칙과 팀 규칙은 앱에 없다.
  function appPolicyRefusal(
    app: string,
    to: AgentAtWorkspace,
  ): Result<RouteResult> | null {
    return mayReachWorkspace(
      callPolicy(),
      { kind: "app", id: app } as Workspace,
      to.workspace,
    )
      ? null
      : err({
          code: "forbidden",
          message: "the call policy does not allow this call",
        });
  }

  // 규칙 2. agent가 보낸 call만 거른다. 다른 거절과 같이 err로 돌려 tx가 되돌아간다.
  function teamRefusal(
    sender: string,
    target: TargetSession,
  ): Result<RouteResult> | null {
    const from = directory.find(sesId(sender));
    return from === null || teamMayReach(directory.find, from, target)
      ? null
      : err({
          code: "forbidden",
          message:
            "a team member calls its parent, siblings and its own members only",
        });
  }

  // call을 끝낸 상태로 옮긴다. 앱이 보낸 call이면 commit 뒤 그 앱에 `call.settled`를 낸다(앱에는 queue가 없어 끝남을 알릴 곳이 이 event다).
  function finish(
    tx: Tx,
    record: AgentCallRow,
    to: Exclude<CallState, "accepted">,
    reason: CallFailReason | null,
    result?: string,
  ): Result<AgentCallRow> {
    const moved = store.move(tx, calId(record.call), to, reason, result);
    if (moved.ok && record.from.kind === "app") {
      announce(tx, APP_CALL_SETTLED_TOPIC, {
        app: record.from.app,
        call: record.call,
        state: to,
        fail_reason: reason,
      });
    }
    if (moved.ok) changedIfRemote(tx, record);
    return moved;
  }

  // 다른 컴퓨터를 건넌 call 행이 바뀌면 화면의 call card가 다시 읽는다.
  function changedIfRemote(tx: Tx, record: AgentCallRow): void {
    if (record.from.kind === "remote" || record.to.kind === "remote") {
      announce(tx, STATE_CHANGED_TOPIC, [
        { name: "agent_calls", id: record.call },
      ]);
    }
    if (record.from.kind === "program" && record.to.kind === "remote") {
      deps.steps.changed(tx, record.call);
    }
  }

  function stamp(tx: Tx): { sent_at: string; expires_at: string } {
    const sent_at = tx.now();
    return {
      sent_at,
      expires_at: new Date(Date.parse(sent_at) + MAIL_EXPIRY_MS).toISOString(),
    };
  }

  // mail을 쓴 쪽. session이 없는 알림(배달 실패)은 그 기계의 lophn 이름으로 낸다.
  function authorOf(session: string | null): MailAuthor {
    const target = session === null ? null : directory.find(sesId(session));
    if (target === null) {
      return {
        machine: self(),
        agent: LOPHN_AGENT_HANDLE,
        session: null,
        name: LOPHN_AGENT_HANDLE,
      };
    }
    const agent = target.agent.agent;
    return {
      machine: self(),
      agent,
      session: target.session,
      name: requesterName(directory.accepts(agent)?.name ?? agent),
    };
  }

  // outbox에 넣고 commit 뒤 main thread의 drain을 깨운다.
  function queue(tx: Tx, draft: MailDraft): Result<Mail> {
    const put = outbox.put(tx, draft);
    if (put.ok) announce(tx, MAIL_QUEUED_TOPIC, { peer: draft.to_machine });
    return put;
  }

  // 받은 call의 실패를 보낸 기계에 알린다. 글은 받는 쪽이 자기 글로 만든다.
  function queueFailure(
    tx: Tx,
    call: string,
    peer: string,
    reason: CallFailReason,
    unattended: boolean,
    text?: string,
  ): Result<Mail> {
    return queue(tx, {
      kind: "reply",
      call,
      from: authorOf(null),
      to_machine: peer,
      ...stamp(tx),
      body: text === undefined ? null : textBlocks(text),
      outcome: { state: "failed", reason },
      unattended,
    });
  }

  // 받은 call의 끝(답 없는 call의 소비, 받는 기계의 사람이 취소)을 보낸 기계에 알린다. 입력을 넣지 않고 행만 닫는다.
  function queueClosed(
    tx: Tx,
    record: AgentCallRow,
    state: "done" | "cancelled",
  ): Result<Mail> | null {
    if (record.from.kind !== "remote") return null;
    return queue(tx, {
      kind: "reply",
      call: calId(record.call),
      from: authorOf(record.receiver_session),
      to_machine: record.from.machine,
      ...stamp(tx),
      body: null,
      outcome: { state, reason: null },
      unattended: record.unattended,
    });
  }

  // 다른 컴퓨터로 가는 답은 글만 싣는다(image blob은 기계를 건너지 않는다).
  function remoteBody(body: ContentBlock[]): Result<ContentBlock[]> {
    if (body.some((block) => block.type !== "text")) {
      return err({
        code: "invalid_input",
        message: "a reply to another computer carries text only",
      });
    }
    return mailBodySchema.safeParse(body).success
      ? ok(body)
      : err({
          code: "invalid_input",
          message: `a reply to another computer is at most ${MAIL_TEXT_MAX_BYTES} bytes of text`,
        });
  }

  function route(tx: Tx, input: RouteInput): Result<RouteResult> {
    const from = input.from;
    if (
      (from.kind === "agent" || from.kind === "app") &&
      input.dedup !== null
    ) {
      const prior = store.byDedup(tx, from, input.dedup);
      if (prior !== null) {
        return ok({
          call: prior.call,
          state: prior.state,
          fail_reason: prior.fail_reason,
          session: prior.receiver_session,
        });
      }
    }
    const resolved = resolve(tx, from, input);
    if (!resolved.ok) return resolved;
    if (!resolved.value.ok) {
      return deliveryFailed(
        tx,
        input,
        resolved.value.to,
        resolved.value.reason,
      );
    }
    const { to, target, opened } = resolved.value;
    if (from.kind === "agent") {
      const refused =
        policyRefusal(from.session, target.agent, input.reply) ??
        teamRefusal(from.session, target) ??
        refusal(target.agent.agent, input);
      if (refused !== null) return refused;
    } else if (from.kind === "app") {
      const refused =
        appPolicyRefusal(from.app, target.agent) ??
        refusal(target.agent.agent, input);
      if (refused !== null) return refused;
    }
    const hasRow =
      from.kind === "agent" || from.kind === "app" || from.kind === "remote";
    const call = hasRow ? (input.call ?? tx.newId("cal")) : null;
    const delivered = transport.deliver(tx, target, inputOf(input, call));
    if (!delivered.ok) return delivered;
    const receiver = target.session;
    if (call !== null && hasRow) {
      const record = newRecord(
        tx,
        call,
        from,
        input,
        to,
        receiver,
        "accepted",
        null,
      );
      const stored = store.insert(tx, record);
      if (!stored.ok) return stored;
      changedIfRemote(tx, record);
    }
    // team spawn의 자식 탭은 그 command가 relation과 같이 따로 요청한다. 앱이 연 session은 앱 화면이 자리다.
    if (opened === true && from.kind === "agent" && input.spawn !== true) {
      announce(tx, CALL_SESSION_OPENED_TOPIC, {
        caller: from.session,
        session: receiver,
      });
    }
    return ok({
      call,
      state: "accepted",
      fail_reason: null,
      session: receiver,
    });
  }

  function reply(
    tx: Tx,
    from: { session: Id<"ses"> },
    input: {
      call: Id<"cal">;
      body: ContentBlock[];
      refs: CallRef[];
      unattended?: boolean;
      decision?: CallDecision;
      auto?: boolean;
    },
  ): Result<{ delivered: boolean; closed: boolean }> {
    const record = store.read(tx, calId(input.call));
    if (record === null) {
      return err({ code: "not_found", message: "call not found" });
    }
    const sender = record.from.kind === "agent" ? record.from.session : null;
    const asReceiver = record.receiver_session === from.session;
    // conversation은 맡긴 쪽도 같은 call에 말을 잇는다.
    const asSender = record.reply === "conversation" && sender === from.session;
    if (!asReceiver && !asSender) {
      return err({ code: "forbidden", message: "not a party of this call" });
    }
    if (record.reply === "none") {
      return err({ code: "conflict", message: "this call takes no reply" });
    }
    if (isFinished(record.state)) return ok({ delivered: false, closed: true });
    // 다른 컴퓨터를 건넌 call의 답은 queue가 아니라 그 기계로 가는 mail이다.
    const peer =
      asReceiver && record.from.kind === "remote"
        ? record.from.machine
        : asSender && record.to.kind === "remote"
          ? record.to.machine
          : null;
    if (peer !== null) {
      const body = remoteBody(input.body);
      if (!body.ok) return body;
      const result = asReceiver && record.reply === "result";
      const queued = queue(tx, {
        kind: "reply",
        call: calId(record.call),
        from: authorOf(from.session),
        to_machine: peer,
        ...stamp(tx),
        body: body.value,
        outcome: result ? { state: "done", reason: null } : null,
        unattended: input.unattended === true,
      });
      if (!queued.ok) return queued;
      if (result) {
        const closed = finish(tx, record, "done", null);
        if (!closed.ok) return closed;
      }
      return ok({ delivered: true, closed: false });
    }
    if (record.from.kind === "app") {
      // 앱에는 받을 queue가 없다. 답은 call 행에 글로 남고 앱은 `call.settled`를 받아 읽는다.
      const closed = finish(tx, record, "done", null, blocksText(input.body));
      return closed.ok ? ok({ delivered: true, closed: false }) : closed;
    }
    const decision =
      input.decision ??
      (input.auto === true && record.ask === "approval" ? "reject" : null);
    if (asReceiver && record.ask !== null) {
      if ((record.ask === "approval") !== (decision !== null)) {
        return err({
          code: "invalid_input",
          message:
            record.ask === "approval"
              ? "answer an approval call with --allow or --reject"
              : "a question call takes no decision",
        });
      }
      // 답은 자식의 queue가 아니라 main thread의 짝(request·질문)으로 간다.
      const closed = store.move(tx, calId(record.call), "done", null);
      if (!closed.ok) return closed;
      announce(tx, ASK_ANSWERED_TOPIC, {
        call: record.call,
        decision,
        text: blocksText(input.body),
      });
      return ok({ delivered: false, closed: false });
    }
    if (decision !== null) {
      return err({
        code: "invalid_input",
        message: "only an approval call takes a decision",
      });
    }
    const toSession = asReceiver ? sender : record.receiver_session;
    const target = toSession === null ? null : directory.find(sesId(toSession));
    // 받을 session이 없어졌으면 답은 보낸 쪽 기록에만 남는다.
    let delivered = false;
    if (target !== null && target.accepting) {
      const sent = transport.deliver(tx, target, {
        kind: "reply",
        from: { kind: "agent", session: from.session },
        call: calId(record.call),
        reply_to: calId(record.call),
        body: input.body,
        refs: input.refs,
        delivery: "next_turn",
        message: null,
        reply: null,
        outcome:
          asReceiver && record.reply === "result"
            ? { state: "done", reason: null }
            : null,
        event: null,
        notice: null,
        step: null,
        // 답의 표시는 답한 turn에서 온다. 사람이 끼어든 attended turn의 답은 attended다.
        unattended: input.unattended === true,
      });
      if (!sent.ok) return sent;
      delivered = true;
    }
    if (asReceiver && record.reply === "result") {
      const closed = store.move(tx, calId(record.call), "done", null);
      if (!closed.ok) return closed;
    }
    return ok({ delivered, closed: false });
  }

  function cancel(
    tx: Tx,
    by: CallFrom,
    input: { call: Id<"cal">; reason?: string },
  ): Result<AgentCallRow> {
    const record = store.read(tx, calId(input.call));
    if (record === null) {
      return err({ code: "not_found", message: "call not found" });
    }
    // 보낸 agent와 앱은 자기가 보낸 것만, 사람은 모두 취소한다.
    const own =
      (by.kind === "agent" &&
        record.from.kind === "agent" &&
        record.from.session === by.session) ||
      (by.kind === "app" &&
        record.from.kind === "app" &&
        record.from.app === by.app);
    if (by.kind !== "human" && !own) {
      return err({ code: "forbidden", message: "not your call" });
    }
    if (isFinished(record.state)) return ok(record);
    const moved = finish(tx, record, "cancelled", null);
    if (!moved.ok) return moved;
    // 다른 컴퓨터로 보낸 call은 받는 session이 이 기계에 없다. 남은 call mail을 지우고 cancel mail을 낸다: drain이 call mail을 이미 읽어
    // 보냈을 수 있다. 받는 쪽은 모르는 call의 cancel을 무시하고, 기계마다 seq 순이라 cancel은 call 뒤에 닿는다.
    if (record.to.kind === "remote") {
      const dropped = dropCallMail(tx, record.call);
      if (!dropped.ok) return dropped;
      const queued = queue(tx, {
        kind: "cancel",
        call: calId(record.call),
        from: authorOf(
          record.from.kind === "agent" ? record.from.session : null,
        ),
        to_machine: record.to.machine,
        ...stamp(tx),
      });
      if (!queued.ok) return queued;
      // workflow step이면 이 컴퓨터에서 취소했다는 줄을 남긴다.
      if (record.from.kind === "program") {
        const told = deps.steps.failed(tx, record.call, "cancelled_here");
        if (!told.ok) return told;
      }
      return moved;
    }
    // 받는 기계의 사람이 다른 컴퓨터에서 받은 call을 취소했다. 보낸 기계의 행도 닫는다.
    const closed = queueClosed(tx, record, "cancelled");
    if (closed !== null && !closed.ok) return closed;
    const target =
      record.receiver_session === null
        ? null
        : directory.find(sesId(record.receiver_session));
    const cancelled = transport.cancel(
      tx,
      target,
      calId(record.call),
      record.unattended,
    );
    return cancelled.ok ? moved : cancelled;
  }

  function failAll(
    tx: Tx,
    records: readonly AgentCallRow[],
    reason: CallFailReason,
    notify: boolean,
    // 받는 session이 가져가 일하던 call이다(재시작이면 다른 글).
    taken = false,
  ): Result<number> {
    const restartedTaken = taken && reason === "lophn_restarted";
    for (const record of records) {
      const moved = finish(tx, record, "failed", reason);
      if (!moved.ok) return moved;
      // ask call의 보낸 쪽은 기다리는 request·질문이라 queue에 알리지 않고 main thread가 푼다. 재시작이면 짝이 이미 없다.
      if (record.ask !== null) {
        if (reason === "receiver_ended") {
          announce(tx, ASK_ENDED_TOPIC, { call: record.call });
        }
        continue;
      }
      // 다른 컴퓨터에서 받은 call의 실패는 queue 알림 대신 그 기계로 가는 mail이다.
      if (record.from.kind === "remote") {
        const queued = queueFailure(
          tx,
          calId(record.call),
          record.from.machine,
          reason,
          record.unattended,
          restartedTaken ? TAKEN_RESTART_TEXTS.remote : undefined,
        );
        if (!queued.ok) return queued;
        continue;
      }
      if (notify && record.from.kind === "agent") {
        const told = notifyFailed(
          tx,
          record.from.session,
          record.call,
          reason,
          record.unattended,
          restartedTaken ? textBlocks(TAKEN_RESTART_TEXTS.local) : undefined,
        );
        if (!told.ok) return told;
      }
    }
    return ok(records.length);
  }

  function sendRemote(tx: Tx, input: SendRemoteInput): Result<SentRemote> {
    const from: CallFrom = { kind: "agent", session: sesId(input.session) };
    const prior = store.byDedup(tx, from, input.dedup);
    if (prior !== null) {
      return ok({
        call: calId(prior.call),
        state: prior.state,
        fail_reason: prior.fail_reason,
      });
    }
    const sender = directory.find(sesId(input.session));
    if (sender === null) {
      return err({ code: "not_found", message: "sender session not found" });
    }
    // main thread의 보내는 입구(remoteReach)가 먼저 답하지만, 쓰는 tx에서 한 번 더 본다.
    if (isPrivate(callPolicy(), sender.agent.workspace)) {
      return err({
        code: "forbidden",
        message: "a private workspace does not reach another computer",
      });
    }
    if (sender.opened_by_machine !== null) {
      return err({
        code: "forbidden",
        message:
          "a session opened by mail from another computer does not send to another computer",
      });
    }
    const call = tx.newId("cal") as Id<"cal">;
    const agent = sender.agent.agent;
    const queued = queue(tx, {
      kind: "call",
      call,
      from: {
        machine: input.self,
        agent,
        session: input.session,
        name: requesterName(directory.accepts(agent)?.name ?? agent),
      },
      to_machine: input.peer.machine,
      ...stamp(tx),
      address: input.address,
      reply: input.reply,
      body: input.body,
      unattended: input.unattended,
    });
    if (!queued.ok) return queued;
    const at = tx.now();
    const record: AgentCallRow = {
      call,
      from,
      to: {
        kind: "remote",
        machine: input.peer.machine,
        computer: input.peer.computer,
        address: input.address,
      },
      receiver_session: null,
      reply: input.reply,
      state: "accepted",
      fail_reason: null,
      dedup: input.dedup,
      unattended: input.unattended,
      ask: null,
      result: null,
      created_at: at,
      state_changed_at: at,
      delivery: "pending",
      remote_session: null,
    };
    const stored = store.insert(tx, record);
    if (!stored.ok) return stored;
    changedIfRemote(tx, record);
    return ok({ call, state: "accepted", fail_reason: null });
  }

  // mail의 주소를 이 기계의 call 주소로 푼다. 실패면 이유와 행에 남길 풀린 받는 곳이다.
  // 다른 컴퓨터의 mail은 그 기계의 mail이 연 session에만 이어 들어간다(사람이 연 session이나 다른 기계의 mail이 연 session은 없는 것과 같다).
  // 받는 workspace가 private이면 없는 것과 같다(있는지를 알리지 않는다).
  function localAddress(
    address: RemoteAddress,
    origin: string,
  ):
    | { ok: true; to: CallAddressInput }
    | { ok: false; reason: CallFailReason; to: CallTarget | null } {
    const policy = callPolicy();
    const ours = (session: string) => {
      const target = directory.find(sesId(session));
      return target !== null &&
        target.opened_by_machine === origin &&
        !isPrivate(policy, target.agent.workspace)
        ? target
        : null;
    };
    if (!("agent" in address)) {
      return ours(address.session) === null
        ? {
            ok: false,
            reason: "not_found",
            to: { kind: "open_session", session: address.session },
          }
        : { ok: true, to: address };
    }
    const named = address.workspace;
    let workspace: AgentAddress["workspace"];
    if ("project" in named) {
      const project = directory.projectOfIdentity(named.project);
      if (project === null) return { ok: false, reason: "not_found", to: null };
      workspace = { project };
    } else {
      workspace = named;
    }
    const local = { agent: address.agent, workspace };
    const resolved = directory.resolveAddress(local);
    if (!resolved.ok || isPrivate(policy, resolved.value.workspace)) {
      return { ok: false, reason: "not_found", to: null };
    }
    if ("session" in address && ours(address.session) !== null) {
      return {
        ok: true,
        to: { ...local, session: address.session, fallback: "new" },
      };
    }
    return { ok: true, to: local };
  }

  // 지금 돌리면 받는 session에 닿는가(session을 열지는 않는다).
  function receivable(address: RemoteAddress, origin: string): boolean {
    const local = localAddress(address, origin);
    if (!local.ok) return false;
    if ("agent" in local.to) return true;
    return directory.find(sesId(local.to.session))?.accepting === true;
  }

  // 지난 적용의 결과. 대기 목록에서 끝난 줄은 그 끝으로, 아니면 받은 call 행에서 읽는다.
  function appliedBefore(tx: Tx, mail: Mail, origin: string): MailApplied {
    if (mail.kind !== "call") return NOT_APPLIED;
    const state = seen.read(tx, origin, mail.id)?.state;
    if (state === "held") {
      return { delivery: "held", reason: null, session: null };
    }
    if (state === "expired" || state === "skipped") {
      return { delivery: "failed", reason: state, session: null };
    }
    const record = store.read(tx, calId(mail.call));
    if (
      record === null ||
      record.from.kind !== "remote" ||
      record.from.machine !== origin
    ) {
      return { delivery: "failed", reason: "not_found", session: null };
    }
    return record.state === "failed"
      ? { delivery: "failed", reason: record.fail_reason, session: null }
      : { delivery: "running", reason: null, session: record.receiver_session };
  }

  // 받은 call mail을 이 기계의 Router로 돌린다. tellState면 받은 상태를 state mail로 보낸 기계에 알린다(답이 없는 길: 폴더, 대기 뒤 시작).
  function applyCall(
    tx: Tx,
    mail: Extract<Mail, { kind: "call" }>,
    origin: MailOrigin,
    skipAllowed: boolean,
    tellState: boolean,
  ): Result<MailApplied> {
    const from: CallFrom = {
      kind: "remote",
      ...mail.from,
      computer: origin.computer,
    };
    // workflow의 step이면 step 입력으로 넣는다. 받은 행은 call처럼 남아 대기·만료·재시작·답(report)이 그 행으로 돈다.
    const step = mail.step;
    const routeInput: Omit<RouteInput, "to"> = {
      from,
      reply: mail.reply,
      body:
        step === undefined
          ? mail.body
          : remoteStepBody(origin.computer, mail.body),
      refs: [],
      reply_to: null,
      dedup: null,
      kind: step === undefined ? "call" : "step",
      delivery: "next_turn",
      unattended: mail.unattended,
      call: mail.call,
      skipAllowed,
      step:
        step === undefined
          ? null
          : { instance: step.instance as Id<"wfi">, step: step.name },
    };
    const address = localAddress(mail.address, origin.machine);
    const routed = address.ok
      ? route(tx, { ...routeInput, to: address.to })
      : deliveryFailed(tx, routeInput, address.to, address.reason);
    if (!routed.ok) return routed;
    const { fail_reason, session } = routed.value;
    if (fail_reason !== null) {
      const queued = queueFailure(
        tx,
        mail.call,
        origin.machine,
        fail_reason,
        mail.unattended,
      );
      if (!queued.ok) return queued;
      return ok({ delivery: "failed", reason: fail_reason, session: null });
    }
    if (tellState) {
      const queued = queueState(
        tx,
        mail.call,
        origin.machine,
        "running",
        session,
      );
      if (!queued.ok) return queued;
    }
    return ok({ delivery: "running", reason: null, session });
  }

  function queueState(
    tx: Tx,
    call: string,
    peer: string,
    delivery: "held" | "running",
    session: string | null,
  ): Result<Mail> {
    return queue(tx, {
      kind: "state",
      call: calId(call),
      from: authorOf(session),
      to_machine: peer,
      ...stamp(tx),
      delivery,
      session: session === null ? null : sesId(session),
    });
  }

  // 대기 목록이 바뀌었다(줄이 생기고, 정해지고, 만료되고, 취소됐다). 화면의 대기 목록이 다시 읽는다. mail 본문은 싣지 않는다.
  function holdsChanged(tx: Tx, mail: string): void {
    announce(tx, STATE_CHANGED_TOPIC, [{ name: "mail_holds", id: mail }]);
  }

  // 대기 목록의 줄을 끝내고, 돌지 않은 call의 실패를 보낸 기계에 알린다.
  function closeHold(
    tx: Tx,
    row: { origin: string; id: string },
    mail: Extract<Mail, { kind: "call" }>,
    reason: "expired" | "skipped",
  ): Result<MailApplied> {
    seen.close(tx, row.origin, row.id, reason);
    holdsChanged(tx, row.id);
    const queued = queueFailure(
      tx,
      mail.call,
      row.origin,
      reason,
      mail.unattended,
    );
    if (!queued.ok) return queued;
    return ok({ delivery: "failed", reason, session: null });
  }

  // 그 call의 아직 내지 못한 call mail을 지운다.
  function dropCallMail(tx: Tx, call: string): Result<void> {
    const pending = outbox.callMailOf(tx, call);
    return pending === null ? ok(undefined) : outbox.remove(tx, pending.id);
  }

  function applyReply(
    tx: Tx,
    mail: Extract<Mail, { kind: "reply" }>,
    origin: MailOrigin,
    record: AgentCallRow,
  ): Result<void> {
    if (isFinished(record.state)) return ok(undefined);
    const from: CallFrom = {
      kind: "remote",
      ...mail.from,
      computer: origin.computer,
    };
    const replyInput = (outcome: RoutedInput["outcome"]): RoutedInput | null =>
      mail.body === null
        ? null
        : {
            kind: "reply",
            from,
            call: calId(record.call),
            reply_to: calId(record.call),
            body: mail.body,
            refs: [],
            delivery: "next_turn",
            message: null,
            reply: null,
            outcome,
            event: null,
            notice: null,
            step: null,
            unattended: mail.unattended,
          };
    // (가) 이 기계가 그 기계로 보낸 call의 답·실패·끝.
    if (
      record.to.kind === "remote" &&
      record.to.machine === origin.machine &&
      record.from.kind === "agent"
    ) {
      const outcome = mail.outcome;
      const reason =
        outcome?.state === "failed"
          ? (outcome.reason ?? "receiver_ended")
          : null;
      const input =
        reason !== null
          ? {
              ...failureInput(calId(record.call), reason, mail.unattended),
              // 그 기계가 실은 글이 있으면 그 글이다(가져간 뒤 재시작처럼 이유의 기본 글이 맞지 않을 때).
              ...(mail.body === null ? {} : { body: mail.body }),
            }
          : replyInput(
              outcome === null ? null : { state: outcome.state, reason: null },
            );
      const target = directory.find(sesId(record.from.session));
      if (input !== null && target !== null && target.accepting) {
        const delivered = transport.deliver(tx, target, input);
        if (!delivered.ok) return delivered;
      }
      if (outcome === null) return ok(undefined);
      const moved = finish(tx, record, outcome.state, reason);
      if (!moved.ok) return moved;
      return dropCallMail(tx, calId(record.call));
    }
    // workflow가 그 기계로 넘긴 step의 실패·끝. report는 workflows가 따로 받는다(acceptStepReport).
    if (
      record.to.kind === "remote" &&
      record.to.machine === origin.machine &&
      record.from.kind === "program"
    ) {
      const outcome = mail.outcome;
      if (outcome === null || mail.report !== undefined) return ok(undefined);
      const dropped = dropCallMail(tx, record.call);
      if (!dropped.ok) return dropped;
      // report 없이 끝난 step(그 컴퓨터에서 취소됐거나 call 답으로 닫혔다)도 사람이 읽는 줄을 남긴다. instance가 말없이 기다리지 않게.
      return outcome.state === "failed"
        ? failSent(tx, record, outcome.reason ?? "receiver_ended")
        : failSent(tx, record, "closed", "closed_there");
    }
    // (나) 그 기계에서 받은 conversation call에 보낸 쪽이 잇는 말.
    if (
      record.from.kind === "remote" &&
      record.from.machine === origin.machine &&
      record.reply === "conversation" &&
      record.receiver_session !== null
    ) {
      const input = replyInput(null);
      const target = directory.find(sesId(record.receiver_session));
      if (input === null || target === null || !target.accepting) {
        return ok(undefined);
      }
      return transport.deliver(tx, target, input);
    }
    return ok(undefined);
  }

  function applyMail(tx: Tx, input: ApplyMailInput): Result<MailApplied> {
    const { mail, origin } = input;
    if (mail.from.machine !== origin.machine || mail.to_machine !== self()) {
      return err({
        code: "forbidden",
        message: "this mail is not from that computer to this one",
      });
    }
    const now = tx.now();
    // 만료된 mail은 돌지 않는다. 늦게 온 call은 돌지 않고 대기 목록에 서서 사람을 기다린다(reply·cancel·state는 늦어도 바로 적용한다).
    // 늦음은 이 기계의 시계와 보낸 기계의 sent_at을 견준다. 시계가 10분 넘게 어긋난 두 컴퓨터는 모든 mail이 서거나 하나도 서지 않는다(알고 둔다).
    // 이미 있는 call id는 쓰지 않는다(insert가 터지면 그 기계의 drain이 같은 mail을 끝없이 다시 낸다).
    const expired = now > mail.expires_at;
    const clash =
      mail.kind === "call" && store.read(tx, calId(mail.call)) !== null;
    // 보낸 기계가 이미 취소한 call이다(cancel mail이 먼저 닿았다). 늦었어도 대기에 서지 않는다.
    const withdrawn =
      mail.kind === "call" && seen.cancelSeen(tx, origin.machine, mail.call);
    // 대기 목록에는 돌았을 call만 선다. 받을 곳이 없는 call(없는 agent·workspace, private, 그 기계의 mail이 열지 않은 session, 닫힌
    // session)은 늦었어도 바로 배달 실패 길로 간다.
    const late =
      mail.kind === "call" &&
      !expired &&
      !clash &&
      !withdrawn &&
      Date.parse(now) - Date.parse(mail.sent_at) > MAIL_LATE_MS &&
      receivable(mail.address, origin.machine);
    const fresh = seen.mark(tx, {
      origin: origin.machine,
      id: mail.id,
      call: mail.call,
      kind: mail.kind,
      state: expired ? "expired" : late ? "held" : "applied",
      mail: late ? mail : null,
      computer: origin.computer,
      arrived_at: now,
    });
    if (!fresh) return ok(appliedBefore(tx, mail, origin.machine));
    if (expired) {
      if (mail.kind !== "call") return ok(NOT_APPLIED);
      const queued = queueFailure(
        tx,
        mail.call,
        origin.machine,
        "expired",
        mail.unattended,
      );
      if (!queued.ok) return queued;
      return ok({ delivery: "failed", reason: "expired", session: null });
    }
    if (mail.kind === "call") {
      if (clash) {
        return ok({ delivery: "failed", reason: "not_found", session: null });
      }
      // 돌리지 않고 닫힌 call로 답한다.
      if (withdrawn) {
        const queued = queueFailure(
          tx,
          mail.call,
          origin.machine,
          "closed",
          mail.unattended,
        );
        if (!queued.ok) return queued;
        return ok({ delivery: "failed", reason: "closed", session: null });
      }
      if (late) {
        holdsChanged(tx, mail.id);
        if (input.via === "folder") {
          const queued = queueState(
            tx,
            mail.call,
            origin.machine,
            "held",
            null,
          );
          if (!queued.ok) return queued;
        }
        return ok({ delivery: "held", reason: null, session: null });
      }
      return applyCall(
        tx,
        mail,
        origin,
        input.skipAllowed,
        input.via === "folder",
      );
    }
    const record = store.read(tx, calId(mail.call));
    if (record === null) {
      // 보낸 쪽이 대기 목록에 선 call을 취소했다. session을 열지 않고 줄만 닫는다.
      const held =
        mail.kind === "cancel"
          ? seen.heldOfCall(tx, origin.machine, mail.call)
          : null;
      if (held !== null) {
        seen.close(tx, held.origin, held.id, "cancelled");
        holdsChanged(tx, held.id);
      }
      return ok(NOT_APPLIED);
    }
    switch (mail.kind) {
      case "reply": {
        const applied = applyReply(tx, mail, origin, record);
        return applied.ok ? ok(NOT_APPLIED) : applied;
      }
      case "cancel": {
        if (
          isFinished(record.state) ||
          record.from.kind !== "remote" ||
          record.from.machine !== origin.machine
        ) {
          return ok(NOT_APPLIED);
        }
        const moved = finish(tx, record, "cancelled", null);
        if (!moved.ok) return moved;
        const target =
          record.receiver_session === null
            ? null
            : directory.find(sesId(record.receiver_session));
        const cancelled = transport.cancel(
          tx,
          target,
          calId(record.call),
          record.unattended,
        );
        return cancelled.ok ? ok(NOT_APPLIED) : cancelled;
      }
      case "state": {
        if (
          isFinished(record.state) ||
          record.to.kind !== "remote" ||
          record.to.machine !== origin.machine
        ) {
          return ok(NOT_APPLIED);
        }
        const set = store.setDelivery(
          tx,
          calId(record.call),
          mail.delivery,
          mail.session === null ? null : sesId(mail.session),
        );
        if (!set.ok) return set;
        changedIfRemote(tx, record);
        const dropped = dropCallMail(tx, calId(record.call));
        return dropped.ok ? ok(NOT_APPLIED) : dropped;
      }
    }
  }

  function refuseMail(
    tx: Tx,
    input: { mail: Mail; origin: MailOrigin; reason: CallFailReason },
  ): Result<void> {
    const { mail, origin } = input;
    const fresh = seen.mark(tx, {
      origin: origin.machine,
      id: mail.id,
      call: mail.call,
      kind: mail.kind,
      state: "refused",
      mail: null,
      computer: origin.computer,
      arrived_at: tx.now(),
    });
    // 그 기계가 쓴 call mail에만 답한다.
    if (
      !fresh ||
      mail.kind !== "call" ||
      mail.from.machine !== origin.machine
    ) {
      return ok(undefined);
    }
    const queued = queueFailure(
      tx,
      mail.call,
      origin.machine,
      input.reason,
      mail.unattended,
    );
    return queued.ok ? ok(undefined) : queued;
  }

  // 보낸 call이 받는 기계에서 실패했다. 행을 닫고 보낸 session에 늦은 실패로 알린다.
  function failSent(
    tx: Tx,
    record: AgentCallRow,
    reason: CallFailReason,
    ending: StepEnding = reason,
    // 이유의 기본 글 대신 보낸 session에 줄 글.
    body?: ContentBlock[],
  ): Result<void> {
    const moved = finish(tx, record, "failed", reason);
    if (!moved.ok) return moved;
    if (record.from.kind === "program") {
      return deps.steps.failed(tx, record.call, ending);
    }
    return record.from.kind === "agent"
      ? notifyFailed(
          tx,
          record.from.session,
          record.call,
          reason,
          record.unattended,
          body,
        )
      : ok(undefined);
  }

  function mailSent(
    tx: Tx,
    input: { mail: string; result: MailSendResult },
  ): Result<void> {
    const sent = outbox.read(tx, input.mail);
    if (sent === null) return ok(undefined);
    const { result } = input;
    if (result.kind !== "unknown") {
      const removed = outbox.remove(tx, sent.id);
      if (!removed.ok) return removed;
    }
    if (sent.kind !== "call") return ok(undefined);
    const call = calId(sent.call);
    const record = store.read(tx, call);
    if (record === null || isFinished(record.state)) return ok(undefined);
    switch (result.kind) {
      case "refused":
        return failSent(tx, record, "old_version");
      case "unknown": {
        const set = store.setDelivery(tx, call, "unknown");
        if (set.ok) changedIfRemote(tx, record);
        return set;
      }
      case "acked": {
        const { applied } = result;
        if (applied.delivery === "failed") {
          return failSent(tx, record, applied.reason ?? "not_found");
        }
        if (applied.delivery === null) return ok(undefined);
        const set = store.setDelivery(
          tx,
          call,
          applied.delivery,
          applied.session === null ? null : sesId(applied.session),
        );
        if (set.ok) changedIfRemote(tx, record);
        return set;
      }
    }
  }

  function sendStep(tx: Tx, input: SendStepInput): Result<{ call: string }> {
    if (isPrivate(callPolicy(), input.workspace)) {
      return err({
        code: "forbidden",
        message: "a private workspace does not reach another computer",
      });
    }
    if (!mailBodySchema.safeParse(input.body).success) {
      return err({
        code: "invalid_input",
        message: `the step text is over ${MAIL_TEXT_MAX_BYTES} bytes and cannot go to another computer`,
      });
    }
    const call = tx.newId("cal") as Id<"cal">;
    const queued = queue(tx, {
      kind: "call",
      call,
      from: {
        machine: self(),
        agent: LOPHN_AGENT_HANDLE,
        session: null,
        name: requesterName(input.workflow),
      },
      to_machine: input.peer.machine,
      ...stamp(tx),
      address: input.address,
      reply: "result",
      body: input.body,
      unattended: true,
      step: { instance: input.instance, name: input.step },
    });
    if (!queued.ok) return queued;
    const at = tx.now();
    const record: AgentCallRow = {
      call,
      from: { kind: "program" },
      to: {
        kind: "remote",
        machine: input.peer.machine,
        computer: input.peer.computer,
        address: input.address,
      },
      receiver_session: null,
      reply: "result",
      state: "accepted",
      fail_reason: null,
      dedup: null,
      unattended: true,
      ask: null,
      result: null,
      created_at: at,
      state_changed_at: at,
      delivery: "pending",
      remote_session: null,
    };
    const stored = store.insert(tx, record);
    if (!stored.ok) return stored;
    changedIfRemote(tx, record);
    return ok({ call });
  }

  function acceptStepReport(
    tx: Tx,
    input: { mail: Mail; origin: MailOrigin },
  ): Result<{ closes: boolean }> {
    const { mail, origin } = input;
    if (mail.kind !== "reply" || mail.report === undefined) {
      return err({ code: "invalid_input", message: "not a step report" });
    }
    if (mail.from.machine !== origin.machine || mail.to_machine !== self()) {
      return err({
        code: "forbidden",
        message: "this mail is not from that computer to this one",
      });
    }
    // conflict가 아니다: workflows는 conflict를 instance 경합으로 보고 다시 건다.
    const refused = err({
      code: "forbidden" as const,
      message: "this report is not for an open step sent to that computer",
    });
    const record = store.read(tx, calId(mail.call));
    if (
      record === null ||
      record.from.kind !== "program" ||
      record.to.kind !== "remote" ||
      record.to.machine !== origin.machine ||
      isFinished(record.state) ||
      (record.remote_session !== null &&
        mail.from.session !== record.remote_session)
    ) {
      return refused;
    }
    const fresh = seen.mark(tx, {
      origin: origin.machine,
      id: mail.id,
      call: mail.call,
      kind: mail.kind,
      state: "applied",
      mail: null,
      computer: origin.computer,
      arrived_at: tx.now(),
    });
    if (!fresh) return refused;
    const closes = mail.report.next !== null;
    if (!closes) {
      const set = store.setDelivery(
        tx,
        calId(record.call),
        "running",
        mail.from.session === null ? null : sesId(mail.from.session),
      );
      if (!set.ok) return set;
      changedIfRemote(tx, record);
      return ok({ closes });
    }
    const moved = finish(tx, record, "done", null);
    if (!moved.ok) return moved;
    const dropped = dropCallMail(tx, record.call);
    return dropped.ok ? ok({ closes }) : dropped;
  }

  function reportStep(tx: Tx, input: ReportStepInput): Result<void> {
    const record = store.read(tx, calId(input.call));
    if (
      record === null ||
      record.from.kind !== "remote" ||
      record.receiver_session !== input.session
    ) {
      return err({
        code: "not_found",
        message: "this session did not receive that step from another computer",
      });
    }
    if (isFinished(record.state)) {
      return err({
        code: "conflict",
        message: "this step was already reported",
      });
    }
    const queued = queue(tx, {
      kind: "reply",
      call: calId(record.call),
      from: authorOf(input.session),
      to_machine: record.from.machine,
      ...stamp(tx),
      body: textBlocks(input.text),
      outcome: input.next === null ? null : { state: "done", reason: null },
      unattended: input.unattended,
      report: { next: input.next as never, session: input.choice },
    });
    if (!queued.ok) return queued;
    if (input.next === null) return ok(undefined);
    const moved = finish(tx, record, "done", null);
    return moved.ok ? ok(undefined) : moved;
  }

  function decideHold(tx: Tx, input: DecideHoldInput): Result<MailApplied> {
    const row = seen.read(tx, input.origin, input.mail);
    if (row === null) {
      return err({ code: "not_found", message: "no such mail on hold" });
    }
    if (row.state !== "held" || row.mail?.kind !== "call") {
      return err({
        code: "conflict",
        message: "this mail is no longer on hold",
      });
    }
    // 보낸 컴퓨터가 명단에서 빠졌다. 돌리지 않고 줄만 닫는다(알릴 상대가 없다).
    if (input.decision === "drop") {
      seen.close(tx, row.origin, row.id, "cancelled");
      holdsChanged(tx, row.id);
      return ok(NOT_APPLIED);
    }
    const mail = row.mail;
    if (tx.now() > mail.expires_at) {
      return closeHold(tx, row, mail, "expired");
    }
    if (input.decision === "skip") return closeHold(tx, row, mail, "skipped");
    seen.close(tx, row.origin, row.id, "started");
    holdsChanged(tx, row.id);
    // 늦은 판정 없이 받는 길로 돌린다. 답이 없는 때라 받은 상태를 state mail로 알린다.
    return applyCall(
      tx,
      mail,
      { machine: row.origin, computer: row.computer },
      input.skipAllowed,
      true,
    );
  }

  function sweepMail(
    tx: Tx,
    removed: readonly string[],
  ): Result<{ expired: number; gone: number }> {
    const now = tx.now();
    let expired = 0;
    let gone = 0;
    // 명단에서 빠진 기계: 닿을 길이 없으니 만료까지 기다리지 않는다(대기·모름·도는 중 모두). 그 기계가 보내던 답도 이제 받지 않는다.
    for (const peer of removed) {
      outbox.dropPeer(tx, peer);
      for (const call of outbox.openSentTo(tx, peer)) {
        const record = store.read(tx, calId(call));
        if (record === null || isFinished(record.state)) continue;
        const failed = failSent(
          tx,
          record,
          "not_found",
          "left_roster",
          textBlocks(LEFT_ROSTER_TEXT),
        );
        if (!failed.ok) return failed;
        gone++;
      }
    }
    // 이 기계가 낸 줄: 닿지 못한 call은 보낸 session에 늦은 실패로 알린다.
    for (const mail of outbox.expired(tx, now)) {
      const removed = outbox.remove(tx, mail.id);
      if (!removed.ok) return removed;
      expired++;
      if (mail.kind !== "call") continue;
      const record = store.read(tx, calId(mail.call));
      if (record === null || isFinished(record.state)) continue;
      const failed = failSent(tx, record, "expired");
      if (!failed.ok) return failed;
    }
    // 그 기계의 대기 목록에 섰거나 받았는지 모르는 call: 그 기계가 다시 오지 않아도 보낸 쪽에 영영 열려 있지 않게 닫는다. 받는 기계는 만료된
    // 대기 줄을 시작하지 않으므로 늦은 Start now가 여기서 닫은 call을 돌리지 않는다. 만료 뒤 10분은 두 기계의 시계 차이를 위한 여유다. 만료는
    // 행을 쓴 때(call mail의 sent_at과 같은 tx 시각)에서 센다. 돌기 시작한 call은 나이로 닫지 않는다.
    const sentBefore = new Date(
      Date.parse(now) - MAIL_EXPIRY_MS - MAIL_LATE_MS,
    ).toISOString();
    for (const call of outbox.sentOpenBefore(tx, sentBefore)) {
      const record = store.read(tx, calId(call));
      if (record === null || isFinished(record.state)) continue;
      const failed = failSent(tx, record, "expired");
      if (!failed.ok) return failed;
      expired++;
    }
    for (const row of seen.held(tx)) {
      if (row.mail?.kind !== "call" || !(now > row.mail.expires_at)) continue;
      const closed = closeHold(tx, row, row.mail, "expired");
      if (!closed.ok) return closed;
      expired++;
    }
    // 만료의 두 배 안에 같은 mail이 다시 와도 한 번만 돈다. 그보다 옛 기록은 쓸 일이 없다.
    seen.prune(
      tx,
      new Date(Date.parse(now) - 2 * MAIL_EXPIRY_MS).toISOString(),
    );
    return ok({ expired, gone });
  }

  return {
    appSender(app) {
      const info = directory.app(app);
      if (info === null) {
        return err({ code: "not_found", message: "app not found" });
      }
      if (info.archived) {
        return err({ code: "conflict", message: "the app is archived" });
      }
      return ok({ kind: "app", app: app as Id<"app">, slug: info.slug });
    },
    route,
    reply,
    cancel,
    failReceivedBy(tx, session) {
      // 끝나는 session 자신이 보낸 call의 알림은 받을 곳이 없다.
      const records = store
        .openReceivedBy(tx, sesId(session))
        .filter(
          (record) =>
            !(record.from.kind === "agent" && record.from.session === session),
        );
      const done = failAll(tx, records, "receiver_ended", true);
      return done.ok ? ok(undefined) : done;
    },
    failReceived(tx, session, call) {
      const record = store.read(tx, calId(call));
      if (
        record === null ||
        record.state !== "accepted" ||
        record.receiver_session !== session
      ) {
        return ok(false);
      }
      const done = failAll(tx, [record], "receiver_ended", true);
      return done.ok ? ok(true) : done;
    },
    failLostOnStart(tx, notify) {
      return failAll(tx, store.lost(tx), "lophn_restarted", notify);
    },
    markConsumed(tx, call) {
      const before = store.read(tx, calId(call));
      const marked = store.markConsumed(tx, calId(call));
      if (!marked.ok) return marked;
      // 답 없는 call은 소비하는 순간 끝난다. 앱이 보낸 것이면 그 앱에, 다른 컴퓨터가 보낸 것이면 그 기계에 알린다.
      if (
        before === null ||
        before.state !== "accepted" ||
        before.reply !== "none"
      ) {
        return ok(undefined);
      }
      if (before.from.kind === "app") {
        announce(tx, APP_CALL_SETTLED_TOPIC, {
          app: before.from.app,
          call: before.call,
          state: "done",
          fail_reason: null,
        });
      }
      changedIfRemote(tx, before);
      const closed = queueClosed(tx, before, "done");
      return closed === null || closed.ok ? ok(undefined) : closed;
    },
    abandoned(tx, input) {
      const record = store.read(tx, calId(input.call));
      // 답한 call(done), 취소·실패한 call은 그대로다. conversation은 답이 여럿이라 끝나지 않은 turn이 끝을 뜻하지 않는다.
      // ask call은 켤 때 정산과 짝의 규칙이 따로 닫는다. next로 report한 step은 이미 done이다.
      if (
        record === null ||
        isFinished(record.state) ||
        record.receiver_session !== input.session ||
        record.reply !== "result" ||
        record.ask !== null
      ) {
        return ok(undefined);
      }
      if (input.step) {
        if (record.from.kind !== "remote") return ok(undefined);
        const queued = queue(tx, {
          kind: "reply",
          call: calId(record.call),
          from: authorOf(input.session),
          to_machine: record.from.machine,
          ...stamp(tx),
          body: null,
          outcome: null,
          unattended: record.unattended,
          report: { next: null, session: "new", ended: input.ended },
        });
        return queued.ok ? ok(undefined) : queued;
      }
      const done = failAll(
        tx,
        [record],
        input.ended === "restarted" ? "lophn_restarted" : "receiver_ended",
        input.notify,
        true,
      );
      return done.ok ? ok(undefined) : done;
    },
    sendRemote,
    applyMail,
    refuseMail,
    mailSent,
    decideHold,
    sweepMail,
    sendStep,
    acceptStepReport,
    reportStep,
  };
}
