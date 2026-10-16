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
  Tx,
} from "../../../protocol/server/mod.ts";
import {
  reject,
  requireMachine,
  requireUser,
  sessionNotFound,
} from "./guards.ts";
import {
  hasUnfinishedRun,
  loadSession,
  nextSessionSeq,
  openCompactRequest,
  type SessionRow,
} from "./model.ts";
import { publishAfterCommit } from "../run-loop/turn-events.ts";

// Compact. 사람이 부를 때만 같은 session의 앞 구간 요약을 이후 call의 조립에 쓰게 정한다.
// 요약 call은 짧은 transaction 안에서 부를 수 없어서 세 걸음으로 나눈다. 사람이 요청하고(Request),
// runtime이 session agent의 model에 요약 지시를 보내 요약을 받고, 끝까지 성공한 그 call을 구간과 함께
// session에 이어 요청을 끝낸다(Compact). 요약이 실패하면 요청만 이유와 함께 닫는다(Fail). 요청의 진행은
// session 행을 바꾸지 않아 입력 접수에 닿지 않고, 원문은 어느 경우에도 지우지 않는다.
// 요청, 구간, 경계는 session 기록(표)에만 쓴다. 시작과 끝은 Bus의 agent event다.

function publishCompact(
  tx: Tx,
  session: string,
  type: "CompactStarted" | "CompactEnded",
  payload: { turn: null } | { ok: boolean },
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
  return tx.sql.get(
    "select 1 as found from messages where session = ? and created_seq > ? limit 1",
    [session.id, BigInt(session.compaction_through_seq ?? "0")],
  ) !== undefined;
}

// 이 session에 묶인 요약 call로 끝까지 성공한(완전 출력이 있는) 것이다. 시작·실패·취소·부분 출력 call과
// 판단 용도 call, run 안의 압축 call, 다른 session의 call은 Compact의 요약이 아니다.
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
        const user = requireUser(ctx);
        if (!user.ok) return user;
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
        if (hasUnfinishedRun(tx, session.id)) {
          return reject("conflict", "a run of the session is not finished");
        }
        if (session.state_seq !== compare.state_seq) {
          return reject("conflict", "session changed");
        }
        if (!hasMessageAfterSpan(tx, session)) {
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
        publishCompact(tx, session.id, "CompactStarted", { turn: null });
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
          request === undefined || request.request_seq !== compare.request_seq
        ) {
          return reject("conflict", "no such open Compact request");
        }
        if (hasUnfinishedRun(tx, session.id)) {
          return reject("conflict", "a run of the session is not finished");
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
        const before = compactionOf(session);
        if (
          before !== null &&
          BigInt(input.through_seq) <= BigInt(before.through_seq)
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
          [
            BigInt(after.through_seq),
            after.summary_call,
            seq,
            session.id,
          ],
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
      ): Result<
        { id: string; request_seq: string; reason: typeof input.reason }
      > {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const session = loadSession(tx, input.session);
        if (session === undefined) return sessionNotFound();
        const request = openCompactRequest(tx, session.id);
        if (
          request === undefined || request.request_seq !== compare.request_seq
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
