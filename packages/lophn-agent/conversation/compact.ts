import { ok, type Result } from "../../base/mod.ts";
import {
  compactSession,
  sessionCompacted,
} from "../../contracts/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  Input,
  Tx,
} from "../../contracts/platform/mod.ts";
import { reject, requireUser, sessionNotFound } from "./guards.ts";
import { hasUnfinishedRun, loadSession, type SessionRow } from "./model.ts";

// Compact(R10). 사람이 부를 때만 같은 session의 앞 구간 요약을 이후 call의 조립에 쓰게 정한다.
// 요약 call 자체(organizing 용도, Workspace의 Model for summaries)는 prompt-assemble의 요약 규칙이
// 만들어 usage에 기록한다. 이 command는 그 call 가운데 끝까지 성공한 가장 나중 것 하나를 session에
// 잇고 요약이 덮는 구간을 정한다. 요약 call이 없거나 실패했으면 session은 바뀌지 않고 원문은 어느
// 경우에도 지우지 않는다.

type Compaction = { through_seq: string; summary_call: string };

type SummaryCall = {
  id: string;
  provider: string;
  model_name: string;
  started_seq: string;
};

function compactionOf(session: SessionRow): Compaction | null {
  return session.compaction_through_seq === null ||
      session.compaction_summary_call === null
    ? null
    : {
      through_seq: session.compaction_through_seq,
      summary_call: session.compaction_summary_call,
    };
}

// 이 session의 요약 call 가운데 끝까지 성공한(완전 출력이 있는) 가장 나중 것이다. 시작·실패·취소·
// 부분 출력 call과 판단 용도 call, 다른 session의 call은 요약이 아니다.
function latestSummaryCall(tx: Tx, session: string): SummaryCall | undefined {
  const row = tx.sql.get(
    `select c.id as id, c.provider as provider, c.model_name as model_name,
       cast(e.seq as text) as started_seq
     from model_calls c
     join events e on e.subject = c.id and e.type = 'ModelCallStarted'
     where c.session = ? and c.purpose = 'conversation_compression'
       and c.model_use = 'organizing' and c.state = 'finished'
       and c.output is not null and json_extract(c.outcome, '$.kind') = 'complete'
     order by e.seq desc limit 1`,
    [session],
  );
  return row === undefined ? undefined : {
    id: String(row["id"]),
    provider: String(row["provider"]),
    model_name: String(row["model_name"]),
    started_seq: String(row["started_seq"]),
  };
}

// 요약은 Workspace의 Model for summaries로 만든다. 그 칸이 비어 있으면 그 run의 agent model을
// 쓰므로 어느 model이든 받는다(harness/model#R8).
function usesSummariesModel(tx: Tx, call: SummaryCall): boolean {
  const slot = tx.sql.get(
    "select provider, model_name from agent_model_defaults where slot = 'summaries'",
    [],
  );
  if (slot === undefined || slot["provider"] === null) return true;
  return slot["provider"] === call.provider &&
    slot["model_name"] === call.model_name;
}

type CompactOutput = {
  id: string;
  compaction: Compaction;
  state_seq: string;
};

export function createCompactCommand(): CommandDefinition<
  typeof compactSession
> {
  return {
    route: compactSession,
    handle(
      tx,
      ctx,
      input: Input<typeof compactSession>,
      compare,
    ): Result<CompactOutput> {
      const user = requireUser(ctx);
      if (!user.ok) return user;
      const session = loadSession(tx, input.session);
      if (session === undefined) return sessionNotFound();
      if (session.state !== "open") {
        return reject("conflict", "the session is closed");
      }
      const call = latestSummaryCall(tx, session.id);
      if (call === undefined) {
        return reject("unavailable", "no summary call finished well");
      }
      const before = compactionOf(session);
      // 이미 이 call로 정한 요약이면 처음 결과다. 새 요약 call이 없는데 다시 부른 경우도 같다.
      if (before?.summary_call === call.id) {
        return ok({
          id: session.id,
          compaction: before,
          state_seq: session.state_seq,
        });
      }
      if (hasUnfinishedRun(tx, session.id)) {
        return reject("conflict", "a run of the session is not finished");
      }
      if (session.state_seq !== compare.state_seq) {
        return reject("conflict", "session changed");
      }
      if (!usesSummariesModel(tx, call)) {
        return reject(
          "conflict",
          "the summary was not made with the Model for summaries",
        );
      }
      // 요약이 덮는 구간은 요약 call을 시작하기 전에 있던 확정 메시지까지다. 그 뒤에 온 메시지는
      // 요약에 들지 않고 원문 그대로 이후 call에 붙는다.
      const covered = tx.sql.get(
        `select cast(max(created_seq) as text) as through from messages
         where session = ? and created_seq < ?`,
        [session.id, BigInt(call.started_seq)],
      );
      if (covered === undefined || covered["through"] === null) {
        return reject("conflict", "the summary call covers no message");
      }
      const after: Compaction = {
        through_seq: String(covered["through"]),
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
      return ok({ id: session.id, compaction: after, state_seq: seq });
    },
  };
}
