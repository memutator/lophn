import { err, ok, type Result } from "../../../base/mod.ts";
import {
  advanceSubscriberCursor,
  type CommandDefinition,
  type RequestContext,
  type Tx,
} from "../../../protocol/server/mod.ts";
import { defineSyncCommand } from "./handler.ts";
import { runAdmission } from "./run-admission.ts";

// 반응 없는 구간의 cursor만 올린다. 줄어들면 conflict이고 event는 없다(R22, domain model).
export const advanceSubscriberCursorCommand = defineSyncCommand(
  advanceSubscriberCursor,
  (tx: Tx, _ctx: RequestContext, input, _compare) => {
    const advanced = tx.advanceSubscriberCursor(
      input.subscriber,
      input.scanned_through_seq,
    );
    if (!advanced.ok) return advanced;
    return ok({ processed_through_seq: input.scanned_through_seq });
  },
);

export const LEDGER_COMMANDS = [advanceSubscriberCursorCommand];

export type RunDisposition = {
  // 끝난 run에서도 통과하는 감사 보완. 새 대상 변경이 아니다.
  audit?: boolean;
  // run 판정 자체를 적는 command. gate 밖이어야 상태를 확인할 수 있다.
  skip?: boolean;
};

// 표시는 command 정의에 붙는다. 전역 표는 writer가 둘이면 뒤 등록이 앞 등록을 덮는다.
export type RunMarkedCommand = CommandDefinition & {
  runDisposition?: RunDisposition;
};

export function runDisposition(definition: CommandDefinition): RunDisposition {
  const declared = (definition as RunMarkedCommand).runDisposition;
  return {
    audit: declared?.audit === true,
    skip: declared?.skip === true,
  };
}

// agent command는 자격에 묶인 run만 받는다. 끝난 run은 감사 보완만 통과한다(ledger R11).
// 판정은 lophn-agent의 run 유효성 read가 한다. port가 없으면 fail closed다.
// run ledger(lophn-agent T10)가 등록하기 전에는 제품에서 agent command가 막힌다.
export function admitAgentRun(
  tx: Tx,
  ctx: RequestContext,
  disposition: RunDisposition,
): Result<void> {
  if (!ctx.actor.startsWith("agent:")) return ok(undefined);
  // run 판정 자체를 적는 command는 gate 밖이다. 아니면 상태를 확인할 수 없다.
  if (disposition.skip === true) return ok(undefined);
  if (ctx.run === undefined) {
    return err({
      code: "forbidden",
      message: "agent command에는 run이 필요하다",
    });
  }
  const lookup = tx as Tx & {
    portLookup?: { present(key: object): boolean };
  };
  // port가 없으면 판정할 수 없다. 새 대상 변경은 거절한다.
  if (lookup.portLookup?.present(runAdmission) !== true) {
    return err({
      code: "unavailable",
      message: "run 상태를 확인할 수 없다",
    });
  }
  const status = tx.port(runAdmission).status(ctx.run);
  if (status === "active") return ok(undefined);
  if (status === "finished" && disposition.audit === true) return ok(undefined);
  return err({
    code: "forbidden",
    message: "끝난 run의 새 대상 변경은 거절한다",
  });
}
