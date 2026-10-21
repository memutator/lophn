import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import { turnAdmission } from "./turn-admission.ts";

type TurnDisposition = {
  // 끝난 turn에서도 통과하는 감사 보완. 새 대상 변경이 아니다.
  audit?: boolean;
  // turn 판정 자체를 적는 command. gate 밖이어야 상태를 확인할 수 있다.
  skip?: boolean;
};

// 표시는 command 정의에 붙는다. 전역 표는 writer가 둘이면 뒤 등록이 앞 등록을 덮는다.
type TurnMarkedCommand = CommandDefinition & {
  turnDisposition?: TurnDisposition;
};

export function turnDisposition(
  definition: CommandDefinition,
): TurnDisposition {
  const declared = (definition as TurnMarkedCommand).turnDisposition;
  return {
    audit: declared?.audit === true,
    skip: declared?.skip === true,
  };
}

// agent command는 자격에 묶인 turn만 받는다. 끝난 turn은 감사 보완만 통과한다.
// 판정은 lophn-agent의 turn 유효성 read가 한다. port가 없으면 fail closed다.
// turn ledger가 등록하기 전에는 제품에서 agent command가 막힌다.
export function admitAgentTurn(
  tx: Tx,
  ctx: RequestContext,
  disposition: TurnDisposition,
): Result<void> {
  if (!ctx.actor.startsWith("agent:")) return ok(undefined);
  // turn 판정 자체를 적는 command는 gate 밖이다. 아니면 상태를 확인할 수 없다.
  if (disposition.skip === true) return ok(undefined);
  if (ctx.turn === undefined) {
    return err({
      code: "forbidden",
      message: "agent command에는 turn이 필요하다",
    });
  }
  const lookup = tx as Tx & {
    portLookup?: { present(key: object): boolean };
  };
  // port가 없으면 판정할 수 없다. 새 대상 변경은 거절한다.
  if (lookup.portLookup?.present(turnAdmission) !== true) {
    return err({
      code: "unavailable",
      message: "turn 상태를 확인할 수 없다",
    });
  }
  const status = tx.port(turnAdmission).status(ctx.turn);
  if (status === "active") return ok(undefined);
  if (status === "finished" && disposition.audit === true) return ok(undefined);
  return err({
    code: "forbidden",
    message: "끝난 turn의 새 대상 변경은 거절한다",
  });
}
