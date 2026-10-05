// saved view ledger command. 저장·변경·삭제다. 조건은 문서 조건만 허용하고
// 정의하지 않은 조건은 input schema가 거절한다(R23). 구성 변경은 base_revision
// CAS로 기존 변경을 덮지 않는다. 삭제는 조건 행만 지우고 문서·판·Context는
// 그대로 남는다(domain-model/documents/outline-and-search).

import { err, ok, type Result } from "../../base/mod.ts";
import {
  type SavedView,
  savedViewCreated,
  savedViewDeleted,
  savedViewUpdated,
  viewDelete,
  viewSave,
  viewUpdate,
} from "../../contracts/documents/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Sql,
} from "../../contracts/platform/mod.ts";
import {
  deleteSavedView,
  insertSavedView,
  loadSavedViewRow,
  sameName,
  type SavedViewRow,
  updateSavedView,
} from "./saved-views-store.ts";

function rejected(code: string, message: string): Result<never> {
  return err({ code: code as "conflict", message });
}

function actorAllowed(
  ctx: RequestContext,
  allowed: readonly string[],
): boolean {
  // route actors가 user만이라 kind 일치 검사 하나다.
  return ctx.actor === "user" && allowed.includes("user");
}

// view의 저장 순 출력. 행을 다시 읽는다(같은 transaction의 event가 revision이다).
function viewOutput(sql: Sql, id: string): Result<SavedView> {
  const loaded = loadSavedViewRow(sql, id);
  if (!loaded.ok) return loaded;
  if (loaded.value === null) {
    return err({ code: "internal", message: "stored saved view is missing" });
  }
  return ok(viewOf(loaded.value));
}

function viewOf(row: SavedViewRow): SavedView {
  return {
    id: row.id,
    name: row.name,
    place: row.place,
    filter: row.filter,
    sort: row.sort,
    revision: row.revision,
  };
}

export function createViewCommands(): {
  save: CommandDefinition<typeof viewSave>;
  update: CommandDefinition<typeof viewUpdate>;
  delete: CommandDefinition<typeof viewDelete>;
} {
  return {
    save: {
      route: viewSave,
      handle(tx, ctx, input, compare) {
        if (!actorAllowed(ctx, viewSave.actors)) {
          return rejected("forbidden", "only user saves views");
        }
        if (Object.keys(compare).length !== 0) {
          return rejected("invalid_input", "create takes no compare fields");
        }
        const existing = loadSavedViewRow(tx.sql, input.id);
        if (!existing.ok) return existing;
        if (existing.value !== null) {
          return rejected("conflict", "saved view already exists");
        }
        if (sameName(tx.sql, input.id, input.name)) {
          return rejected("conflict", "saved view name already exists");
        }
        const seq = tx.emit(savedViewCreated, input.id, {
          name: input.name,
          place: input.place ?? null,
          filter: input.filter,
          sort: input.sort ?? "updated_desc",
        });
        insertSavedView(tx, {
          id: input.id,
          name: input.name,
          place: input.place ?? null,
          filter: input.filter,
          sort: input.sort ?? "updated_desc",
          revision: seq,
        });
        return viewOutput(tx.sql, input.id);
      },
    },
    update: {
      route: viewUpdate,
      handle(tx, ctx, input, compare) {
        if (!actorAllowed(ctx, viewUpdate.actors)) {
          return rejected("forbidden", "only user updates views");
        }
        const current = loadSavedViewRow(tx.sql, input.view);
        if (!current.ok) return current;
        if (current.value === null) {
          return rejected("not_found", "saved view not found");
        }
        if (current.value.revision !== compare.base_revision) {
          return rejected("conflict", "saved view revision changed");
        }
        // rename 충돌. 현재 이름은 자기 자신이므로 새 이름만 본다.
        if (
          input.name !== undefined && input.name !== current.value.name &&
          sameName(tx.sql, current.value.id, input.name)
        ) {
          return rejected("conflict", "saved view name already exists");
        }
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        if (input.name !== undefined) {
          before.name = current.value.name;
          after.name = input.name;
        }
        if (input.place !== undefined) {
          before.place = current.value.place;
          after.place = input.place;
        }
        if (input.filter !== undefined) {
          before.filter = current.value.filter;
          after.filter = input.filter;
        }
        if (input.sort !== undefined) {
          before.sort = current.value.sort;
          after.sort = input.sort;
        }
        const seq = tx.emit(savedViewUpdated, current.value.id, {
          before,
          after,
          before_revision: current.value.revision,
        });
        const next: SavedViewRow = {
          ...current.value,
          name: input.name ?? current.value.name,
          place: input.place !== undefined ? input.place : current.value.place,
          filter: input.filter ?? current.value.filter,
          sort: input.sort ?? current.value.sort,
          revision: seq,
        };
        updateSavedView(tx, next);
        return viewOutput(tx.sql, input.view);
      },
    },
    delete: {
      route: viewDelete,
      handle(tx, ctx, input, compare) {
        if (!actorAllowed(ctx, viewDelete.actors)) {
          return rejected("forbidden", "only user deletes views");
        }
        const current = loadSavedViewRow(tx.sql, input.view);
        if (!current.ok) return current;
        if (current.value === null) {
          return rejected("not_found", "saved view not found");
        }
        if (current.value.revision !== compare.base_revision) {
          return rejected("conflict", "saved view revision changed");
        }
        const seq = tx.emit(savedViewDeleted, current.value.id, {
          before_view: viewOf(current.value),
          before_revision: current.value.revision,
        });
        deleteSavedView(tx, current.value.id);
        return ok({
          view: current.value.id,
          revision: seq,
        } as never);
      },
    },
  };
}
