import { err, ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import type {
  AgentCallRecord,
  CallAgent,
  CallFailReason,
  CallFrom,
  CallRef,
  CallState,
  CallTo,
} from "../../protocol/lophn-agent/calls.ts";
import {
  addressingOf,
  calId,
  FAILURE_TEXTS,
  failureCode,
  failureInput,
  isFinished,
  type RouteInput,
  type RouteResult,
  sesId,
} from "./model.ts";
import type {
  CallGate,
  CallStore,
  InputTransport,
  RoutedInput,
  SessionDirectory,
  TargetSession,
} from "./ports.ts";

export type RouterDeps = {
  directory: SessionDirectory;
  transport: InputTransport;
  gate: CallGate;
  store: CallStore;
};

export interface Router {
  // 모든 보낸 쪽이 쓰는 입구. 사람, program, agent, coding agent.
  route(tx: Tx, input: RouteInput): Result<RouteResult>;
  reply(
    tx: Tx,
    from: { session: string },
    input: { call: string; body: string; refs: CallRef[] },
  ): Result<{ delivered: boolean; closed: boolean }>;
  cancel(
    tx: Tx,
    by: CallFrom,
    input: { call: string; reason?: string },
  ): Result<AgentCallRecord>;
  // Reactor handler(coding-agent)가 맡긴 call을 닫는다. 같은 tx 안에서 부른다. 이미 끝났으면 그대로 둔다.
  close(
    tx: Tx,
    call: string,
    to: "done" | "failed",
    reason: CallFailReason | null,
  ): Result<AgentCallRecord>;
  // session을 archive하거나 지울 때 그 session이 받은 열린 call을 failed(receiver_ended)로 닫는다.
  failReceivedBy(tx: Tx, session: string): Result<void>;
  // lophn을 켤 때 부른다. 입력함과 앱 줄이 메모리라 잃어버린 call을 failed(lophn_restarted)로 닫는다.
  // `notify`이면 보낸 session에 이유를 돌려준다. 닫은 수를 돌려준다.
  failLostOnStart(tx: Tx, notify: boolean): Result<number>;
  // 받는 session의 turn이 이 call의 입력을 가져갔다(turn을 시작할 때 부른다).
  markConsumed(tx: Tx, call: string): Result<void>;
}

// 받는 곳을 푼 결과. 실패하면 이유와, 행에 남길 수 있는 풀린 받는 곳(이름을 못 풀었으면 null)이다.
type Resolved =
  | { ok: true; to: CallTo; target: TargetSession }
  | { ok: false; reason: CallFailReason; to: CallTo | null };

function failed(
  reason: CallFailReason,
  to: CallTo | null,
): Resolved {
  return { ok: false, reason, to };
}

export function createRouter(deps: RouterDeps): Router {
  const { directory, transport, gate, store } = deps;

  // 보낸 agent의 grant로 받는 agent를 판정한다. 거절이면 not_allowed, 판정하지 못하면 오류로 돌려준다.
  // gateAllowed는 보낸 agent의 turn이 ToolGate에서 사람의 허락을 받았다는 표시다. 묻는 grant만 이 표시로 통과한다.
  function authorize(
    from: CallFrom,
    agent: CallAgent,
    gateAllowed: boolean,
  ): Result<"allowed" | "not_allowed"> {
    if (from.kind !== "agent") return ok("allowed");
    const verdict = gate.authorize(from, agent, gateAllowed);
    if (verdict.ok) return ok("allowed");
    if (
      verdict.error.code === "unavailable" || verdict.error.code === "internal"
    ) return verdict;
    return ok("not_allowed");
  }

  function open(
    tx: Tx,
    from: CallFrom,
    agent: CallAgent,
    to: CallTo,
    gateAllowed: boolean,
  ): Result<Resolved> {
    const allowed = authorize(from, agent, gateAllowed);
    if (!allowed.ok) return allowed;
    if (allowed.value === "not_allowed") return ok(failed("not_allowed", to));
    const opened = directory.open(tx, agent, from);
    if (opened.ok) return ok({ ok: true, to, target: opened.value });
    if (opened.error.code === "conflict") return ok(failed("closed", to));
    if (opened.error.code === "not_found") return ok(failed("not_found", to));
    return opened;
  }

  function existing(
    from: CallFrom,
    to: CallTo,
    target: TargetSession,
    gateAllowed: boolean,
  ): Result<Resolved> {
    const allowed = authorize(from, target.agent, gateAllowed);
    if (!allowed.ok) return allowed;
    if (allowed.value === "not_allowed") return ok(failed("not_allowed", to));
    return ok({ ok: true, to, target });
  }

  // 받는 곳 해석 순서. 이름은 정확히 맞는 것만 푼다.
  function resolve(
    tx: Tx,
    from: CallFrom,
    input: RouteInput,
  ): Result<Resolved> {
    const gateAllowed = input.gate_allowed === true;
    const addressing = addressingOf(input.to);
    let to: CallTo;
    switch (addressing.form) {
      case "resolved":
        to = addressing.to;
        break;
      case "session":
        to = { kind: "open_session", session: addressing.session };
        break;
      case "named":
      case "named_or_session": {
        const agent = directory.resolveAgent(addressing.named);
        if (!agent.ok) {
          return agent.error.code === "not_found"
            ? ok(failed("not_found", null))
            : agent;
        }
        to = addressing.form === "named"
          ? { kind: "new_session", agent: agent.value }
          : {
            kind: "open_session_or_new",
            session: addressing.session,
            agent: agent.value,
          };
      }
    }
    if (to.kind === "new_session") {
      return open(tx, from, to.agent, to, gateAllowed);
    }
    const target = directory.find(sesId(to.session));
    if (to.kind === "open_session") {
      if (target === null) return ok(failed("not_found", to));
      if (!target.accepting) return ok(failed("closed", to));
      return existing(from, to, target, gateAllowed);
    }
    if (target !== null && target.accepting) {
      return existing(from, to, target, gateAllowed);
    }
    return open(tx, from, to.agent, to, gateAllowed);
  }

  function inputOf(
    input: RouteInput,
    call: string | null,
  ): RoutedInput {
    return {
      kind: input.kind,
      from: input.from,
      call: call === null ? null : calId(call),
      reply_to: input.reply_to === null ? null : calId(input.reply_to),
      body: input.body,
      refs: input.refs,
      delivery: input.kind === "message" ? input.delivery : "next_turn",
      message: input.message === undefined || input.message === null
        ? null
        : (input.message as Id<"msg">),
      reply: input.kind === "call" ? input.reply : null,
      outcome: null,
      event: input.event ?? null,
      notice: null,
    };
  }

  // 보낸 session에 실패 이유를 새 입력으로 돌려준다. 보낸 session이 없어졌으면 조용히 둔다.
  function notifyFailed(
    tx: Tx,
    sender: string,
    call: string,
    reason: CallFailReason,
  ): Result<void> {
    const target = directory.find(sesId(sender));
    if (target === null || !target.accepting) return ok(undefined);
    const delivered = transport.deliver(
      tx,
      target,
      failureInput(calId(call), reason),
      null,
    );
    return delivered.ok ? ok(undefined) : delivered;
  }

  function newRecord(
    tx: Tx,
    call: string,
    session: string,
    input: RouteInput,
    to: CallTo,
    receiver: string | null,
    state: CallState,
    reason: CallFailReason | null,
  ): AgentCallRecord {
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
      created_at: at,
      state_changed_at: at,
    };
  }

  // 배달 실패. 조용히 버리지 않는다.
  function deliveryFailed(
    tx: Tx,
    input: RouteInput,
    to: CallTo | null,
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
    const told = notifyFailed(tx, from.session, call, reason);
    if (!told.ok) return told;
    return ok({ call, state: "failed", fail_reason: reason, session: null });
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
    const call = from.kind === "agent" ? tx.newId("cal") : null;
    const delivered = transport.deliver(
      tx,
      target,
      inputOf(input, call),
      input.options,
    );
    if (!delivered.ok) return delivered;
    const state: CallState = delivered.value === "delivered" &&
        input.reply === "none"
      ? "done"
      : "accepted";
    // 앱 줄에 선 coding 맡기기는 아직 받는 session이 없다.
    const receiver = delivered.value === "queued" &&
        target.transport === "harness" && to.kind === "new_session"
      ? null
      : target.session;
    if (call !== null && from.kind === "agent") {
      const stored = store.insert(
        tx,
        newRecord(tx, call, from.session, input, to, receiver, state, null),
      );
      if (!stored.ok) return stored;
    }
    return ok({ call, state, fail_reason: null, session: receiver });
  }

  function reply(
    tx: Tx,
    from: { session: Id<"ses"> },
    input: { call: Id<"cal">; body: string; refs: CallRef[] },
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
        outcome: asReceiver && record.reply === "result"
          ? { state: "done", reason: null }
          : null,
        event: null,
        notice: null,
      }, null);
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
  ): Result<AgentCallRecord> {
    const record = store.read(tx, calId(input.call));
    if (record === null) {
      return err({ code: "not_found", message: "call not found" });
    }
    // 보낸 agent는 자기가 보낸 것만, 사람은 모두 취소한다.
    const own = by.kind === "agent" && record.from.kind === "agent" &&
      record.from.session === by.session;
    if (by.kind !== "human" && !own) {
      return err({ code: "forbidden", message: "not your call" });
    }
    if (isFinished(record.state)) return ok(record);
    const moved = store.move(tx, calId(record.call), "cancelled", null);
    if (!moved.ok) return moved;
    const target = record.receiver_session === null
      ? null
      : directory.find(sesId(record.receiver_session));
    const cancelled = transport.cancel(tx, target, calId(record.call));
    return cancelled.ok ? moved : cancelled;
  }

  function close(
    tx: Tx,
    call: Id<"cal">,
    to: "done" | "failed",
    reason: CallFailReason | null,
  ): Result<AgentCallRecord> {
    const record = store.read(tx, call);
    if (record === null) {
      return err({ code: "not_found", message: "call not found" });
    }
    if (isFinished(record.state)) return ok(record);
    return store.move(tx, calId(call), to, to === "failed" ? reason : null);
  }

  function failAll(
    tx: Tx,
    records: readonly AgentCallRecord[],
    reason: CallFailReason,
    notify: boolean,
  ): Result<number> {
    for (const record of records) {
      const moved = store.move(tx, calId(record.call), "failed", reason);
      if (!moved.ok) return moved;
      if (notify && record.from.kind === "agent") {
        const told = notifyFailed(tx, record.from.session, record.call, reason);
        if (!told.ok) return told;
      }
    }
    return ok(records.length);
  }

  return {
    route,
    reply,
    cancel,
    close,
    failReceivedBy(tx, session) {
      // 끝나는 session 자신이 보낸 call의 알림은 받을 곳이 없다.
      const records = store.openReceivedBy(tx, sesId(session)).filter((
        record,
      ) => !(record.from.kind === "agent" && record.from.session === session));
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
