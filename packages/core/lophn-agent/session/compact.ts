import { ok, type Result } from "../../../base/mod.ts";
import {
  compactSession,
  failSessionCompact,
  requestSessionCompact,
  sessionCompacted,
  sessionCompactFailed,
  sessionCompactRequested,
} from "../../../protocol/lophn-agent/mod.ts";
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
  openCompactRequest,
  type SessionRow,
} from "./model.ts";

// Compact(R10). 사람이 부를 때만 같은 session의 앞 구간 요약을 이후 call의 조립에 쓰게 정한다.
// 요약 call은 짧은 transaction 안에서 부를 수 없어서 세 걸음으로 나눈다. 사람이 요청하고(Request),
// runtime이 prompt-assemble의 요약 규칙으로 요약하는 model call을 하고(Workspace의 Model for
// summaries, 비면 session agent의 model), 끝까지 성공한 그 call을 구간과 함께 session에 이어 요청을
// 끝낸다(Compact). 요약이 실패하면 요청만 이유와 함께 닫는다(Fail). 요청의 진행은 session 행을
// 바꾸지 않아 입력 접수에 닿지 않고, 원문은 어느 경우에도 지우지 않는다.

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

type SummaryCall = {
  id: string;
  provider: string;
  model_name: string;
  started_seq: string;
};

// 이 session에 묶인 요약 call로 끝까지 성공한(완전 출력이 있는) 것이다. 시작·실패·취소·부분 출력 call과
// 판단 용도 call, run 안의 압축 call, 다른 session의 call은 Compact의 요약이 아니다.
function summaryCall(
  tx: { sql: Pick<Tx["sql"], "get"> },
  session: string,
  call: string,
): SummaryCall | undefined {
  const row = tx.sql.get(
    `select c.id as id, c.provider as provider, c.model_name as model_name,
       cast(e.seq as text) as started_seq
     from model_calls c
     join events e on e.subject = c.id and e.type = 'ModelCallStarted'
     where c.id = ? and c.session = ? and c.run is null
       and c.purpose = 'conversation_compression'
       and c.model_use = 'organizing' and c.state = 'finished'
       and c.output is not null and json_extract(c.outcome, '$.kind') = 'complete'`,
    [call, session],
  );
  return row === undefined ? undefined : {
    id: String(row["id"]),
    provider: String(row["provider"]),
    model_name: String(row["model_name"]),
    started_seq: String(row["started_seq"]),
  };
}

// 요약은 Workspace의 Model for summaries로 만든다. 그 칸이 비어 있으면 session agent의 model을
// 쓰므로 어느 model이든 받는다(harness/model#R8).
function usesSummariesModel(
  tx: { sql: Pick<Tx["sql"], "get"> },
  call: SummaryCall,
): boolean {
  const slot = tx.sql.get(
    "select provider, model_name from agent_model_defaults where slot = 'summaries'",
    [],
  );
  if (slot === undefined || slot["provider"] === null) return true;
  return slot["provider"] === call.provider &&
    slot["model_name"] === call.model_name;
}

// rewind의 "Summarize from here"도 Compact와 같은 요약 call을 쓴다(revert R15). 이 session에 묶여 끝까지
// 성공하고 Model for summaries로 만든 call인가.
export function isFinishedSummaryCall(
  lookup: { sql: Pick<Tx["sql"], "get"> },
  session: string,
  call: string,
): boolean {
  const found = summaryCall(lookup, session, call);
  return found !== undefined && usesSummariesModel(lookup, found);
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
        if (session.state !== "open") {
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
        const seq = tx.emit(sessionCompactRequested, session.id, {});
        tx.sql.run(
          "insert into session_compact_requests (request_seq, session, state) values (?, ?, 'requested')",
          [BigInt(seq), session.id],
        );
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
        if (session.state !== "open") {
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
        // 요청보다 앞서 시작한 call은 이 요청의 요약이 아니다.
        if (BigInt(call.started_seq) < BigInt(request.request_seq)) {
          return reject("conflict", "the summary call predates the request");
        }
        if (!usesSummariesModel(tx, call)) {
          return reject(
            "conflict",
            "the summary was not made with the Model for summaries",
          );
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
          summary_call: call.id,
        };
        const seq = tx.emit(sessionCompacted, session.id, { before, after });
        tx.sql.run(
          `update sessions set compaction_through_seq = ?,
             compaction_summary_call = ?, state_seq = ? where id = ?`,
          [
            BigInt(after.through_seq),
            after.summary_call,
            Number(seq),
            session.id,
          ],
        );
        closeRequest(tx, request.request_seq, "compacted", null);
        return ok({ id: session.id, compaction: after, state_seq: seq });
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
        tx.emit(sessionCompactFailed, session.id, {
          request: request.request_seq,
          reason: input.reason,
        });
        closeRequest(tx, request.request_seq, "failed", input.reason);
        return ok({
          id: session.id,
          request_seq: request.request_seq,
          reason: input.reason,
        });
      },
    },
  };
}
