import { ok, type Result } from "../../../base/mod.ts";
import {
  compactSession,
  failSessionCompact,
  requestSessionCompact,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AgentEvent } from "../../../protocol/events/mod.ts";
import type {
  CommandDefinition,
  Input,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import {
  reject,
  requireMachine,
  requireUserOrMachine,
  sessionNotFound,
} from "./guards.ts";
import {
  loadSession,
  nextSessionSeq,
  openCompactRequest,
  type SessionRow,
} from "./model.ts";
import { publishAfterCommit } from "../run-loop/turn-events.ts";

// Compact. 같은 session의 앞 구간 요약을 이후 call의 조립에 쓰게 정한다. 사람이 부르거나, 이전 대화가 커진
// session이면 다음 turn을 시작하기 전에 runtime이 부른다. 도는 turn이 예산을 넘으면 그 turn 자신이 자기 session을
// Compact하고 같은 turn을 이어 간다(turn 안 Compact). 그 밖에는 turn이 도는 동안 요청도 확정도 받지 않는다.
// 요약 call은 짧은 transaction 안에서 부를 수 없어서 세 걸음으로 나눈다. 사람이나 runtime이 요청하고(Request),
// runtime이 session agent의 model에 요약 지시를 보내 요약을 받고, 끝까지 성공한 그 call을 구간과 함께
// session에 이어 요청을 끝낸다(Compact). 요약이 실패하면 요청만 이유와 함께 닫는다(Fail). 요청의 진행은
// session 행을 바꾸지 않아 입력 접수에 닿지 않고, 원문은 어느 경우에도 지우지 않는다.
// 요청, 구간, 경계는 session 기록(표)에만 쓴다. 시작과 끝은 Bus의 agent event다.

function publishCompact(
  tx: Tx,
  session: string,
  type: "CompactStarted" | "CompactEnded",
  payload: { turn: string | null } | { ok: boolean },
): void {
  publishAfterCommit(tx, {
    session,
    type,
    at: tx.now(),
    payload,
  } as AgentEvent);
}

type Compaction = { through_seq: string; summary_call: string };

function compactionOf(session: SessionRow): Compaction | null {
  return session.compaction_through_seq === null ||
    session.compaction_summary_call === null
    ? null
    : {
        through_seq: session.compaction_through_seq,
        summary_call: session.compaction_summary_call,
      };
}

// 이미 덮은 구간 뒤에 새 확정 메시지가 있는지. 없으면 요약할 것이 없다.
function hasMessageAfterSpan(tx: Tx, session: SessionRow): boolean {
  return (
    tx.sql.get(
      "select 1 as found from messages where session = ? and created_seq > ? limit 1",
      [session.id, BigInt(session.compaction_through_seq ?? "0")],
    ) !== undefined
  );
}

// 이 session에 묶인 요약 call로 끝까지 성공한(완전 출력이 있는) 것이다. 시작·실패·취소·부분 출력 call과
// 판단 용도 call, turn 안의 압축 call, 다른 session의 call은 Compact의 요약이 아니다.
function summaryCall(
  tx: { sql: Pick<Tx["sql"], "get"> },
  session: string,
  call: string,
): string | undefined {
  const row = tx.sql.get(
    `select id from model_calls
     where id = ? and session = ? and turn is null
       and purpose = 'conversation_compression'
       and model_use = 'organizing' and state = 'finished'
       and output is not null and json_extract(outcome, '$.kind') = 'complete'`,
    [call, session],
  );
  return row === undefined ? undefined : String(row["id"]);
}

// rewind의 "Summarize from here"도 Compact와 같은 요약 call을 쓴다. 이 session에 묶여 끝까지
// 성공한 call인가.
export function isFinishedSummaryCall(
  lookup: { sql: Pick<Tx["sql"], "get"> },
  session: string,
  call: string,
): boolean {
  return summaryCall(lookup, session, call) !== undefined;
}

// session에서 도는 turn. 없으면 undefined다.
function runningTurn(tx: Tx, session: string): string | undefined {
  const row = tx.sql.get(
    "select id from turns where session = ? and state = 'running' limit 1",
    [session],
  );
  return row === undefined ? undefined : String(row["id"]);
}

// 도는 turn이 있으면 그 turn 자신(machine, 입력의 turn이 도는 turn)의 요청과 확정만 받는다. 그 turn이면 turn 안
// Compact라 turn id를, turn이 없거나 turn 안이 아니면 null을 돌려준다. 받지 않으면 undefined다.
function turnOfCompact(
  tx: Tx,
  ctx: RequestContext,
  session: string,
  turn: string | undefined,
): string | null | undefined {
  const running = runningTurn(tx, session);
  if (running === undefined) return null;
  return requireMachine(ctx).ok && turn === running ? running : undefined;
}

function closeRequest(
  tx: Tx,
  request: string,
  state: "compacted" | "failed",
  failure: string | null,
): void {
  tx.sql.run(
    "update session_compact_requests set state = ?, failure = ? where request_seq = ?",
    [state, failure, BigInt(request)],
  );
}

export function createCompactCommands(): {
  requestCompact: CommandDefinition<typeof requestSessionCompact>;
  compact: CommandDefinition<typeof compactSession>;
  failCompact: CommandDefinition<typeof failSessionCompact>;
} {
  return {
    requestCompact: {
      route: requestSessionCompact,
      handle(
        tx,
        ctx,
        input: Input<typeof requestSessionCompact>,
        compare,
      ): Result<{ id: string; request_seq: string }> {
        const actor = requireUserOrMachine(ctx);
        if (!actor.ok) return actor;
        const session = loadSession(tx, input.session);
        if (session === undefined) return sessionNotFound();
        if (session.lifecycle !== "open") {
          return reject("conflict", "the session is closed");
        }
        // 끝나지 않은 같은 요청을 다시 하면 같은 요청이다.
        const open = openCompactRequest(tx, session.id);
        if (open !== undefined) {
          return ok({ id: session.id, request_seq: open.request_seq });
        }
        const turn = turnOfCompact(tx, ctx, session.id, input.turn);
        if (turn === undefined) {
          return reject("conflict", "a turn of the session is not finished");
        }
        if (session.state_seq !== compare.state_seq) {
          return reject("conflict", "session changed");
        }
        // turn 안에서는 요약할 진행이 turn의 메모리에 있어 덮을 새 메시지가 없어도 된다.
        if (turn === null && !hasMessageAfterSpan(tx, session)) {
          return reject("conflict", "no message is left to summarize");
        }
        // 요청의 이름은 표 안에서 이어 세는 순번이다.
        const next = tx.sql.get(
          "select coalesce(max(request_seq), 0) + 1 as next from session_compact_requests",
          [],
        );
        const seq = String(next?.["next"] ?? 1);
        tx.sql.run(
          "insert into session_compact_requests (request_seq, session, state) values (?, ?, 'requested')",
          [BigInt(seq), session.id],
        );
        publishCompact(tx, session.id, "CompactStarted", { turn });
        return ok({ id: session.id, request_seq: seq });
      },
    },
    compact: {
      route: compactSession,
      handle(
        tx,
        ctx,
        input: Input<typeof compactSession>,
        compare,
      ): Result<{
        id: string;
        compaction: Compaction;
        state_seq: string;
      }> {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const session = loadSession(tx, input.session);
        if (session === undefined) return sessionNotFound();
        if (session.lifecycle !== "open") {
          return reject("conflict", "the session is closed");
        }
        const request = openCompactRequest(tx, session.id);
        if (
          request === undefined ||
          request.request_seq !== compare.request_seq
        ) {
          return reject("conflict", "no such open Compact request");
        }
        const turn = turnOfCompact(tx, ctx, session.id, input.turn);
        if (turn === undefined) {
          return reject("conflict", "a turn of the session is not finished");
        }
        const call = summaryCall(tx, session.id, input.summary_call);
        if (call === undefined) {
          return reject("unavailable", "no summary call finished well");
        }
        // 요약이 덮는 구간의 끝은 이 session의 확정 메시지여야 하고 앞서 덮은 구간보다 뒤여야 한다.
        const covered = tx.sql.get(
          "select 1 as found from messages where session = ? and created_seq = ?",
          [session.id, BigInt(input.through_seq)],
        );
        if (covered === undefined) {
          return reject("invalid_input", "the span does not end at a message");
        }
        // turn 안 Compact의 새 요약은 같은 끝을 다시 덮을 수 있다: 덮을 새 메시지 없이 turn의 진행만 담는다.
        const before = compactionOf(session);
        const through = BigInt(input.through_seq);
        if (
          before !== null &&
          (turn === null
            ? through <= BigInt(before.through_seq)
            : through < BigInt(before.through_seq))
        ) {
          return reject("conflict", "the summary covers nothing new");
        }
        const after: Compaction = {
          through_seq: input.through_seq,
          summary_call: call,
        };
        const seq = nextSessionSeq(tx);
        tx.sql.run(
          `update sessions set compaction_through_seq = ?,
             compaction_summary_call = ?, state_seq = ? where id = ?`,
          [BigInt(after.through_seq), after.summary_call, seq, session.id],
        );
        closeRequest(tx, request.request_seq, "compacted", null);
        publishCompact(tx, session.id, "CompactEnded", { ok: true });
        return ok({
          id: session.id,
          compaction: after,
          state_seq: String(seq),
        });
      },
    },
    failCompact: {
      route: failSessionCompact,
      handle(
        tx,
        ctx,
        input: Input<typeof failSessionCompact>,
        compare,
      ): Result<{
        id: string;
        request_seq: string;
        reason: typeof input.reason;
      }> {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const session = loadSession(tx, input.session);
        if (session === undefined) return sessionNotFound();
        const request = openCompactRequest(tx, session.id);
        if (
          request === undefined ||
          request.request_seq !== compare.request_seq
        ) {
          return reject("conflict", "no such open Compact request");
        }
        closeRequest(tx, request.request_seq, "failed", input.reason);
        publishCompact(tx, session.id, "CompactEnded", { ok: false });
        return ok({
          id: session.id,
          request_seq: request.request_seq,
          reason: input.reason,
        });
      },
    },
  };
}
