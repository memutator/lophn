import { ok, type Result } from "../../base/mod.ts";
import {
  forkSession,
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  messageRecorded,
  sessionForked,
} from "../../contracts/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  Input,
  Tx,
} from "../../contracts/platform/mod.ts";
import { hiddenRanges, inHiddenRange } from "../revert/mod.ts";
import { reject, requireUser } from "./guards.ts";
import {
  hasUnfinishedRun,
  loadAssignmentRef,
  loadSession,
  MESSAGE_COLUMNS,
  messageRowOf,
  type SessionRow,
} from "./model.ts";

// Fork(R9). 같은 agent·같은 자리의 새 session을 만들고 고른 지점까지의 확정 메시지를 복사한다.
// rewind가 숨긴 구간의 메시지는 복사하지 않는다. 복사본은 지난 발언이라 run·mode·최초 반영이 없다. run·질문·approval request·model call은 복사하지
// 않으므로 새 판단이 과거의 결정이나 효과를 재사용하지 않는다.

type ForkOutput = {
  id: string;
  state: "open";
  forked_from: { session: string; through_seq: string };
  copied_messages: number;
  state_seq: string;
};

function copiedCount(tx: Tx, session: string): number {
  const row = tx.sql.get(
    "select count(*) as n from messages where session = ? and copied_from is not null",
    [session],
  );
  return Number(row?.["n"] ?? 0);
}

// 같은 ID의 재전송은 처음 결과다. 출처와 지점이 다르면 다른 입력이다.
function replay(
  tx: Tx,
  existing: SessionRow,
  input: Input<typeof forkSession>,
): Result<ForkOutput> {
  if (
    existing.forked_from_session !== input.source ||
    existing.forked_from_through_seq !== input.through_seq
  ) {
    return reject("conflict", "session id already used for other input");
  }
  return ok({
    id: existing.id,
    state: "open",
    forked_from: { session: input.source, through_seq: input.through_seq },
    copied_messages: copiedCount(tx, existing.id),
    state_seq: existing.created_seq,
  });
}

export function createForkCommand(): CommandDefinition<typeof forkSession> {
  return {
    route: forkSession,
    handle(tx, ctx, input) {
      const user = requireUser(ctx);
      if (!user.ok) return user;
      const existing = loadSession(tx, input.id);
      if (existing !== undefined) return replay(tx, existing, input);
      const source = loadSession(tx, input.source);
      if (source === undefined) {
        return reject("not_found", "source session not found");
      }
      const assignment = loadAssignmentRef(tx, source.assignment);
      if (assignment === undefined) {
        return reject("not_found", "assignment not found");
      }
      // 멈춘 assignment(대상 보관)와 회수된 assignment는 새 session을 받지 않는다(R8).
      if (assignment.state !== "enabled") {
        return reject(
          "forbidden",
          "only an enabled assignment takes a session",
        );
      }
      // 끝나지 않은 run이 있으면 복사본이 어느 시점인지 정할 수 없다(conversation#Q6).
      if (hasUnfinishedRun(tx, source.id)) {
        return reject("conflict", "a run of the session is not finished");
      }
      const through = BigInt(input.through_seq);
      const chosen = tx.sql.get(
        "select 1 as found from messages where session = ? and created_seq = ?",
        [source.id, through],
      );
      if (chosen === undefined) {
        return reject(
          "invalid_input",
          "the chosen point is not a confirmed message of the session",
        );
      }
      // rewind가 숨긴 구간은 복사하지 않는다(R25). redo를 쓰면 다시 보이는 메시지라 그때부터 복사한다.
      const hidden = hiddenRanges(tx, source.id);
      const originals = tx.sql.all(
        `select ${MESSAGE_COLUMNS} from messages
         where session = ? and created_seq <= ? order by created_seq`,
        [source.id, through],
      ).map(messageRowOf).filter((message) =>
        !inHiddenRange(hidden, message.created_seq)
      );

      const forkedFrom = { session: source.id, through_seq: input.through_seq };
      const seq = tx.emit(sessionForked, input.id, {
        forked_from: forkedFrom,
        copied_messages: originals.length,
      });
      // 제목·첫 context·model 선택은 출처에서 이어받고 archive와 요약(compaction)은 이어받지 않는다.
      tx.sql.run(
        `insert into sessions (id, assignment, work_place_kind, work_place_id,
           title, archived, state, forked_from_session, forked_from_through_seq,
           opening_source_seq, opening_target, model_selection, created_seq,
           state_seq)
         values (?, ?, ?, ?, ?, 0, 'open', ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id,
          source.assignment,
          source.work_place_kind,
          source.work_place_id,
          source.title,
          source.id,
          through,
          source.opening_source_seq === null
            ? null
            : BigInt(source.opening_source_seq),
          source.opening_target,
          source.model_selection,
          Number(seq),
          Number(seq),
        ],
      );
      for (const original of originals) {
        const copy = tx.newId("msg");
        const copySeq = tx.emit(messageRecorded, copy, {
          session: input.id,
          run: null,
          body: original.body,
          links: JSON.parse(original.links),
        });
        tx.sql.run(
          `insert into messages (id, session, actor, body, run, mode,
             applied_at_call, links, copied_from, created_seq, state_seq)
           values (?, ?, ?, ?, null, null, null, ?, ?, ?, ?)`,
          [
            copy,
            input.id,
            original.actor,
            original.body,
            original.links,
            original.id,
            Number(copySeq),
            Number(copySeq),
          ],
        );
        // 복사한 메시지의 본문 참조는 새 메시지가 따로 등록한다. 같은 blob을 가리킬 뿐
        // 원래 메시지의 참조와 수명이 묶이지 않는다.
        const registered = tx.registerBlobRef({
          owner_kind: MESSAGE_BODY_OWNER_KIND,
          owner_key: copy,
          field: MESSAGE_BODY_FIELD,
          registered_seq: copySeq,
          source: {
            kind: "existing",
            reference: {
              owner_kind: MESSAGE_BODY_OWNER_KIND,
              owner_key: original.id,
              field: MESSAGE_BODY_FIELD,
              hash: original.body,
              registered_seq: original.created_seq,
            },
          },
        });
        if (!registered.ok) return registered;
      }
      return ok({
        id: input.id,
        state: "open" as const,
        forked_from: forkedFrom,
        copied_messages: originals.length,
        state_seq: seq,
      });
    },
  };
}
