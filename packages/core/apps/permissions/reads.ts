import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type Grant,
  GRANT_STATES,
  grantsList,
} from "../../../protocol/apps/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import { appAccessDenied, authorizeApp, loadApp } from "../registration/mod.ts";
import { declarationsAt } from "./declarations.ts";
import { buildGrantDisplay } from "./display.ts";
import type { ResolvedRequirement } from "./model.ts";
import { grantsSeq, loadGrants } from "./store.ts";

const PAGE = 50;

function invalidCursor(): Result<never> {
  return err({
    code: "invalid_input",
    message: "invalid grant list cursor",
  });
}

const cursorSchema = z.strictObject({
  offset: z.number().int().min(0),
  app: z.string().nullable(),
  status: z.enum(GRANT_STATES).nullable(),
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

// 목록 page는 같은 조건 안에서만 이어진다. app·status·limit이 다른 cursor는 invalid_input이다.
export function nextGrantCursor(
  offset: number,
  app: string | undefined,
  status: Grant["status"] | undefined,
  limit: number,
): string {
  return btoa(JSON.stringify({
    offset,
    app: app ?? null,
    status: status ?? null,
    limit,
  }));
}

export function grantPageOffset(
  cursor: string | undefined,
  app: string | undefined,
  status: Grant["status"] | undefined,
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
    if (parsed.data.app !== (app ?? null)) return invalidCursor();
    if (parsed.data.status !== (status ?? null)) return invalidCursor();
    if (parsed.data.limit !== limit) return invalidCursor();
    if (parsed.data.offset >= head) return invalidCursor();
    return ok(parsed.data.offset);
  } catch {
    return invalidCursor();
  }
}

// 범위 밖 앱의 grant는 없는 것과 같다. unavailable·internal은 그대로 실패다.
function visible(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  app: string,
): Result<boolean> {
  const found = loadApp(snapshot.sql, app);
  if (!found.ok) return found;
  if (found.value === null) return ok(false);
  const access = authorizeApp(snapshot.port, ctx, grantsList.name, {
    kind: "app",
    app: found.value,
  });
  if (access.ok) return ok(true);
  return appAccessDenied(access) ? ok(false) : access;
}

// 선언한 요구를 표시 자료의 입력으로 바꾼다. read는 파일 I/O를 하지 않으므로 폴더 밖 link는
// 검사하지 않는다(outsideLinks는 부여 준비가 채운다).
function resolvedOf(
  requirement: {
    kind: ResolvedRequirement["kind"];
    scope: Record<string, unknown>;
    reason: string;
  },
): ResolvedRequirement {
  if (requirement.kind === "fs.read" || requirement.kind === "fs.write") {
    return {
      kind: requirement.kind,
      scope: {
        path: String(requirement.scope.path),
        recursive: requirement.scope.recursive === true,
        outsideLinks: [],
      },
      reason: requirement.reason,
    };
  }
  return requirement as ResolvedRequirement;
}

export function createGrantsReads(): {
  list: ReadDefinition<typeof grantsList>;
} {
  return {
    list: {
      route: grantsList,
      handle(snapshot, ctx, input) {
        // 앱을 지정했는데 없거나 범위 밖이면 not_found다. grant가 없는 보이는 앱은 빈 목록이다.
        const seen = new Map<string, boolean>();
        const check = (app: string): Result<boolean> => {
          const known = seen.get(app);
          if (known !== undefined) return ok(known);
          const checked = visible(snapshot, ctx, app);
          if (checked.ok) seen.set(app, checked.value);
          return checked;
        };
        if (input.app !== undefined) {
          const checked = check(input.app);
          if (!checked.ok) return checked;
          if (!checked.value) {
            return err({ code: "not_found", message: "app not found" });
          }
        }
        const loaded = loadGrants(snapshot.sql, {
          app: input.app,
          status: input.status,
        });
        if (!loaded.ok) return loaded;
        const grants: Grant[] = [];
        for (const grant of loaded.value) {
          const checked = check(grant.app);
          if (!checked.ok) return checked;
          if (checked.value) grants.push(grant);
        }
        const limit = input.limit ?? PAGE;
        const head = grants.length;
        const offset = grantPageOffset(
          input.cursor,
          input.app,
          input.status,
          limit,
          head,
        );
        if (!offset.ok) return offset;
        const start = offset.value;
        const page = grants.slice(start, start + limit);
        const next = start + page.length;
        // 표시 자료는 앱을 지정했고 현재 release의 선언을 알 때만 있다.
        let display = null;
        if (input.app !== undefined) {
          const declared = declarationsAt(snapshot, input.app);
          if (!declared.ok) return declared;
          const active = loadGrants(snapshot.sql, {
            app: input.app,
            status: "active",
          });
          if (!active.ok) return active;
          if (declared.value !== null) {
            display = buildGrantDisplay({
              app: input.app,
              release: declared.value.release,
              requirements: declared.value.permissions.map((requirement) =>
                resolvedOf({
                  kind: requirement.kind,
                  scope: requirement.scope as Record<string, unknown>,
                  reason: requirement.reason,
                })
              ),
              grants: active.value,
            });
          }
        }
        return ok({
          grants: page,
          ...(input.app === undefined
            ? {}
            : { grants_seq: grantsSeq(snapshot.sql, input.app) }),
          display,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: next < head
            ? nextGrantCursor(next, input.app, input.status, limit)
            : null,
        });
      },
    },
  };
}
