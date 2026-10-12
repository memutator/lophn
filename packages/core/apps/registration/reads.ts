import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import { type App, appGet, appList } from "../../../protocol/apps/mod.ts";
import type { ReadDefinition } from "../../../protocol/server/mod.ts";
import { authorizeApp } from "./model.ts";
import { loadApp, loadApps } from "./store.ts";

const PAGE = 50;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "app not found" });
}

function invalidCursor(): Result<never> {
  return err({ code: "invalid_input", message: "invalid app list cursor" });
}

const cursorSchema = z.strictObject({
  offset: z.number().int().min(0),
  status: z.enum(["active", "archived"]).nullable(),
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

// 목록 page는 같은 조건 안에서만 이어진다. 상태·limit이 다른 cursor는
// invalid_input이다. 같은 조건이면 새 snapshot의 위치 그대로 이어 본다.
export function nextAppCursor(
  offset: number,
  status: "active" | "archived" | undefined,
  limit: number,
): string {
  return btoa(JSON.stringify({
    offset,
    status: status ?? null,
    limit,
  }));
}

export function appPageOffset(
  cursor: string | undefined,
  status: "active" | "archived" | undefined,
  limit: number,
  head: number,
): Result<number> {
  if (cursor === undefined) return ok(0);
  try {
    const decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0)),
      ),
    );
    const parsed = cursorSchema.safeParse(decoded);
    if (!parsed.success) return invalidCursor();
    if (parsed.data.status !== (status ?? null)) return invalidCursor();
    if (parsed.data.limit !== limit) return invalidCursor();
    if (parsed.data.offset >= head) return invalidCursor();
    return ok(parsed.data.offset);
  } catch {
    return invalidCursor();
  }
}

export function createAppsReads(): {
  list: ReadDefinition<typeof appList>;
  get: ReadDefinition<typeof appGet>;
} {
  return {
    list: {
      route: appList,
      handle(snapshot, ctx, input) {
        const apps = loadApps(snapshot.sql, input.status);
        if (!apps.ok) return apps;
        const visible: App[] = [];
        for (const app of apps.value) {
          const access = authorizeApp(snapshot.port, ctx, appList.name, {
            kind: "app",
            app,
          });
          if (deniedByScope(access)) continue;
          if (!access.ok) return access;
          visible.push(app);
        }
        const limit = input.limit ?? PAGE;
        const head = visible.length;
        const offset = appPageOffset(input.cursor, input.status, limit, head);
        if (!offset.ok) return offset;
        const start = offset.value;
        const page = visible.slice(start, start + limit);
        const next = start + page.length;
        return ok({
          apps: page,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: next < head
            ? nextAppCursor(next, input.status, limit)
            : null,
        });
      },
    },
    get: {
      route: appGet,
      handle(snapshot, ctx, input) {
        const app = loadApp(snapshot.sql, input.app);
        if (!app.ok) return app;
        if (app.value === null) return notFound();
        const access = authorizeApp(snapshot.port, ctx, appGet.name, {
          kind: "app",
          app: app.value,
        });
        if (deniedByScope(access)) return notFound();
        if (!access.ok) return access;
        return ok({
          app: app.value,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}

// scope가 앱을 가리지 않으면 그 app은 보지 못한다. unavailable·internal은 그대로 실패다.
function deniedByScope(result: Result<unknown>): boolean {
  return !result.ok &&
    (result.error.code === "forbidden" || result.error.code === "not_found");
}
