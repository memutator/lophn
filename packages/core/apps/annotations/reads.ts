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

// 호출자가 묶인 앱. coding session은 token의 앱 하나, App Engineer는 자격 조건의 앱이다. 묶이지 않은
// 호출자(사람)는 null이다.
function boundApp(
  snapshot: ReadSnapshot,
  ctx: Pick<RequestContext, "actor" | "conditions">,
): Result<string | null> {
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
      : ok(app);
  }
  return ok(actor?.kind === "agent" ? ctx.conditions.app ?? null : null);
}

export function createAnnotationReads(): {
  get: ReadDefinition<typeof annotationsGet>;
} {
  return {
    get: {
      route: annotationsGet,
      handle(snapshot, ctx, input) {
        const bound = boundApp(snapshot, ctx);
        if (!bound.ok) return bound;
        const found = "annotation" in input
          ? foundByAnnotation(snapshot.sql, input.annotation)
          : loadBatch(snapshot.sql, input.batch);
        // 범위 밖 앱은 없는 것과 같다.
        if (
          found === null ||
          (bound.value !== null && found.batch.app !== bound.value)
        ) return notFound();
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
