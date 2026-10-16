// core가 context worker에 일을 보내기 전에 읽는 내부 read(`context.work_input`). 공개 route가 아니다.
// 적용 판(또는 검사할 후보 판)의 content blob, 마지막으로 기록한 위반 수, 사람이 저장한 saved view,
// Project 폴더를 한 snapshot에서 돌려준다. worker는 ledger를 열지 않으므로 core가 이것을 IPC 요청에 싣는다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  bundleContentSchema,
  type ContextWorkInput,
  contextWorkInputRoute,
  contextWorkListRoute,
} from "../../../../protocol/projects/mod.ts";
import { parseActor } from "../../../../protocol/base/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
  Sql,
} from "../../../../protocol/server/mod.ts";
import { createContextDrafts } from "../folders.ts";
import type { ContextLedgerDeps } from "./adapter.ts";
import { type LoadPlan, loadState } from "./adapter-load.ts";
import { loadCheck } from "./rows.ts";
import { appCommandsOf, externalTypesRead } from "./work-environment.ts";

type Reader = Pick<Sql, "get" | "all">;
type Deps =
  & Pick<ContextLedgerDeps, "blobs" | "index" | "folders" | "files">
  & Partial<Pick<ContextLedgerDeps, "appCommandEffect">>;

// documents/projects의 project_folders 표에서 등록 순서대로 읽는다.
function foldersOf(sql: Reader, project: string): string[] {
  return sql.all(
    "SELECT path FROM project_folders WHERE project = ? ORDER BY position",
    [project],
  ).map((row) => String(row.path));
}

// bundle.test_draft와 context.preview가 읽는 draft 판 하나. 내용은 초안 폴더의 bundle.json이다.
function draftInput(
  deps: Deps,
  snapshot: ReadSnapshot,
  contextId: string,
  bundleId: string,
): Result<ContextWorkInput> {
  const sql = snapshot.sql;
  const loaded = loadState(sql, deps, {
    context: contextId,
    bundles: true,
    views: true,
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
  const file = createContextDrafts(deps.folders, deps.files).read(
    context.project,
    context.id,
    row.id,
  );
  if (!file.ok) return file;
  if (
    typeof file.value !== "object" || file.value === null ||
    Array.isArray(file.value)
  ) {
    return err({
      code: "invalid_input",
      message: "bundle.json is not a JSON object",
    });
  }
  const content = file.value as Record<string, unknown>;
  const project = sql.get("SELECT status FROM projects WHERE id = ?", [
    context.project,
  ]);
  const external = externalTypesRead(sql, deps, context);
  if (!external.ok) return external;
  return ok({
    context: context.id,
    roots: project?.status === "archived"
      ? []
      : foldersOf(sql, context.project),
    recorded_count: context.violation_mark,
    applied: null,
    candidate: null,
    draft: { bundle: row.id, content },
    user_saved_views: [...state.views.values()].map((view) => ({
      name: view.name,
      search: view.search,
      inputs: view.inputs,
    })),
    external_types: external.value,
    app_commands: appCommandsOf(content, deps.appCommandEffect),
    as_of_seq: snapshot.as_of_seq,
    next_cursor: null,
  });
}

export function contextWorkInputRead(
  deps: Deps,
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
      // 검사할 판이 있을 때만 환경을 싣는다. 적용 판만 묻는 입력(index)은 쓰지 않는다.
      let external_types: ContextWorkInput["external_types"] = [];
      if (candidate !== null) {
        const read = externalTypesRead(sql, deps, context);
        if (!read.ok) return read;
        external_types = read.value;
      }
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
        external_types,
        app_commands: candidate === null
          ? []
          : appCommandsOf(candidate.content, deps.appCommandEffect),
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      });
    },
  };
}

// core가 시작할 때와 변화 감시가 감시 집합을 정할 때 읽는 목록(`context.work_list`). 활성 context와 도는
// 검사만 담고 blob은 열지 않는다. 폴더는 project마다 한 번 읽는다.
export function contextWorkListRead(): ReadDefinition<
  typeof contextWorkListRoute
> {
  return {
    route: contextWorkListRoute,
    handle(snapshot, ctx) {
      if (parseActor(ctx.actor)?.kind !== "machine") {
        return err({
          code: "forbidden",
          message: "only a machine reads the context work list",
        });
      }
      const sql = snapshot.sql;
      const folders = new Map<string, string[]>();
      const rootsOf = (project: string, archived = false): string[] => {
        if (archived) return [];
        let roots = folders.get(project);
        if (roots === undefined) {
          roots = foldersOf(sql, project);
          folders.set(project, roots);
        }
        return roots;
      };
      const contexts = sql.all(
        `SELECT c.id AS context, c.project AS project, b.bundle_hash AS bundle_hash
           FROM contexts c
           JOIN context_bundles b ON b.id = c.applied_bundle
           JOIN projects p ON p.id = c.project
          WHERE c.status = 'active' AND p.status <> 'archived'
            AND b.bundle_hash IS NOT NULL
          ORDER BY c.id`,
        [],
      ).map((row) => ({
        context: String(row.context),
        roots: rootsOf(String(row.project)),
        bundle_hash: String(row.bundle_hash),
      }));
      const checks = sql.all(
        `SELECT k.id AS "check", k.context AS context, c.project AS project,
                p.status AS project_status
           FROM context_checks k
           JOIN context_bundles b ON b.id = k.bundle
           JOIN contexts c ON c.id = k.context
           JOIN projects p ON p.id = c.project
          WHERE k.status = 'running' AND b.status = 'checking'
          ORDER BY k.started_at, k.id`,
        [],
      ).map((row) => ({
        context: String(row.context),
        check: String(row.check),
        roots: rootsOf(String(row.project), row.project_status === "archived"),
      }));
      return ok({
        contexts,
        checks,
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      });
    },
  };
}
