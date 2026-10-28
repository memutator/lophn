// annotations.get. 읽는 쪽 값에 screenshot_path(blob object 파일 경로)를 싣는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  annotationsGet,
  type AnnotationTarget,
} from "../../../protocol/apps/annotation.ts";
import { domainLookupPort } from "../../../protocol/domains/mod.ts";
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

// 호출자 범위. 사람과 machine은 전체(null)이고, agent는 자격 조건의 앱(앱 place session)이나
// project(project place session)다. 조건에 앱도 project도 없는 agent(home session(lophn 등))와 그 밖의 actor는 읽을 수 없다.
type Scope = { app?: string; project?: string } | null;

function callerScope(
  ctx: Pick<RequestContext, "actor" | "conditions">,
): Result<Scope> {
  const actor = parseActor(ctx.actor);
  if (actor?.kind === "user" || actor?.kind === "machine") return ok(null);
  if (actor?.kind !== "agent") {
    return err({
      code: "forbidden",
      message: "annotation is not readable for this actor",
    });
  }
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
// 자기 앱인 범위만 읽는다(받는 쪽이 그 owner place의 session이라서다).
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
      return (
        owner !== undefined &&
        (owner.kind === "project"
          ? scope.project === owner.id
          : scope.app === owner.id)
      );
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
        const scope = callerScope(ctx);
        if (!scope.ok) return scope;
        const found =
          "annotation" in input
            ? foundByAnnotation(snapshot.sql, input.annotation)
            : loadBatch(snapshot.sql, input.batch);
        // 범위 밖 target은 묶인 호출자에게 없는 것과 같다.
        if (
          found === null ||
          !inScope(snapshot, scope.value, found.batch.target)
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
