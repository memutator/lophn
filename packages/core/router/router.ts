import { err, ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import {
  blocksText,
  type ContentBlock,
} from "../../protocol/lophn-agent/content-block.ts";
import type {
  AgentCallRow,
  CallDecision,
  CallFailReason,
  CallFrom,
  CallRef,
  CallState,
  CallTarget,
} from "../../protocol/lophn-agent/calls.ts";
import type { Modality } from "../../protocol/lophn-agent/agent-values.ts";
import {
  type CallPolicy,
  mayCall,
} from "../../protocol/lophn-agent/call-policy.ts";
import type {
  AgentAddress,
  AgentAtWorkspace,
  AgentId,
} from "../../protocol/lophn-agent/workspaces.ts";
import {
  addressingOf,
  ASK_ANSWERED_TOPIC,
  ASK_ENDED_TOPIC,
  calId,
  FAILURE_TEXTS,
  failureCode,
  failureInput,
  isFinished,
  type RouteInput,
  type RouteResult,
  sesId,
  teamMayReach,
} from "./model.ts";
import type {
  CallStore,
  InputTransport,
  RoutedInput,
  SessionDirectory,
  TargetSession,
} from "./ports.ts";

export type RouterDeps = {
  directory: SessionDirectory;
  transport: InputTransport;
  store: CallStore;
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
  // 모든 보낸 쪽이 쓰는 입구. 사람, program, agent.
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
    },
  ): Result<{ delivered: boolean; closed: boolean }>;
  cancel(
    tx: Tx,
    by: CallFrom,
    input: { call: string; reason?: string },
  ): Result<AgentCallRow>;
  // session을 archive하거나 지울 때 그 session이 받은 열린 call을 failed(receiver_ended)로 닫는다.
  failReceivedBy(tx: Tx, session: string): Result<void>;
  // lophn을 켤 때 부른다. queue와 앱 줄이 메모리라 잃어버린 call을 failed(lophn_restarted)로 닫는다.
  // `notify`이면 보낸 session에 이유를 돌려준다. 닫은 수를 돌려준다.
  failLostOnStart(tx: Tx, notify: boolean): Result<number>;
  // 받는 session의 turn이 이 call의 입력을 가져갔다(turn을 시작할 때 부른다).
  markConsumed(tx: Tx, call: string): Result<void>;
}

// 받는 곳을 푼 결과. 실패하면 이유와, 행에 남길 수 있는 풀린 받는 곳(이름을 못 풀었으면 null)이다.
type Resolved =
  | { ok: true; to: CallTarget; target: TargetSession }
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
  const { directory, transport, store, callPolicy, announce } = deps;

  function open(
    tx: Tx,
    from: CallFrom,
    agent: AgentAtWorkspace,
    to: CallTarget,
    spawn: boolean,
  ): Result<Resolved> {
    const opened = directory.open(
      tx,
      agent,
      from,
      spawn && from.kind === "agent" ? sesId(from.session) : null,
    );
    if (opened.ok) return ok({ ok: true, to, target: opened.value });
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
    const agent =
      spawn && from.kind === "agent" && address.workspace === undefined
        ? {
            ...resolved.value,
            workspace:
              directory.find(sesId(from.session))?.agent.workspace ?? null,
          }
        : resolved.value;
    if (session === null) {
      const to: CallTarget = { kind: "new_session", agent };
      return open(tx, from, agent, to, spawn);
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
    return open(tx, from, agent, to, spawn);
  }

  function inputOf(input: RouteInput, call: string | null): RoutedInput {
    return {
      kind: input.kind,
      from: input.from,
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
  ): Result<void> {
    const target = directory.find(sesId(sender));
    if (target === null || !target.accepting) return ok(undefined);
    const delivered = transport.deliver(
      tx,
      target,
      failureInput(calId(call), reason, unattended),
    );
    return delivered.ok ? ok(undefined) : delivered;
  }

  function newRecord(
    tx: Tx,
    call: string,
    session: string,
    input: RouteInput,
    to: CallTarget,
    receiver: string | null,
    state: CallState,
    reason: CallFailReason | null,
  ): AgentCallRow {
    const at = tx.now();
    return {
      call,
      from: { kind: "agent", session },
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
    };
  }

  // 배달 실패. 조용히 버리지 않는다.
  function deliveryFailed(
    tx: Tx,
    input: RouteInput,
    to: CallTarget | null,
    reason: CallFailReason,
  ): Result<RouteResult> {
    const from = input.from;
    if (from.kind === "human") {
      return err({ code: failureCode(reason), message: FAILURE_TEXTS[reason] });
    }
    if (from.kind !== "agent") {
      return ok({
        call: null,
        state: "failed",
        fail_reason: reason,
        session: null,
      });
    }
    const call = tx.newId("cal");
    // 이름을 못 푼 call은 받는 곳을 적을 수 없어 행이 없다. ID와 이유는 그대로 돌려준다.
    if (to !== null) {
      const stored = store.insert(
        tx,
        newRecord(tx, call, from.session, input, to, null, "failed", reason),
      );
      if (!stored.ok) return stored;
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

  function route(tx: Tx, input: RouteInput): Result<RouteResult> {
    const from = input.from;
    if (from.kind === "agent" && input.dedup !== null) {
      const prior = store.byDedup(tx, sesId(from.session), input.dedup);
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
    const { to, target } = resolved.value;
    if (from.kind === "agent") {
      const refused =
        policyRefusal(from.session, target.agent, input.reply) ??
        teamRefusal(from.session, target) ??
        refusal(target.agent.agent, input);
      if (refused !== null) return refused;
    }
    const call = from.kind === "agent" ? tx.newId("cal") : null;
    const delivered = transport.deliver(tx, target, inputOf(input, call));
    if (!delivered.ok) return delivered;
    const receiver = target.session;
    if (call !== null && from.kind === "agent") {
      const stored = store.insert(
        tx,
        newRecord(
          tx,
          call,
          from.session,
          input,
          to,
          receiver,
          "accepted",
          null,
        ),
      );
      if (!stored.ok) return stored;
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
    const decision = input.decision ?? null;
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
    // 보낸 agent는 자기가 보낸 것만, 사람은 모두 취소한다.
    const own =
      by.kind === "agent" &&
      record.from.kind === "agent" &&
      record.from.session === by.session;
    if (by.kind !== "human" && !own) {
      return err({ code: "forbidden", message: "not your call" });
    }
    if (isFinished(record.state)) return ok(record);
    const moved = store.move(tx, calId(record.call), "cancelled", null);
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
    return cancelled.ok ? moved : cancelled;
  }

  function failAll(
    tx: Tx,
    records: readonly AgentCallRow[],
    reason: CallFailReason,
    notify: boolean,
  ): Result<number> {
    for (const record of records) {
      const moved = store.move(tx, calId(record.call), "failed", reason);
      if (!moved.ok) return moved;
      // ask call의 보낸 쪽은 기다리는 request·질문이라 queue에 알리지 않고 main thread가 푼다. 재시작이면 짝이 이미 없다.
      if (record.ask !== null) {
        if (reason === "receiver_ended") {
          announce(tx, ASK_ENDED_TOPIC, { call: record.call });
        }
        continue;
      }
      if (notify && record.from.kind === "agent") {
        const told = notifyFailed(
          tx,
          record.from.session,
          record.call,
          reason,
          record.unattended,
        );
        if (!told.ok) return told;
      }
    }
    return ok(records.length);
  }

  return {
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
    failLostOnStart(tx, notify) {
      return failAll(tx, store.lost(tx), "lophn_restarted", notify);
    },
    markConsumed(tx, call) {
      return store.markConsumed(tx, calId(call));
    },
  };
}
