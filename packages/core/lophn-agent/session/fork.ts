import { ok, type Result } from "../../../base/mod.ts";
import {
  forkSession,
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  Input,
  Tx,
} from "../../../protocol/server/mod.ts";
import { startSession } from "../places/lifecycle.ts";
import type { OpenDeps } from "../places/ports.ts";
import { hiddenRanges, inHiddenRange } from "./rewind/mod.ts";
import { reject, requireUser } from "./guards.ts";
import {
  agentRefOf,
  loadSession,
  MESSAGE_COLUMNS,
  messageRowOf,
  nextMessageSeq,
  type SessionRow,
} from "./model.ts";

// Fork. 같은 agent(role과 place, Operator면 같은 Operator)의 새 session을 만들고 고른 지점까지의 확정
// 메시지를 복사한다. rewind가 숨긴 구간의 메시지는 복사하지 않는다. 이력만 가져간다: 허락, 대기 요청과 질문,
// 열린 call, rewind 기록은 원래 session에 묶여 있어 새 session은 가져오지 않는다. 복사본은 봉투를 그대로
// 두지만 새 session의 turn이 가져간 적이 없어 turn은 비어 있다.

type ForkOutput = {
  id: string;
  state: "open";
  forked_from: { session: string; through_seq: string };
  copied_messages: number;
  state_seq: string;
};

// through까지의 확정 메시지 가운데 rewind가 숨기지 않은 것이 복사할 이력이다.
function originalsOf(tx: Tx, source: string, through: bigint) {
  // redo를 쓰면 다시 보이는 메시지라 그때부터 복사한다.
  const hidden = hiddenRanges(tx, source);
  return tx.sql.all(
    `select ${MESSAGE_COLUMNS} from messages
     where session = ? and created_seq <= ? order by created_seq`,
    [source, through],
  ).map(messageRowOf).filter((message) =>
    !inHiddenRange(hidden, message.created_seq)
  );
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
    copied_messages: originalsOf(tx, input.source, BigInt(input.through_seq))
      .length,
    state_seq: existing.created_seq,
  });
}

export function createForkCommand(
  open: (tx: Tx) => OpenDeps,
): CommandDefinition<typeof forkSession> {
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
      const originals = originalsOf(tx, source.id, through);

      // 제목과 model 선택은 출처에서 이어받고 archive와 요약(compaction)은 이어받지 않는다. 보관한 place와
      // 없어진 Operator에는 새 session을 열지 못한다.
      const started = startSession(tx, open(tx), {
        id: input.id,
        agent: agentRefOf(source),
        opening: source.opening_source_seq === null ||
            source.opening_target === null
          ? null
          : {
            source_seq: source.opening_source_seq,
            target: source.opening_target,
          },
        inherit: {
          title: source.title,
          model_selection: source.model_selection,
          forked_from: { session: source.id, through_seq: through },
        },
      });
      if (!started.ok) return started;
      for (const original of originals) {
        const copy = tx.newId("msg");
        const seq = nextMessageSeq(tx);
        tx.sql.run(
          `insert into messages (id, session, from_kind, from_ref, call,
             reply_to, refs, delivery, turn, body, created_seq, created_at,
             state_seq)
           values (?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?, ?)`,
          [
            copy,
            input.id,
            original.from_kind,
            original.from_ref,
            original.call,
            original.reply_to,
            original.refs,
            original.delivery,
            original.body,
            seq,
            original.created_at,
            seq,
          ],
        );
        // 복사한 메시지의 본문 참조는 새 메시지가 따로 등록한다. 같은 blob을 가리킬 뿐
        // 원래 메시지의 참조와 수명이 묶이지 않는다.
        const registered = tx.registerBlobRef({
          owner_kind: MESSAGE_BODY_OWNER_KIND,
          owner_key: copy,
          field: MESSAGE_BODY_FIELD,
          registered_seq: String(seq),
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
        forked_from: { session: source.id, through_seq: input.through_seq },
        copied_messages: originals.length,
        state_seq: started.value.state_seq,
      });
    },
  };
}
