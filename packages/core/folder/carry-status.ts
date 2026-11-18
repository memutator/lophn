// route `carry/status`의 handler. Settings › Sync가 읽는 지금 길이다: 컴퓨터마다 마지막으로 받은 manifest의 때와 길(받는 자리가
// 메모리에만 둔다), 앱마다 다른 기계의 변경을 마지막으로 읽은 때.
import { ok } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { ReadHandler } from "../server/mod.ts";
import { stateOf } from "./destinations.ts";
import type { FolderReplica } from "./ports.ts";

export function carryStatusHandler(deps: {
  replica: Pick<FolderReplica, "manifests">;
  /** `sync_to`가 있는 앱. */
  apps(): { app: Id<"app">; name: string; sync_to: string }[];
  /** 쓸 수 있는 같이 보는 폴더의 path. 없거나 겹치면 null. */
  shared(): string | null;
  importStatus(app: Id<"app">): { imported_at: string | null }[];
}): ReadHandler {
  return async () => {
    const manifests = await deps.replica.manifests();
    if (!manifests.ok) return manifests;
    const shared = deps.shared();
    return ok({
      shared: shared === null ? null : { path: shared, state: stateOf(shared) },
      machines: manifests.value.map((row) => ({
        machine: row.machine,
        revision: row.revision,
        received_at: row.received_at,
        via: row.via,
      })),
      apps: deps.apps().map(({ app, name, sync_to }) => ({
        app,
        name,
        sync_to,
        // 시각은 ISO(UTC) 글이라 글자 순서가 시간 순서다.
        read_at:
          deps
            .importStatus(app)
            .flatMap((row) =>
              row.imported_at === null ? [] : [row.imported_at],
            )
            .sort()
            .at(-1) ?? null,
      })),
    });
  };
}
