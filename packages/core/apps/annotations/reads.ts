// annotations.get과 ticket 근거를 읽는 AnnotationLookup. 읽는 쪽 값에 screenshot_path(blob object 파일 경로)를 싣는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { annotationsGet } from "../../../protocol/apps/annotation.ts";
import { CodingSessionLookup } from "../../../protocol/coding-agent/token.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
  Sql,
} from "../../../protocol/server/mod.ts";
import type { AnnotationLookup } from "./ports.ts";
import { loadAnnotations, loadBatch } from "./store.ts";

type Query = Pick<Sql, "get" | "all">;

const notFound = () =>
  err({ code: "not_found" as const, message: "annotation does not exist" });

// 호출자 범위. coding session은 token의 앱 하나, agent는 자격 조건의 앱 또는 project 하나, 사람과 machine은
// 전체(null)다. 앱도 project도 조건에 없는 agent(lophn)는 읽을 수 없다.
type Scope = { app: string } | { project: string } | null;

function callerScope(
  snapshot: ReadSnapshot,
  ctx: Pick<RequestContext, "actor" | "conditions">,
): Result<Scope> {
  const actor = parseActor(ctx.actor);
  if (actor?.kind === "coding_agent") {
    let app: string | null;
    try {
      app = snapshot.port(CodingSessionLookup).appOf(actor.id);
    } catch {
      return err({
        code: "unavailable",
        message: "coding session lookup is not available",
      });
    }
    return app === null
      ? err({ code: "forbidden", message: "unknown coding session" })
      : ok({ app });
  }
  if (actor?.kind !== "agent") return ok(null);
  const { app, project } = ctx.conditions;
  if (app !== undefined) return ok({ app });
  if (project !== undefined) return ok({ project });
  return err({
    code: "forbidden",
    message: "annotation is not readable without an app or project",
  });
}

function inScope(
  scope: Scope,
  target: { kind: string; app?: string; project?: string },
): boolean {
  if (scope === null) return true;
  return "app" in scope
    ? target.kind === "app" && target.app === scope.app
    : target.kind === "artifact" && target.project === scope.project;
}

export function createAnnotationReads(): {
  get: ReadDefinition<typeof annotationsGet>;
} {
  return {
    get: {
      route: annotationsGet,
      handle(snapshot, ctx, input) {
        const scope = callerScope(snapshot, ctx);
        if (!scope.ok) return scope;
        const found = "annotation" in input
          ? foundByAnnotation(snapshot.sql, input.annotation)
          : loadBatch(snapshot.sql, input.batch);
        // 범위 밖 target은 묶인 호출자에게 없는 것과 같다.
        if (found === null || !inScope(scope.value, found.batch.target)) {
          return notFound();
        }
        return ok({
          ...found,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        } as never);
      },
    },
  };
}

function foundByAnnotation(sql: Query, id: string) {
  const [annotation] = loadAnnotations(sql, [id]);
  if (annotation === undefined) return null;
  const batch = loadBatch(sql, annotation.batch);
  return batch === null
    ? null
    : { batch: batch.batch, annotations: [annotation] };
}

// ticket.show가 근거 annotation을 값으로 풀 때 읽는다.
export function annotationLookup(sql: Query): AnnotationLookup {
  return { byIds: (ids) => ok(loadAnnotations(sql, ids)) };
}
