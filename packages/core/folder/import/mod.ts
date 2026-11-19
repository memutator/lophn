// 다른 기계의 하위 폴더를 읽는다: 기계·앱 기록의 사본(scan)과, `sync_to`가 있는 앱마다 출처 기계의 data stream
// 따라잡기(runApp). runApp은 출처마다 먼저 지금 release의 held를 적용한다(drain.ts): 활성 release가 바뀌면 folder wiring이
// scan과 runApp을 다시 돌리므로 따로 계기를 두지 않는다. 계기(감시, timer)와 조립은 folder-surface가 한다.
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { FOLDER_FORMAT, machineDir } from "../../../protocol/folder/mod.ts";
import { createFolderReader } from "../fs.ts";
import {
  type Exchange,
  exchangeError,
  exchangeWith,
  type FolderExchange,
  type HeldDetail,
  type MachineExchange,
} from "./compat.ts";
import { type FolderImportDeps, isForgotten, loadRecords } from "./deps.ts";
import { heldChangeCount, IMPORT_TMP_DIR, removeAppFiles } from "./held.ts";
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
export type {
  Exchange,
  FolderExchange,
  HeldDetail,
  ImportStatus,
  KnownRecords,
  MachineExchange,
  ScanOutcome,
  StreamOutcome,
};

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
  /** 알려진 기계의 기록 사본. 꼴 판이 범위 밖인 기계의 앱 기록은 빠진다(그 기계의 release·source를 읽지 않는다). */
  records(): KnownRecords;
  forget(app: Id<"app">): Promise<Result<void>>;
  exchange: FolderExchange;
};

export function createFolderImport(deps: FolderImportDeps): FolderImport {
  // (앱, 출처 기계)마다 한 번에 하나. 앱 단위로 묶는다.
  const running = new Set<Id<"app">>();
  // scan이 본 출처 기계의 `newer_format`(기록의 꼴이 더 새것이거나 꼴 판이 범위 밖). 그 기계의 data는 읽지 않는다.
  const blocked = new Map<Id<"mch">, ScanOutcome["errors"][number]["error"]>();
  // (앱, 출처)마다 held가 한도에 닿았을 때의 이 기계 release와 출처의 snapshot 번호. 둘 다 그대로면 폴더를 다시 읽지
  // 않는다. core가 다시 뜨면 한 번 더 읽어 다시 안다.
  const full = new Map<
    string,
    { code_commit: string; snapshot: number | null }
  >();
  const changeCounts = new Map<string, number>();
  const listeners = new Set<() => void>();
  let lastMachines = "";
  const lastHeld = new Map<Id<"app">, string>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  // 범위 밖이면 그 오류. 다시 뜬 뒤 scan 전에도 저장한 기록으로 막는다.
  const blockedError = (origin: Id<"mch">) => {
    const stored = loadRecords(deps.sql, deps.machine()).machines.get(origin);
    if (stored !== undefined) {
      const exchange = exchangeWith(stored.record.lophn.folder);
      if (exchange !== "ok") {
        return exchangeError(deps.clock, origin, stored.record.name, exchange);
      }
    }
    return blocked.get(origin) ?? null;
  };

  const machines = (): MachineExchange[] => {
    const self = deps.self();
    const rows: MachineExchange[] = [
      {
        machine: deps.machine(),
        name: self.name,
        lophn_version: self.lophn_version,
        folder: { ...FOLDER_FORMAT },
        exchange: "ok",
      },
    ];
    const known = new Set<Id<"mch">>();
    for (const { machine, record } of records(deps).machines) {
      known.add(machine);
      const exchange = exchangeWith(record.lophn.folder);
      // 저장한 기록은 범위 안인데 새 기록이 더 새 꼴이라 읽지 못했다: 옛 사본의 판은 보이지 않는다.
      const newer = exchange === "ok" && blocked.has(machine);
      rows.push({
        machine,
        name: record.name,
        lophn_version: newer ? null : record.lophn.version,
        folder: newer ? null : record.lophn.folder,
        exchange: newer ? "update_this" : exchange,
      });
    }
    for (const machine of blocked.keys()) {
      if (known.has(machine) || isForgotten(deps.sql, deps.machine(), machine))
        continue;
      rows.push({
        machine,
        name: machine,
        lophn_version: null,
        folder: null,
        exchange: "update_this",
      });
    }
    return rows;
  };

  const held = (app: Id<"app">): HeldDetail[] => {
    const rows = deps.sql.all(
      `SELECT origin, code_commit, data_schema, kind, path, size FROM folder_held
       WHERE machine = ? AND app = ? ORDER BY origin, n`,
      [deps.machine(), app],
    );
    const out = new Map<string, HeldDetail>();
    for (const row of rows) {
      const origin = row.origin as Id<"mch">;
      const code_commit = row.code_commit as string;
      const key = `${origin}\0${code_commit}`;
      let detail = out.get(key);
      if (detail === undefined) {
        detail = {
          origin,
          code_commit,
          data_schema: Number(row.data_schema),
          changes: 0,
          bytes: 0,
          full: full.has(`${app}\0${origin}`),
        };
        out.set(key, detail);
      }
      detail.bytes += Number(row.size);
      if (row.kind === "changes") {
        detail.changes += heldChangeCount(
          deps.root,
          row.path as string,
          changeCounts,
        );
      }
    }
    return [...out.values()];
  };

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
      const record =
        stored.apps.find((row) => row.machine === origin)?.record ?? null;
      const fullKey = `${app}\0${origin}`;
      const wasFull = full.get(fullKey);
      const followed = await followStream(deps, {
        app,
        release: entry.release,
        origin,
        originName: stored.machines.get(origin)?.record.name ?? origin,
        record,
        reader,
        blocked: blockedError(origin),
        full:
          wasFull !== undefined &&
          wasFull.code_commit === entry.release.code_commit &&
          wasFull.snapshot === (record?.data.snapshot ?? null),
      });
      if (!followed.ok) return followed;
      if (followed.value.full) {
        full.set(fullKey, {
          code_commit: entry.release.code_commit,
          snapshot: record?.data.snapshot ?? null,
        });
      } else {
        full.delete(fullKey);
      }
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
      const now = JSON.stringify(machines());
      if (now !== lastMachines) {
        lastMachines = now;
        notify();
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
        const now = JSON.stringify(held(app));
        if (now !== (lastHeld.get(app) ?? "[]")) {
          lastHeld.set(app, now);
          notify();
        }
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
    records() {
      const known = records(deps);
      return {
        machines: known.machines,
        apps: known.apps.filter((row) => blockedError(row.machine) === null),
      };
    },
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
      for (const key of full.keys()) {
        if (key.startsWith(`${app}\0`)) full.delete(key);
      }
      lastHeld.delete(app);
      return ok(undefined);
    },
    exchange: {
      machines,
      held,
      recorded: () =>
        records(deps).apps.map(({ machine, app }) => ({ machine, app })),
      onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}
