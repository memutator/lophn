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
import { runsOnPhone } from "../runtime/entrypoint/sync.ts";
import type { AppSync } from "./service.ts";
import type { Snapshots } from "./snapshots.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

/** 그 release의 선언이 `runs_on`에 phone을 가졌는가. */
export function syncAppOf(
  sql: Pick<Sql, "get" | "all">,
): (app: string, release: string) => boolean {
  return (app, release) => {
    const found = loadActiveDeclaration(sql, app, release);
    return (
      found.ok && found.value !== null && runsOnPhone(found.value.declaration)
    );
  };
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
