// core가 context worker에 일을 보내기 전에 읽는 내부 read(`context.work_input`). 공개 route가 아니다.
// 적용 판(또는 검사할 후보 판)의 content blob, 마지막으로 기록한 위반 수, 사람이 저장한 saved view,
// Project 폴더를 한 snapshot에서 돌려준다. worker는 ledger를 열지 않으므로 core가 이것을 IPC 요청에 싣는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  bundleContentSchema,
  type ContextWorkInput,
  contextWorkInputRoute,
} from "../../../contracts/documents/mod.ts";
import { parseActor } from "../../../contracts/platform/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
  Sql,
} from "../../../contracts/platform/mod.ts";
import type { ContextLedgerDeps } from "./adapter.ts";
import { type LoadPlan, loadState } from "./adapter-load.ts";
import { loadCheck } from "./rows.ts";

type Reader = Pick<Sql, "get" | "all">;

// documents/projects의 project_folders 표에서 등록 순서대로 읽는다.
function foldersOf(sql: Reader, project: string): string[] {
  return sql.all(
    "SELECT path FROM project_folders WHERE project = ? ORDER BY position",
    [project],
  ).map((row) => String(row.path));
}

// context.preview가 읽는 draft 판 하나. 판 하나의 content blob만 읽는다.
function draftInput(
  deps: Pick<ContextLedgerDeps, "blobs" | "index">,
  snapshot: ReadSnapshot,
  contextId: string,
  bundleId: string,
): Result<ContextWorkInput> {
  const sql = snapshot.sql;
  const loaded = loadState(sql, deps, {
    context: contextId,
    bundles: true,
    content: { bundle: bundleId },
  }, Number(snapshot.as_of_seq));
  if (!loaded.ok) return loaded;
  const { state } = loaded.value;
  const context = state.contexts.get(contextId);
  if (context === undefined) {
    return err({ code: "not_found", message: "no such context" });
  }
  const row = state.bundles.get(bundleId);
  if (row === undefined || row.context !== context.id) {
    return err({ code: "not_found", message: "no such bundle" });
  }
  if (row.status !== "draft") {
    return err({ code: "conflict", message: "the bundle is not a draft" });
  }
  const project = sql.get("SELECT status FROM projects WHERE id = ?", [
    context.project,
  ]);
  return ok({
    context: context.id,
    roots: project?.status === "archived" ? [] : foldersOf(sql, context.project),
    recorded_count: context.violation_mark,
    applied: null,
    candidate: null,
    draft: { bundle: row.id, content: row.content },
    user_saved_views: [],
    external_types: [],
    as_of_seq: snapshot.as_of_seq,
    next_cursor: null,
  });
}

export function contextWorkInputRead(
  deps: Pick<ContextLedgerDeps, "blobs" | "index">,
): ReadDefinition<typeof contextWorkInputRoute> {
  return {
    route: contextWorkInputRoute,
    handle(snapshot, ctx, input) {
      if (parseActor(ctx.actor)?.kind !== "machine") {
        return err({
          code: "forbidden",
          message: "only a machine reads the context worker input",
        });
      }
      const sql = snapshot.sql;
      if (input.bundle !== undefined) {
        if (input.check !== undefined) {
          return err({
            code: "invalid_input",
            message: "ask for a check or a bundle, not both",
          });
        }
        return draftInput(deps, snapshot, input.context, input.bundle);
      }
      const check = input.check === undefined
        ? null
        : loadCheck(sql, input.check);
      if (
        input.check !== undefined &&
        (check === null || check.context !== input.context)
      ) {
        return err({ code: "not_found", message: "no such check" });
      }
      // 검사는 후보 판 하나만, index는 적용 판 하나만 읽는다.
      const plan: LoadPlan = {
        context: input.context,
        bundles: true,
        views: check !== null,
        content: check === null ? "applied" : { bundle: check.bundle },
      };
      const loaded = loadState(sql, deps, plan, Number(snapshot.as_of_seq));
      if (!loaded.ok) return loaded;
      const { state } = loaded.value;
      const context = state.contexts.get(input.context);
      if (context === undefined) {
        return err({ code: "not_found", message: "no such context" });
      }

      let applied = null;
      if (check === null && context.status === "active") {
        const row = context.applied_bundle === null
          ? undefined
          : state.bundles.get(context.applied_bundle);
        const content = row === undefined
          ? undefined
          : bundleContentSchema.safeParse(row.content);
        if (row === undefined || !content?.success || !row.bundle_hash) {
          return err({
            code: "internal",
            message: "the applied bundle is not readable",
          });
        }
        applied = { bundle_hash: row.bundle_hash, content: content.data };
      }

      let candidate = null;
      if (check !== null && check.status === "running") {
        const row = state.bundles.get(check.bundle);
        if (row !== undefined && row.bundle_hash && row.status === "checking") {
          candidate = {
            check: check.id,
            bundle_hash: row.bundle_hash,
            content: row.content,
          };
        }
      }

      const project = sql.get("SELECT status FROM projects WHERE id = ?", [
        context.project,
      ]);
      return ok({
        context: context.id,
        // 보관된 project의 폴더는 읽지 않는다.
        roots: project?.status === "archived"
          ? []
          : foldersOf(sql, context.project),
        recorded_count: context.violation_mark,
        applied,
        candidate,
        draft: null,
        user_saved_views: [...state.views.values()]
          .filter((view) => view.context === context.id)
          .map((view) => ({
            name: view.name,
            search: view.search,
            inputs: view.inputs,
          })),
        // 다른 context의 public type을 쓰는 참조는 아직 해석하지 않는다.
        external_types: [],
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      });
    },
  };
}
