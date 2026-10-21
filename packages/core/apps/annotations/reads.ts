// annotations.get. 읽는 쪽 값에 screenshot_path(blob object 파일 경로)를 싣는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  annotationsGet,
  type AnnotationTarget,
} from "../../../protocol/apps/annotation.ts";
import { domainLookupPort } from "../../../protocol/domains/mod.ts";
import { CodingSessionLookup } from "../../../protocol/coding-agent/token.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
  Sql,
} from "../../../protocol/server/mod.ts";
import { loadAnnotations, loadBatch } from "./store.ts";

type Query = Pick<Sql, "get" | "all">;

const notFound = () =>
  err({ code: "not_found" as const, message: "annotation does not exist" });

// 호출자 범위. coding session은 token의 앱 하나, agent는 자격 조건의 앱(앱 place의 App Engineer·Operator)이나
// project(프로젝트 place의 PM·Operator), 사람과 machine은 전체(null)다. 앱도 project도 조건에 없는 agent(lophn)는
// 읽을 수 없다.
type Scope = { app?: string; project?: string } | null;

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
  if (app !== undefined || project !== undefined) {
    return ok({
      ...(app !== undefined && { app }),
      ...(project !== undefined && { project }),
    });
  }
  return err({
    code: "forbidden",
    message: "annotation is not readable without an app or project",
  });
}

// app target은 그 앱 범위만, file target은 그 project 범위만, artifact target은 그 domain의 owner가 자기 project나
// 자기 앱인 범위만 읽는다(받는 쪽이 그 owner의 PM이나 App Engineer라서다).
function inScope(
  snapshot: ReadSnapshot,
  scope: Scope,
  target: AnnotationTarget,
): boolean {
  if (scope === null) return true;
  switch (target.kind) {
    case "app":
      return scope.app !== undefined && target.app === scope.app;
    case "file":
      return scope.project !== undefined && target.project === scope.project;
    case "artifact": {
      const owner = snapshot.port(domainLookupPort).get(target.domain)?.owner;
      return owner !== undefined &&
        (owner.kind === "project"
          ? scope.project === owner.id
          : scope.app === owner.id);
    }
  }
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
        if (
          found === null || !inScope(snapshot, scope.value, found.batch.target)
        ) {
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
