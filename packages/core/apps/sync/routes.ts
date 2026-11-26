// `app_sync/*` route의 core 쪽 얇은 처리기와 sync 앱 판정. 규칙은 service·snapshots에 있다.
import { ok } from "../../../base/mod.ts";
import {
  appSyncPull,
  appSyncPush,
  appSyncSnapshot,
  appSyncSnapshotFile,
} from "../../../protocol/apps/app-sync.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import {
  bytesFileStream,
  type FileStreamHandler,
  type MemoryHandler,
  type ReadHandler,
} from "../../server/mod.ts";
import { loadActiveDeclaration } from "../releases/store.ts";
import {
  type SyncPlan,
  type SyncPolicyOverride,
  syncPlanOf,
  syncsData,
} from "../../../protocol/apps/declaration/sync-plan.ts";
import type { AppSync } from "./service.ts";
import type { Snapshots } from "./snapshots.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

/** 그 release가 컴퓨터에서 sync 앱이면 선언이 정한 길(`syncPlanOf`), 아니면 null. sync log가 본다. */
export function syncPlanFor(
  sql: Pick<Sql, "get" | "all">,
  policyOf?: (app: string) => SyncPolicyOverride | undefined,
): (app: string, release: string) => SyncPlan | null {
  return (app, release) => {
    const found = loadActiveDeclaration(sql, app, release);
    if (!found.ok || found.value === null) return null;
    const plan = syncPlanOf(found.value.declaration, policyOf?.(app));
    return syncsData(plan) ? plan : null;
  };
}

/** 그 release의 선언이 `runs_on`에 phone을 가졌는가. 폰 route가 본다. */
export function phoneAppOf(
  sql: Pick<Sql, "get" | "all">,
): (app: string, release: string) => boolean {
  const planOf = syncPlanFor(sql);
  return (app, release) => planOf(app, release)?.phone ?? false;
}

export function appSyncRoutes(
  sync: AppSync,
  snapshots: Snapshots,
): {
  memory: [string, MemoryHandler][];
  reads: [string, ReadHandler][];
  files: [string, FileStreamHandler][];
} {
  return {
    memory: [
      [
        key(appSyncPush),
        (ctx, input) => sync.push(ctx.principal, input as never),
      ],
      [
        key(appSyncSnapshot),
        (ctx, input) => snapshots.take(ctx.principal, input as never),
      ],
    ],
    reads: [
      [
        key(appSyncPull),
        (ctx, input) => sync.pull(ctx.principal, input as never),
      ],
    ],
    files: [
      [
        key(appSyncSnapshotFile),
        async (ctx, input) => {
          const read = await snapshots.read(ctx.principal, input as never);
          return read.ok
            ? ok(
                bytesFileStream(
                  read.value,
                  appSyncSnapshotFile.output.contentType,
                ),
              )
            : read;
        },
      ],
    ],
  };
}
