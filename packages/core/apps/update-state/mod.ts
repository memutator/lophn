// `apps/update_state`의 읽기. 따라가기(core/apps/follow)와 폴더 읽기(core/folder/import)의 메모리 값, 기록 사본, 이 기계의
// release 행을 모은다. 폴더 wiring이 그 둘을 만들어 넘긴다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { UpdateState } from "../../../protocol/apps/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { FolderExchange, KnownRecords } from "../../folder/import/mod.ts";
import type { Follow } from "../follow/mod.ts";
import { loadReleases } from "../releases/store.ts";
import { buildUpdateState } from "./read.ts";

export type UpdateStateDeps = {
  machine(): Id<"mch">;
  /** 이 기계에서 폴더로 맞추는 앱(sync_to가 있다)과 그 활성 release. */
  syncApps(): readonly {
    app: Id<"app">;
    release: {
      code_commit: string;
      data_schema: number;
    } | null;
  }[];
  follow: Pick<Follow, "state">;
  exchange: Pick<FolderExchange, "machines" | "held" | "recorded">;
  records(): KnownRecords;
  sql: Pick<Sql, "get" | "all">;
};

export function readUpdateState(
  deps: UpdateStateDeps,
  app: Id<"app">,
): Result<UpdateState> {
  const local = deps.syncApps().find((each) => each.app === app);
  if (local === undefined) {
    return err({
      code: "not_found",
      message: "this app is not synced through a folder on this machine",
    });
  }
  const releases = loadReleases(deps.sql, { app });
  if (!releases.ok) return releases;
  return ok(
    buildUpdateState({
      app,
      me: deps.machine(),
      current: local.release,
      follow: deps.follow.state(app),
      held: deps.exchange.held(app),
      machines: deps.exchange.machines(),
      offered: deps
        .records()
        .apps.filter((row) => row.app === app)
        .map((row) => ({
          machine: row.machine,
          release: row.record.active_release,
        })),
      recorded: deps.exchange.recorded(),
      releases: releases.value,
    }),
  );
}
