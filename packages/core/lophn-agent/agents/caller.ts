import { err, ok, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type { Place, Role } from "../../../protocol/lophn-agent/mod.ts";
import type { RequestContext } from "../../../protocol/server/mod.ts";
import { loadSession, placeOf } from "../session/model.ts";
import type { AgentDeps, ReadSql } from "./ports.ts";

// agent가 부르면 그 session의 role과 place가 범위다: 정의를 읽고 Operator를 만들고 고치는 것은 자기 place뿐이다.
// 사람과 machine은 범위가 없다(null).
export function agentCallerRule(
  sql: ReadSql,
  ctx: Pick<RequestContext, "actor">,
  operatorPlaceAllowed: AgentDeps["operatorPlaceAllowed"],
): Result<((target: Place | null) => Result<void>) | null> {
  const actor = parseActor(ctx.actor);
  if (actor?.kind !== "agent") return ok(null);
  const row = loadSession({ sql }, actor.id);
  if (row === undefined) {
    return err({ code: "forbidden", message: "unknown agent session" });
  }
  const own = placeOf(row);
  const role: Role = row.role;
  return ok((target) =>
    target !== null && operatorPlaceAllowed(role, own, target)
      ? ok(undefined)
      : err({
        code: "forbidden",
        message: "an agent works only in its own place",
      })
  );
}
