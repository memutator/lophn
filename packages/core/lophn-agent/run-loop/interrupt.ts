import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import { createHash } from "node:crypto";
import type { Id } from "../../../protocol/base/ids.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { interruptTurns } from "../../../protocol/lophn-agent/mod.ts";
import type { CommandDefinition, Tx } from "../../../protocol/server/mod.ts";
import { abandonTurnCall, finishRow } from "./commands.ts";
import { loadTurn, TURN_COLUMNS, turnRowOf } from "./model.ts";
import type { CallSignals } from "./ports.ts";
import { type PublishAgentEvent, publishTurnEnded } from "./turn-events.ts";

// 돌던 turn을 core가 interrupted로 닫는다. 다시 잇지 않는다(복구는 없다).
// - `restarted`: lophn을 켤 때 state = running인 turn 전부(꺼지면서 queue와 메모리 기다림도 사라졌다)와,
//   agent runtime child가 도는 중에 사라졌을 때(`interruptTurns`).
// - `session_ended`: session을 archive하거나 지울 때 그 session의 turn. workspaces의 `EndDeps`가 같은 tx 안에서 부른다.
// 그 turn의 requested·started tool call은 결과를 모르므로 uncertain으로 닫고 turn 결과에 unknown_effects로 싣는다(ACP 화면이
// finished가 아닌 call을 실행 중으로 그린다). 다음 turn은 이 목록을 읽어 model에 알린다.
// 대기 중이던 권한 요청과 질문의 cancelled 처리는 approvals와 agent-tools가 한다.

// tools의 `toolsCloseStuckSteps`와 같은 값이다.
const UNCERTAIN_OUTCOME = '{"kind":"uncertain","code":"uncertain"}';
const UNCERTAIN_RESULT =
  '{"status":"uncertain","summary":"The call was cut off when its turn ended; its outcome is not confirmed.","content":null,"complete":true,"source":null,"continuation":null,"pending":[]}';

type InterruptReason = "restarted" | "session_ended";

export function interruptRunningTurns(
  tx: Tx,
  publish: PublishAgentEvent | undefined,
  reason: InterruptReason,
  session?: Id<"ses">,
  // 재시작으로 닫는 turn이 가져간 call을 보낸 쪽에 돌려준다. session을 끝낼 때는 Router가 그 session의 call을 따로 닫는다.
  calls?: { signals: CallSignals; notify: boolean },
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
    const open = tx.sql
      .all(
        `select id from tool_calls where turn = ? and state in ('requested', 'started') order by id`,
        [row.id],
      )
      .map((call) => String(call.id));
    const facts = {
      turn: row.id,
      session: row.session,
      outcome,
      unknown_effects: open,
    };
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
    const abandoned = abandonTurnCall(
      tx,
      calls?.signals,
      current,
      outcome,
      calls?.notify ?? false,
    );
    if (!abandoned.ok) return abandoned;
    tx.sql.run(
      `update tool_calls set state = 'finished', outcome = ?, result = ?, finished_at = ?, state_seq = state_seq + 1
       where turn = ? and state in ('requested', 'started')`,
      [UNCERTAIN_OUTCOME, UNCERTAIN_RESULT, done.value.finished_at, row.id],
    );
    publishTurnEnded(tx, publish, current, outcome);
  }
  return ok(rows.length);
}

// agent runtime child가 사라졌을 때 core가 부른다. queue의 running 표시는 부른 쪽이 푼다.
export function interruptTurnsCommand(
  publish: PublishAgentEvent | undefined,
  // 닫는 turn이 가져간 call을 보낸 쪽에 돌려준다. 알림 글은 main thread가 이 command 앞에 준비한다.
  calls?: CallSignals,
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
      const done = interruptRunningTurns(
        tx,
        publish,
        "restarted",
        undefined,
        calls === undefined ? undefined : { signals: calls, notify: true },
      );
      return done.ok ? ok({ interrupted: done.value }) : done;
    },
  };
}
