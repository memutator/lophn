// 읽기의 상태: 앱마다 출처 기계의 cursor·held·오류(읽기 명령의 `imports`), 알려진 기계의 기록 사본, 따라잡았는지.
// 알려진 기계는 이 기계가 기록 사본을 가진 기계에서 사람이 지운(`forgotten_at`) 기계를 뺀 것이다.
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  AppRecord,
  FolderError,
  MachineRecord,
} from "../../../protocol/folder/mod.ts";
import {
  type FolderImportDeps,
  isForgotten,
  loadRead,
  loadRecords,
} from "./deps.ts";

export type ImportStatus = {
  machine: Id<"mch">;
  imported_at: string | null;
  cursor: number;
  waiting_for: number | null;
  held: number;
  error: FolderError | null;
};

export type KnownRecords = {
  machines: {
    machine: Id<"mch">;
    record: MachineRecord;
    destination: string;
    read_at: string;
  }[];
  apps: {
    machine: Id<"mch">;
    app: Id<"app">;
    record: AppRecord;
    destination: string;
    read_at: string;
  }[];
};

export function records(deps: FolderImportDeps, app?: Id<"app">): KnownRecords {
  const stored = loadRecords(deps.sql, deps.machine(), app);
  const forgotten = new Set<Id<"mch">>();
  for (const [machine, row] of stored.machines) {
    if (row.forgotten_at !== null) forgotten.add(machine);
  }
  for (const row of stored.apps) {
    if (row.forgotten_at !== null) forgotten.add(row.machine);
  }
  return {
    machines: [...stored.machines]
      .filter(([machine]) => !forgotten.has(machine))
      .map(([machine, { record, destination, read_at }]) => ({
        machine,
        record,
        destination,
        read_at,
      })),
    apps: stored.apps
      .filter((row) => !forgotten.has(row.machine))
      .map(({ machine, app, record, destination, read_at }) => ({
        machine,
        app,
        record,
        destination,
        read_at,
      })),
  };
}

export function status(deps: FolderImportDeps, app: Id<"app">): ImportStatus[] {
  const me = deps.machine();
  const known = records(deps, app);
  const origins = new Set<Id<"mch">>(known.apps.map((row) => row.machine));
  for (const row of deps.sql.all(
    `SELECT origin FROM folder_reads WHERE machine = ? AND app = ? AND stream = 'data'`,
    [me, app],
  )) {
    const origin = row.origin as Id<"mch">;
    if (!isForgotten(deps.sql, me, origin)) origins.add(origin);
  }
  return [...origins].sort().map((origin) => {
    const read = loadRead(deps.sql, me, app, origin);
    const held = deps.sql.get(
      `SELECT count(*) AS n FROM folder_held WHERE machine = ? AND app = ? AND origin = ?`,
      [me, app, origin],
    );
    return {
      machine: origin,
      imported_at: read.read_at,
      cursor: read.cursor,
      waiting_for: read.waiting_for,
      held: Number(held?.n ?? 0),
      error: read.error,
    };
  });
}

/** 알려진 모든 기계에서 그 앱의 cursor가 그 기계 앱 기록의 `data.head`에 닿았는가. */
export function readsCaughtUp(deps: FolderImportDeps, app: Id<"app">): boolean {
  const me = deps.machine();
  return records(deps, app).apps.every(
    (row) =>
      loadRead(deps.sql, me, app, row.machine).cursor >= row.record.data.head,
  );
}

/** 알려진 기계의 그 앱 기록이 싣는 `settled`와 `horizon`. */
export function peerHorizons(
  deps: FolderImportDeps,
  app: Id<"app">,
): { machine: Id<"mch">; settled: string | null; horizon: string | null }[] {
  return records(deps, app).apps.map((row) => ({
    machine: row.machine,
    settled: row.record.settled,
    horizon: row.record.horizon,
  }));
}
