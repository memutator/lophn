// pdf·docs 파일의 저장 목차(`outline.get`·`outline.set`·`outline.delete`). md 목차는 파일에서 바로 읽는다.
// 목차는 lophn data의 그 context 폴더 아래 `outlines/<파일 경로 hash>.json` 한 파일씩 둔다. 파일 하나의
// 목차 전체가 개체 하나라 set은 entries를 통째로 바꾼다. revision은 이 파일의 고침 횟수이고 event는 없다.
// 원본 파일이 바뀌어도 낡음을 감지하지 않는다: 다시 만드는 계기는 사람의 요청이다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type ContextOutline,
  contextOutlineSchema,
  outlineDelete,
  outlineGet,
  outlineSet,
} from "../../../protocol/projects/mod.ts";
import type {
  CommandDefinition,
  ReadDefinition,
  ReadSnapshot,
  Tx,
} from "../../../protocol/server/mod.ts";
import {
  contextAuthorityPort,
  type ContextLedgerDeps,
  mapActor,
} from "./ledger/adapter.ts";
import { authorizeRead, denyCommand, isAppBound } from "./ledger/app-bound.ts";
import { loadContext } from "./ledger/rows.ts";

type Stored = { revision: string; outline: ContextOutline };
type Deps = Pick<ContextLedgerDeps, "folders" | "files" | "hash" | "appIds">;

function pathOf(
  deps: Deps,
  sql: ReadSnapshot["sql"],
  context: string,
  path: string,
): Result<{ project: string; file: string }> {
  const found = loadContext(sql, context);
  if (found === null) {
    return err({ code: "not_found", message: "no such context" });
  }
  const folder = deps.folders.outlineFolder(found.project, found.id);
  return ok({
    project: found.project,
    file: `${folder}/${deps.hash(path)}.json`,
  });
}

// 저장된 목차. 없으면 null이다.
function load(deps: Deps, file: string): Result<Stored | null> {
  const read = deps.files.read(file);
  if (!read.ok) return read;
  if (read.value === null) return ok(null);
  const stored = read.value as Partial<Stored>;
  const outline = contextOutlineSchema.safeParse(stored.outline);
  if (!outline.success || typeof stored.revision !== "string") {
    return err({ code: "internal", message: "the stored outline is broken" });
  }
  return ok({ revision: stored.revision, outline: outline.data });
}

const record = (context: string, stored: Stored) => ({
  context,
  ...stored.outline,
  revision: stored.revision,
});

export function contextOutlineReads(
  deps: Deps,
): ReadDefinition<typeof outlineGet>[] {
  return [{
    route: outlineGet,
    handle(snapshot, ctx, input) {
      // 앱 하나에 묶인 agent에게는 열리지 않는다(없는 대상과 같은 답).
      if (isAppBound(ctx)) {
        const denied = authorizeRead(
          snapshot,
          deps,
          ctx,
          outlineGet.name,
          input.context,
        );
        if (!denied.ok) return denied;
      }
      const actor = mapActor(ctx);
      if (!actor.ok) return actor;
      if (actor.value.kind !== "user" && actor.value.kind !== "agent") {
        return err({
          code: "forbidden",
          message: "actor cannot read outlines",
        });
      }
      const at = pathOf(deps, snapshot.sql, input.context, input.path);
      if (!at.ok) return at;
      const stored = load(deps, at.value.file);
      if (!stored.ok) return stored;
      return ok({
        outline: stored.value === null
          ? null
          : record(input.context, stored.value),
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      });
    },
  }];
}

export function contextOutlineCommands(deps: Deps): CommandDefinition[] {
  // 쓰는 쪽 검사와 목차 위치: 그 project의 Project Manager(또는 사람)만 쓴다.
  const target = (
    tx: Tx,
    ctx: Parameters<CommandDefinition["handle"]>[1],
    operation: string,
    context: string,
    path: string,
  ): Result<{ file: string }> => {
    if (isAppBound(ctx)) {
      const denied = denyCommand(tx, ctx, operation);
      if (!denied.ok) return denied;
    }
    const actor = mapActor(ctx);
    if (!actor.ok) return actor;
    const at = pathOf(deps, tx.sql, context, path);
    if (!at.ok) return at;
    const allowed = actor.value.kind === "user" ||
      (actor.value.kind === "agent" &&
        tx.port(contextAuthorityPort).canWrite(
          actor.value.actor,
          at.value.project,
        ));
    if (!allowed) {
      return err({ code: "forbidden", message: "cannot write this context" });
    }
    return ok({ file: at.value.file });
  };

  const set: CommandDefinition<typeof outlineSet> = {
    route: outlineSet,
    handle(tx, ctx, input, compare) {
      const at = target(tx, ctx, outlineSet.name, input.context, input.path);
      if (!at.ok) return at;
      const current = load(deps, at.value.file);
      if (!current.ok) return current;
      if (current.value === null) {
        if (compare.base_revision !== undefined) {
          return err({
            code: "invalid_input",
            message: "a new outline takes no base_revision",
          });
        }
      } else if (compare.base_revision !== current.value.revision) {
        return err({
          code: "conflict",
          message: "the outline changed since base_revision",
        });
      }
      const outline = contextOutlineSchema.parse({
        path: input.path,
        format: input.format,
        entries: input.entries,
      });
      const next: Stored = {
        revision: String(Number(current.value?.revision ?? "0") + 1),
        outline,
      };
      deps.files.write(at.value.file, next);
      return ok(record(input.context, next));
    },
  };

  const remove: CommandDefinition<typeof outlineDelete> = {
    route: outlineDelete,
    handle(tx, ctx, input, compare) {
      const at = target(tx, ctx, outlineDelete.name, input.context, input.path);
      if (!at.ok) return at;
      const current = load(deps, at.value.file);
      if (!current.ok) return current;
      if (current.value === null) {
        return err({ code: "not_found", message: "no such outline" });
      }
      if (
        compare.base_revision !== undefined &&
        compare.base_revision !== current.value.revision
      ) {
        return err({
          code: "conflict",
          message: "the outline changed since base_revision",
        });
      }
      deps.files.remove(at.value.file);
      return ok({ context: input.context, path: input.path });
    },
  };

  return [set, remove] as CommandDefinition[];
}
