import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import { createHash } from "node:crypto";
import type { Id } from "../../../protocol/base/ids.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { interruptTurns } from "../../../protocol/lophn-agent/mod.ts";
import type { CommandDefinition, Tx } from "../../../protocol/server/mod.ts";
import { finishRow } from "./commands.ts";
import { loadTurn, TURN_COLUMNS, turnRowOf } from "./model.ts";
import { type PublishAgentEvent, publishTurnEnded } from "./turn-events.ts";

// 돌던 turn을 core가 interrupted로 닫는다. 다시 잇지 않는다(복구는 없다).
// - `restarted`: lophn을 켤 때 state = running인 turn 전부(꺼지면서 입력함과 메모리 기다림도 사라졌다)와,
//   agent runtime child가 도는 중에 사라졌을 때(`interruptTurns`).
// - `session_ended`: session을 archive하거나 지울 때 그 session의 turn. places의 `EndDeps`가 같은 tx 안에서 부른다.
// 대기 중이던 권한 요청과 질문의 cancelled 처리는 approvals와 agent-tools가 한다.

type InterruptReason = "restarted" | "session_ended";

export function interruptRunningTurns(
  tx: Tx,
  publish: PublishAgentEvent | undefined,
  reason: InterruptReason,
  session?: Id<"ses">,
): Result<number> {
  const rows = (
    session === undefined
      ? tx.sql.all(
          `select ${TURN_COLUMNS} from turns where state = 'running' order by started_at`,
          [],
        )
      : tx.sql.all(
          `select ${TURN_COLUMNS} from turns where state = 'running' and session = ?
       order by started_at`,
          [session],
        )
  ).map(turnRowOf);
  for (const row of rows) {
    // 모델이 쓴 본문이 없으므로 machine이 확정한 사실만 결과로 정리한다.
    const outcome = { kind: "interrupted" as const, reason };
    const facts = { turn: row.id, session: row.session, outcome };
    const result = createHash("sha256")
      .update(canonicalize(facts), "utf8")
      .digest("hex");
    const current = loadTurn(tx, row.id);
    if (current === undefined) continue;
    const done = finishRow(
      tx,
      current,
      outcome,
      result,
      canonicalize(facts),
      null,
    );
    if (!done.ok) return done;
    publishTurnEnded(tx, publish, current, outcome);
  }
  return ok(rows.length);
}

// agent runtime child가 사라졌을 때 core가 부른다. 입력함의 running 표시는 부른 쪽이 푼다.
export function interruptTurnsCommand(
  publish: PublishAgentEvent | undefined,
): CommandDefinition<typeof interruptTurns> {
  return {
    route: interruptTurns,
    handle(tx, ctx) {
      if (parseActor(ctx.actor)?.kind !== "machine") {
        return err({
          code: "forbidden",
          message: "only core interrupts turns",
        });
      }
      const done = interruptRunningTurns(tx, publish, "restarted");
      return done.ok ? ok({ interrupted: done.value }) : done;
    },
  };
}
