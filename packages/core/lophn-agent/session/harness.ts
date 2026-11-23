import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  bindHarnessSession,
  textBlocks,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  Input,
  Tx,
} from "../../../protocol/server/mod.ts";
import type { InputTransport, RoutedInput } from "../../router/ports.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import { QUEUE_WITHDRAW_TOPIC } from "../run-loop/topics.ts";
import { reject, requireMachine, sessionNotFound } from "./guards.ts";
import { type AgentSessionRow, loadSession, nextSessionSeq } from "./model.ts";

// runtime이 harness(third-party CLI)인 agent의 session을 core가 다루는 부분이다. 실행은 터미널 GUI 탭(`harness_gui = 1`)이나
// 터미널 없는 background 실행(`harness_gui = 0`)이 하고 core는 queue, turn 기록, harness의 session id를 맡는다(`protocol/lophn-agent/harness-host.ts`).

// harness session의 queue는 run-loop의 것과 따로다(host가 가져간다). commit 뒤 main thread가 넣는다.
export const HARNESS_QUEUE_PUT_TOPIC = "harness_queue.put";

export function createHarnessInputTransport(deps: {
  // `message`가 null인 입력(call·reply·reaction·notice·step)을 받는 session 기록에 쓴다.
  record(tx: Tx, session: Id<"ses">, input: RoutedInput): Result<Id<"msg">>;
}): InputTransport {
  function put(tx: Tx, session: Id<"ses">, input: RoutedInput): Result<void> {
    let message = input.message;
    if (message === null) {
      const written = deps.record(tx, session, input);
      if (!written.ok) return written;
      message = written.value;
    }
    tx.port(afterCommit).push(HARNESS_QUEUE_PUT_TOPIC, {
      session,
      input: { ...input, message },
      at: tx.now(),
    });
    return ok(undefined);
  }

  return {
    deliver(tx, target, input) {
      if (target.transport !== "harness") {
        return err({ code: "invalid_input", message: "not a harness session" });
      }
      return put(tx, target.session, input);
    },
    cancel(tx, target, call, unattended) {
      if (target === null || target.transport !== "harness") {
        return ok(undefined);
      }
      return put(tx, target.session, {
        kind: "notice",
        from: { kind: "program" },
        call,
        reply_to: call,
        body: textBlocks(""),
        refs: [],
        delivery: "next_turn",
        message: null,
        reply: null,
        outcome: null,
        event: null,
        notice: "call_cancelled",
        step: null,
        unattended,
      });
    },
    withdraw(tx, target, call) {
      if (target.transport !== "harness") return ok(undefined);
      tx.port(afterCommit).push(QUEUE_WITHDRAW_TOPIC, {
        session: target.session,
        call,
      });
      return ok(undefined);
    },
  };
}

// fork한 harness session이 harness 쪽 session을 아직 갖지 않았으면 원본의 harness session에서 갈라 시작할 수 있다.
// harness의 기록은 원본의 끝까지라, fork 지점이 지금 원본의 마지막 메시지이고 harness가 같을 때만 그 id다.
export function forkedHarnessSession(
  lookup: Parameters<typeof loadSession>[0],
  row: AgentSessionRow,
): string | null {
  if (row.harness_session !== null || row.forked_from_session === null) {
    return null;
  }
  const source = loadSession(lookup, row.forked_from_session);
  if (
    source === undefined ||
    source.harness_session === null ||
    source.harness !== row.harness
  ) {
    return null;
  }
  const last = lookup.sql.get(
    "select max(created_seq) as seq from messages where session = ?",
    [source.id],
  );
  return last !== undefined &&
    last["seq"] !== null &&
    String(last["seq"]) === row.forked_from_through_seq
    ? source.harness_session
    : null;
}

// host route는 runtime이 harness인 session만 고친다. 그 판정 하나다.
export function harnessOf(
  row: AgentSessionRow | undefined,
): Result<
  AgentSessionRow & { harness: NonNullable<AgentSessionRow["harness"]> }
> {
  if (row === undefined) return sessionNotFound();
  if (row.harness === null) {
    return reject("forbidden", "not a harness session");
  }
  return ok(
    row as AgentSessionRow & {
      harness: NonNullable<AgentSessionRow["harness"]>;
    },
  );
}

// host route가 알려 준 harness의 session id를 session에 둔다. 같은 id면 그대로다.
export function createHarnessCommands(): {
  bind: CommandDefinition<typeof bindHarnessSession>;
} {
  return {
    bind: {
      route: bindHarnessSession,
      handle(tx, ctx, input: Input<typeof bindHarnessSession>) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const found = harnessOf(loadSession(tx, input.session));
        if (!found.ok) return found;
        const row = found.value;
        if (row.harness_session === input.external_session_id) {
          return ok({ state_seq: row.state_seq });
        }
        const seq = nextSessionSeq(tx);
        tx.sql.run(
          "update sessions set harness_session = ?, state_seq = ? where id = ?",
          [input.external_session_id, seq, row.id],
        );
        return ok({ state_seq: String(seq) });
      },
    },
  };
}
