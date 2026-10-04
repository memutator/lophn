import { err, ok, type Result } from "../../base/mod.ts";
import {
  advanceSubscriberCursor,
  type CommandDefinition,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
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

export type RunMark = { name: string; audit: boolean; skip: boolean };

// command 등록이 선언한 run 판정 표시. 감사 보완과 gate 밖 쓰기를 route 이름과 분리한다.
// 표시는 writer 등록이 넘긴다. 없으면 새 대상 변경으로 판정한다.
let runMarks: Readonly<Record<string, { audit?: boolean; skip?: boolean }>> =
  {};

export function bindRunMarks(
  marks: Readonly<Record<string, { audit?: boolean; skip?: boolean }>>,
): void {
  runMarks = marks;
}

export function runMark(definition: CommandDefinition): RunMark {
  const declared = runMarks[definition.route.name];
  return {
    name: definition.route.name,
    audit: declared?.audit === true,
    skip: declared?.skip === true,
  };
}

// agent command는 자격에 묶인 run만 받는다. 끝난 run은 감사 보완만 통과한다(ledger R11).
// 판정은 lophn-agent의 run 유효성 read가 하고, 없으면 새 대상 변경을 거절한다.
export function admitAgentRun(
  tx: Tx,
  ctx: RequestContext,
  event: { name: string; audit?: boolean; skip?: boolean },
): Result<void> {
  if (!ctx.actor.startsWith("agent:")) return ok(undefined);
  // run 판정 자체를 적는 command는 gate 밖이다. 아니면 상태를 확인할 수 없다.
  if (event.skip === true) return ok(undefined);
  if (ctx.run === undefined) {
    return err({
      code: "forbidden",
      message: "agent command에는 run이 필요하다",
    });
  }
  // run 판정 port가 없으면 이 gate는 판정하지 않는다. 판정은 port를 등록한 경계가 맡는다.
  const lookup = tx as Tx & {
    portLookup?: { present(key: object): boolean };
  };
  if (lookup.portLookup?.present(runAdmission) !== true) return ok(undefined);
  const status = tx.port(runAdmission).status(ctx.run);
  if (status === "active") return ok(undefined);
  if (status === "finished" && event.audit === true) return ok(undefined);
  return err({
    code: "forbidden",
    message: "끝난 run의 새 대상 변경은 거절한다",
  });
}
