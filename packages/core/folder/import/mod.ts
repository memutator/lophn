// 다른 기계의 하위 폴더를 읽는다: 기계·앱 기록의 사본(scan)과, `sync_to`가 있는 앱마다 출처 기계의 data stream
// 따라잡기(runApp). 계기(감시, timer)와 조립은 folder-surface가 한다.
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { machineDir } from "../../../protocol/folder/mod.ts";
import { createFolderReader } from "../fs.ts";
import { type FolderImportDeps, isForgotten, loadRecords } from "./deps.ts";
import { IMPORT_TMP_DIR, removeAppFiles } from "./held.ts";
import { type ScanOutcome, scan } from "./scan.ts";
import {
  type ImportStatus,
  type KnownRecords,
  peerHorizons,
  readsCaughtUp,
  records,
  status,
} from "./status.ts";
import { followStream, type StreamOutcome } from "./stream.ts";

export type { FolderImportDeps, ImportApp } from "./deps.ts";
export type { ImportStatus, KnownRecords, ScanOutcome, StreamOutcome };

export type ImportOutcome = {
  /** 이미 그 앱의 읽기가 돌고 있어 이번에는 하지 않았다. */
  busy: boolean;
  streams: StreamOutcome[];
};

export type FolderImport = {
  scan(): Promise<Result<ScanOutcome>>;
  runApp(app: Id<"app">): Promise<Result<ImportOutcome>>;
  forgetMachine(origin: Id<"mch">): Result<void>;
  isForgotten(origin: Id<"mch">): boolean;
  readsCaughtUp(app: Id<"app">): boolean;
  peerHorizons(
    app: Id<"app">,
  ): { machine: Id<"mch">; settled: string | null; horizon: string | null }[];
  status(app: Id<"app">): ImportStatus[];
  records(): KnownRecords;
  forget(app: Id<"app">): Promise<Result<void>>;
};

export function createFolderImport(deps: FolderImportDeps): FolderImport {
  // (앱, 출처 기계)마다 한 번에 하나. 앱 단위로 묶는다.
  const running = new Set<Id<"app">>();
  // scan이 본 출처 기계의 `newer_format`. 그 기계의 data는 읽지 않는다.
  const blocked = new Map<Id<"mch">, ScanOutcome["errors"][number]["error"]>();

  const runApp = async (app: Id<"app">): Promise<Result<ImportOutcome>> => {
    const me = deps.machine();
    const entry = deps.apps().find((each) => each.app === app);
    if (
      entry === undefined ||
      entry.sync_to === null ||
      entry.release === null
    ) {
      return ok({ busy: false, streams: [] });
    }
    const destination = deps.destinations.resolve(entry.sync_to);
    if (destination === null || destination.state === "missing") {
      return ok({ busy: false, streams: [] });
    }
    const reader = createFolderReader(destination.path);
    const machines = await reader.listMachines();
    if (!machines.ok) return ok({ busy: false, streams: [] });
    const stored = loadRecords(deps.sql, me, app);
    const streams: StreamOutcome[] = [];
    // 지난 실행이 죽으며 남긴 snapshot 임시 file.
    const tmp = join(deps.root, IMPORT_TMP_DIR, app);
    await rm(tmp, { recursive: true, force: true });
    await mkdir(tmp, { recursive: true, mode: 0o700 });
    for (const origin of machines.value) {
      if (origin === me || isForgotten(deps.sql, me, origin)) continue;
      const apps = await reader.list(`${machineDir(origin)}/apps`);
      if (!apps.ok || !apps.value.includes(app)) continue;
      const followed = await followStream(deps, {
        app,
        release: entry.release,
        origin,
        originName: stored.machines.get(origin)?.record.name ?? origin,
        record:
          stored.apps.find((row) => row.machine === origin)?.record ?? null,
        reader,
        blocked: blocked.get(origin) ?? null,
      });
      if (!followed.ok) return followed;
      streams.push(followed.value);
    }
    return ok({ busy: false, streams });
  };

  return {
    async scan() {
      const scanned = await scan(deps);
      if (!scanned.ok) return scanned;
      blocked.clear();
      for (const { machine, error } of scanned.value.errors) {
        if (machine !== null && error.code === "newer_format") {
          blocked.set(machine, error);
        }
      }
      return scanned;
    },
    async runApp(app) {
      if (running.has(app)) return ok({ busy: true, streams: [] });
      running.add(app);
      try {
        return await runApp(app);
      } finally {
        running.delete(app);
      }
    },
    forgetMachine(origin) {
      const me = deps.machine();
      const at = deps.clock.now();
      return deps.transaction((tx) => {
        const changed = tx.sql.run(
          `UPDATE folder_records SET forgotten_at = ? WHERE machine = ? AND origin = ?`,
          [at, me, origin],
        );
        return Number(changed.changes) === 0
          ? err({ code: "not_found", message: `no record of ${origin}` })
          : ok(undefined);
      });
    },
    isForgotten: (origin) => isForgotten(deps.sql, deps.machine(), origin),
    readsCaughtUp: (app) => readsCaughtUp(deps, app),
    peerHorizons: (app) => peerHorizons(deps, app),
    status: (app) => status(deps, app),
    records: () => records(deps),
    async forget(app) {
      const me = deps.machine();
      const removed = deps.transaction((tx) => {
        tx.sql.run(`DELETE FROM folder_reads WHERE machine = ? AND app = ?`, [
          me,
          app,
        ]);
        tx.sql.run(`DELETE FROM folder_held WHERE machine = ? AND app = ?`, [
          me,
          app,
        ]);
        return ok(undefined);
      });
      if (!removed.ok) return removed;
      await removeAppFiles(deps.root, app);
      return ok(undefined);
    },
  };
}
