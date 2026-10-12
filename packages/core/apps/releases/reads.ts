// releases.list·get·compare(apps/releases#R1, R9–R11, R17). 불변 Release를 준비 순서로 읽고, 이전
// release와의 비교를 고정 blueprint 둘로 만든다. 범위 밖 앱의 release는 없는 것과 같다.
import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type Release,
  releasesCompare,
  releasesGet,
  releasesList,
} from "../../../protocol/apps/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import { appAccessDenied, authorizeApp, loadApp } from "../registration/mod.ts";
import { compareReleases } from "./compare.ts";
import { loadRelease, loadReleases, loadStoredBlueprint } from "./store.ts";

const PAGE = 50;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "release not found" });
}

const cursorSchema = z.strictObject({
  offset: z.number().int().min(0),
  app: z.string().nullable(),
  status: z.string().nullable(),
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

function invalidCursor(): Result<never> {
  return err({
    code: "invalid_input",
    message: "invalid release list cursor",
  });
}

function nextCursor(
  offset: number,
  input: { app?: string; status?: string },
  limit: number,
): string {
  return btoa(JSON.stringify({
    offset,
    app: input.app ?? null,
    status: input.status ?? null,
    limit,
  }));
}

function pageOffset(
  cursor: string | undefined,
  input: { app?: string; status?: string },
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
    if (parsed.data.app !== (input.app ?? null)) return invalidCursor();
    if (parsed.data.status !== (input.status ?? null)) return invalidCursor();
    if (parsed.data.limit !== limit) return invalidCursor();
    if (parsed.data.offset >= head) return invalidCursor();
    return ok(parsed.data.offset);
  } catch {
    return invalidCursor();
  }
}

// 이 release의 앱을 읽을 수 있는가. 없는 앱과 범위 밖 앱은 둘 다 false다.
function visible(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  app: string,
): Result<boolean> {
  const found = loadApp(snapshot.sql, app);
  if (!found.ok) return found;
  if (found.value === null) return ok(false);
  const access = authorizeApp(snapshot.port, ctx, operation, {
    kind: "app",
    app: found.value,
  });
  if (access.ok) return ok(true);
  return appAccessDenied(access) ? ok(false) : access;
}

export function createReleaseReads(): {
  list: ReadDefinition<typeof releasesList>;
  get: ReadDefinition<typeof releasesGet>;
  compare: ReadDefinition<typeof releasesCompare>;
} {
  return {
    list: {
      route: releasesList,
      handle(snapshot, ctx, input) {
        const all = loadReleases(snapshot.sql, {
          ...(input.app === undefined ? {} : { app: input.app }),
          ...(input.status === undefined ? {} : { status: input.status }),
        });
        if (!all.ok) return all;
        const seen = new Map<string, boolean>();
        const shown: Release[] = [];
        for (const release of all.value) {
          let allowed = seen.get(release.app);
          if (allowed === undefined) {
            const checked = visible(
              snapshot,
              ctx,
              releasesList.name,
              release.app,
            );
            if (!checked.ok) return checked;
            allowed = checked.value;
            seen.set(release.app, allowed);
          }
          if (allowed) shown.push(release);
        }
        const limit = input.limit ?? PAGE;
        const offset = pageOffset(input.cursor, input, limit, shown.length);
        if (!offset.ok) return offset;
        const page = shown.slice(offset.value, offset.value + limit);
        const next = offset.value + page.length;
        return ok({
          releases: page,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: next < shown.length
            ? nextCursor(next, input, limit)
            : null,
        });
      },
    },
    get: {
      route: releasesGet,
      handle(snapshot, ctx, input) {
        const release = loadRelease(snapshot.sql, input.release);
        if (!release.ok) return release;
        let shown: Release | null = null;
        if (release.value !== null) {
          const allowed = visible(
            snapshot,
            ctx,
            releasesGet.name,
            release.value.app,
          );
          if (!allowed.ok) return allowed;
          if (allowed.value) shown = release.value;
        }
        return ok({
          release: shown,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    compare: {
      route: releasesCompare,
      handle(snapshot, ctx, input) {
        const stored = loadStoredBlueprint(snapshot.sql, input.release);
        if (!stored.ok) return stored;
        if (stored.value === null) return notFound();
        const { release, blueprint } = stored.value;
        const allowed = visible(
          snapshot,
          ctx,
          releasesCompare.name,
          release.app,
        );
        if (!allowed.ok) return allowed;
        if (!allowed.value) return notFound();
        // 비교 대상: 명시한 같은 앱 release, 없으면 이 release 앞의 채택 참조다.
        let previousId: string | null;
        if (input.previous_release !== undefined) {
          previousId = input.previous_release;
        } else if (release.status === "active") {
          previousId = release.activation?.previous_release ?? null;
        } else {
          const active = snapshot.sql.get(
            "SELECT id FROM releases WHERE app = ? AND status = 'active'",
            [release.app],
          );
          previousId = active === undefined ? null : String(active.id);
        }
        let previous = null;
        if (previousId !== null) {
          const found = loadStoredBlueprint(snapshot.sql, previousId);
          if (!found.ok) return found;
          // 다른 앱의 release는 없는 것과 같다.
          if (found.value === null || found.value.release.app !== release.app) {
            return notFound();
          }
          previous = {
            id: found.value.release.id,
            blueprint: found.value.blueprint,
            data_schema: found.value.release.data_schema,
          };
        }
        return ok({
          comparison: compareReleases({
            previous: previous === null || previous.id === release.id
              ? null
              : previous,
            blueprint,
            data_schema: release.data_schema,
            data_changes: release.data_changes,
          }),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
