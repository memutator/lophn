import { err, ok, type Result } from "../../base/mod.ts";
import {
  handoffResult,
  handoffStatus,
} from "../../contracts/lophn-agent/mod.ts";
import {
  parseActor,
  type ReadDefinition,
  type RequestContext,
  type SqlParams,
  type SqlRow,
} from "../../contracts/platform/mod.ts";
import {
  type HandoffRun,
  loadAssignmentRef,
  loadByDedup,
  loadHandoffRun,
  loadRunRef,
} from "./model.ts";

// read는 pool read다. handler는 동기 Result를 돌려준다. 현황과 결과는 받는 run의 현재
// 사실이고 읽을 때마다 현재 권한으로 다시 검사한다(R9, plan Q24). 읽을 수 없는 대상은
// 없는 handoff와 똑같이 답한다. 사람과 machine은 모두 보고, agent는 지금 담당이 살아
// 있는 보낸 assignment 또는 받은 assignment만 본다. 이 외 자격은 보지 못한다.

export type HandoffReadDeps = {
  // 받는 run이 저장한 가장 최근 문서 고정 version(documents/versions). 문서 표를 소유한
  // concern의 조회라서 core 조립이 넣는다. 없으면 null이다.
  savedVersion(
    snapshot: {
      sql: {
        get: (query: string, params: SqlParams) => SqlRow | undefined;
      };
    },
    run: string,
  ): string | null;
};

type Snapshot = Parameters<ReadDefinition<typeof handoffStatus>["handle"]>[0];

function notFound(): Result<never> {
  return err({ code: "not_found", message: "handoff not found" });
}

function visible(
  snapshot: Snapshot,
  ctx: RequestContext,
  handoff: HandoffRun,
): boolean {
  const actor = parseActor(ctx.actor);
  if (actor === undefined) return false;
  if (actor.kind === "user" || actor.kind === "machine") return true;
  if (actor.kind !== "agent") return false;
  const sender = loadRunRef(snapshot, handoff.sender_run);
  const entitled = actor.id === handoff.assignment ||
    (sender !== undefined && actor.id === sender.assignment);
  if (!entitled) return false;
  const own = loadAssignmentRef(snapshot, actor.id);
  return own !== undefined && own.state !== "withdrawn";
}

export function createHandoffReads(deps: HandoffReadDeps): {
  status: ReadDefinition<typeof handoffStatus>;
  result: ReadDefinition<typeof handoffResult>;
} {
  return {
    status: {
      route: handoffStatus,
      handle(snapshot, ctx, input) {
        const handoff = loadByDedup(
          snapshot,
          input.sender_run,
          input.dedup_key,
        );
        if (handoff === undefined || !visible(snapshot, ctx, handoff)) {
          return notFound();
        }
        return ok({
          sender_run: handoff.sender_run,
          receiver_run: handoff.id,
          state: handoff.state as
            | "accepted"
            | "running"
            | "waiting_user"
            | "finished",
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    result: {
      route: handoffResult,
      handle(snapshot, ctx, input) {
        const handoff = loadHandoffRun(snapshot, input.receiver_run);
        if (handoff === undefined || !visible(snapshot, ctx, handoff)) {
          return notFound();
        }
        const common = {
          receiver_run: handoff.id,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        };
        if (handoff.state !== "finished" || handoff.result === null) {
          return ok({
            ...common,
            finished: false,
            result: null,
            version: null,
            absent_reason: null,
          });
        }
        // 결과는 문서 고정 version 하나 또는 산출물이 없는 이유다(R8). 이유는 run이
        // 확정한 최종 결과 blob이다. 후속 version은 이 결과를 바꾸지 않는다.
        const version = deps.savedVersion(snapshot, handoff.id);
        return ok({
          ...common,
          finished: true,
          result: handoff.result,
          version,
          absent_reason: version === null ? handoff.result : null,
        });
      },
    },
  };
}
