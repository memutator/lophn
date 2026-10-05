// saved view read. list·get은 ledger metadata만 준다(R23의 읽기 반쪽). 결과를
// ledger에 쓰지 않는다. open은 worker 경로라 saved-views-open.ts에 둔다. 이 파일은
// adapter·consumer chain을 데려가지 않는다(core도 이 표면으로 등록한다).

import { err, ok, type Result } from "../../base/mod.ts";
import {
  type SavedView,
  viewGet,
  viewList,
} from "../../contracts/documents/mod.ts";
import type {
  ReadDefinition,
  RequestContext,
} from "../../contracts/platform/mod.ts";
import { TargetAuthorization } from "../../contracts/platform/mod.ts";
import type { SearchSnapshot } from "./types.ts";
import {
  listSavedViews,
  loadSavedViewRow,
  type SavedViewRow,
} from "./saved-views-store.ts";

const PAGE = 50;

function rejected(code: string, message: string): Result<never> {
  return err({ code: code as "not_found", message });
}

function readActorAllowed(ctx: RequestContext, allowed: readonly string[]) {
  const kind = ctx.actor.split(":")[0];
  return allowed.includes(kind);
}

// ledger list·get cursor. pagination window의 숫자 offset이다.
function offsetOf(cursor: string | undefined): Result<number> {
  if (cursor === undefined) return ok(0);
  if (!/^[0-9]+$/.test(cursor)) {
    return rejected("invalid_input", "cursor is invalid");
  }
  const value = Number(cursor);
  if (!Number.isSafeInteger(value)) {
    return rejected("invalid_input", "cursor is invalid");
  }
  return ok(value);
}

// 대상 범위는 platform이 주입한 TargetAuthorization port가 판정한다. forbidden은
// 존재를 새지 않는다(list는 건너뛰고 get은 not_found다). dispatch가 주는 read
// snapshot에 port가 있다(contexts/reads와 같은 cast다).
function allowed(
  snapshot: SearchSnapshot,
  ctx: RequestContext,
  operation: string,
): Result<boolean> {
  try {
    const ported = snapshot as SearchSnapshot & {
      port?: (key: unknown) => unknown;
    };
    if (typeof ported.port !== "function") return ok(true);
    const authorize = ported.port(TargetAuthorization) as unknown as (
      ctx: RequestContext,
      operation: string,
      target: Record<string, unknown>,
    ) => Result<undefined>;
    if (authorize instanceof Promise) return ok(false);
    const decision = authorize(ctx, operation, {});
    if (!decision.ok) {
      return decision.error.code === "forbidden" ||
          decision.error.code === "not_found"
        ? ok(false)
        : decision;
    }
    return ok(true);
  } catch {
    return ok(false);
  }
}

export function createViewReads(): {
  list: ReadDefinition<typeof viewList>;
  get: ReadDefinition<typeof viewGet>;
} {
  return {
    list: {
      route: viewList,
      handle(snapshot, ctx, input) {
        if (!readActorAllowed(ctx, viewList.actors)) {
          return rejected("forbidden", "actor cannot read views");
        }
        const scope = allowed(snapshot as never, ctx, viewList.name);
        if (!scope.ok) return scope;
        if (!scope.value) {
          return ok({
            views: [],
            complete: true,
            as_of_seq: snapshot.as_of_seq,
            next_cursor: null,
          } as never);
        }
        const limit = PAGE;
        const offset = offsetOf(input.cursor);
        if (!offset.ok) return offset;
        const listed = listSavedViews(snapshot.sql as never, {
          limit,
          offset: offset.value,
        });
        if (!listed.ok) return listed;
        return ok({
          views: listed.value.views,
          complete: listed.value.complete,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: listed.value.complete
            ? null
            : String(offset.value + limit),
        } as never);
      },
    },
    get: {
      route: viewGet,
      handle(snapshot, ctx, input) {
        if (!readActorAllowed(ctx, viewGet.actors)) {
          return rejected("forbidden", "actor cannot read views");
        }
        const scope = allowed(snapshot as never, ctx, viewGet.name);
        if (!scope.ok) return scope;
        if (!scope.value) {
          return rejected("not_found", "saved view not found");
        }
        const loaded = loadSavedViewRow(snapshot.sql as never, input.view);
        if (!loaded.ok) return loaded;
        if (loaded.value === null) {
          return rejected("not_found", "saved view not found");
        }
        return ok({
          view: viewOfRow(loaded.value),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        } as never);
      },
    },
  };
}

function viewOfRow(row: SavedViewRow): SavedView {
  return {
    id: row.id,
    name: row.name,
    place: row.place,
    filter: row.filter,
    sort: row.sort,
    revision: row.revision,
  };
}
