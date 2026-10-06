import { ok } from "../../base/mod.ts";
import {
  revertApplied,
  revertBlocked,
  revertFinished,
  revertStarted,
} from "../../contracts/lophn-agent/mod.ts";
import {
  type EventDefinition,
  type EventVisibilityDefinition,
  parseActor,
} from "../../contracts/platform/mod.ts";

// revert 계기 event(RevertStarted·RevertApplied·RevertBlocked·RevertFinished)의 공개 정책이다.
// 사람은 모든 revert를 따라 보고 agent는 자기 assignment의 run에 대한 revert만 본다. 그 밖의
// 자격은 못 본다. payload는 run ID·지문·결과별 수뿐이라 글이나 secret이 없다. 읽을 자격은 같은
// 사실을 읽는 `ListReverts`가 scope에 있어야 하고, event의 run이 그 revert의 run과 같아야 한다.
function revertVisibility<D extends EventDefinition>(
  event: D,
): EventVisibilityDefinition<D> {
  return {
    event,
    handle(snapshot, ctx, envelope) {
      if (!ctx.scope.operations.includes("ListReverts")) return ok(false);
      const actor = parseActor(ctx.actor);
      if (actor === undefined) return ok(false);
      const run = (envelope.payload as { run?: unknown }).run;
      const row = snapshot.sql.get(
        `select v.run as run, r.assignment as assignment
           from reverts v join runs r on r.id = v.run where v.id = ?`,
        [envelope.subject as string],
      );
      if (row === undefined || String(row["run"]) !== run) return ok(false);
      if (actor.kind === "user") return ok(true);
      if (actor.kind === "agent") {
        return ok(String(row["assignment"]) === actor.id);
      }
      return ok(false);
    },
  };
}

export function createRevertEventVisibility(): EventVisibilityDefinition[] {
  return [
    revertVisibility(revertStarted),
    revertVisibility(revertApplied),
    revertVisibility(revertBlocked),
    revertVisibility(revertFinished),
  ] as EventVisibilityDefinition[];
}
