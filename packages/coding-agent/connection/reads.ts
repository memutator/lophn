import { err, ok, type Result } from "../../base/mod.ts";
import {
  type Connection,
  connectionList,
  connectionShow,
} from "../../protocol/coding-agent/mod.ts";
import {
  parseActor,
  type ReadDefinition,
  type RequestContext,
} from "../../protocol/server/mod.ts";
import { nextConnectionCursor, pageAfter } from "./cursor.ts";
import { publicConnection } from "./rows.ts";
import { listConnections, loadConnection } from "./store.ts";

const PAGE = 50;

function forbidden(): Result<never> {
  return err({ code: "forbidden", message: "connection read is not allowed" });
}

function notFound(): Result<never> {
  return err({ code: "not_found", message: "connection not found" });
}

// user는 전체 목록. coding_agent는 자기 principal만. label·작업 폴더는 범위를 넓히지 않는다.
function visible(
  ctx: RequestContext,
  connections: readonly Connection[],
): Result<Connection[]> {
  const actor = parseActor(ctx.actor);
  if (actor?.kind === "user") return ok([...connections]);
  if (actor?.kind === "coding_agent") {
    return ok(
      connections.filter((connection) =>
        connection.principal === ctx.principal
      ),
    );
  }
  return forbidden();
}

export function createConnectionReads(): {
  list: ReadDefinition<typeof connectionList>;
  show: ReadDefinition<typeof connectionShow>;
} {
  return {
    list: {
      route: connectionList,
      handle(snapshot, ctx, input) {
        const scopeKind = input.scope?.kind;
        const scopeApp = input.scope?.kind === "app"
          ? input.scope.app
          : input.scope
          ? null
          : undefined;
        const loaded = listConnections(snapshot.sql, {
          state: input.state,
          scope_kind: scopeKind,
          scope_app: scopeApp,
        });
        if (!loaded.ok) return loaded;
        const allowed = visible(ctx, loaded.value);
        if (!allowed.ok) return allowed;
        const after = pageAfter(input.cursor, {
          state: input.state ?? null,
          scope_kind: scopeKind ?? null,
          scope_app: input.scope?.kind === "app" ? input.scope.app : null,
          principal: ctx.principal,
          actor: ctx.actor,
          credential: ctx.credential_ref,
        });
        if (!after.ok) return after;
        const start = after.value === null
          ? 0
          : allowed.value.findIndex((item) => item.id === after.value) + 1;
        if (after.value !== null && start === 0) {
          return err({
            code: "invalid_input",
            message: "invalid connection cursor",
          });
        }
        const page = allowed.value.slice(start, start + PAGE);
        const next = start + page.length;
        return ok({
          connections: page.map(publicConnection),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: next < allowed.value.length
            ? nextConnectionCursor(page[page.length - 1]!.id, {
              state: input.state ?? null,
              scope_kind: scopeKind ?? null,
              scope_app: input.scope?.kind === "app" ? input.scope.app : null,
              principal: ctx.principal,
              actor: ctx.actor,
              credential: ctx.credential_ref,
            })
            : null,
        });
      },
    },
    show: {
      route: connectionShow,
      handle(snapshot, ctx, input) {
        const loaded = loadConnection(snapshot.sql, input.connection);
        if (!loaded.ok) return loaded;
        if (loaded.value === null) return notFound();
        const allowed = visible(ctx, [loaded.value]);
        if (!allowed.ok) return allowed;
        if (allowed.value.length === 0) return notFound();
        return ok({
          connection: publicConnection(allowed.value[0]!),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
