// 읽기의 상태: (앱, destination)마다 출처 기계의 cursor·held·오류(읽기 명령의 `imports`), 알려진 기계의 기록 사본, 따라잡았는지.
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
  /**
   * 이 기계가 horizon 밖에서 그 출처의 snapshot을 지우기 없이 합쳤고, 출처가 이 기계의 것을 다 받은 뒤의 snapshot으로
   * 다시 합치기를 기다린다. 그동안 다른 곳에서 지워진 옛 row가 이 기계에 남아 있을 수 있다.
   */
  owes_absent_pass: boolean;
};

export type KnownRecords = {
  machines: {
    machine: Id<"mch">;
    record: MachineRecord;
    // 그 기계의 기록을 읽은 destination 모두.
    destinations: string[];
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
      .map(([machine, { record, destinations, read_at }]) => ({
        machine,
        record,
        destinations,
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

/**
 * 기계·앱마다 가장 새로 쓴 앱 기록 하나. 앱 기록은 destination마다 있고 revision은 destination마다 따로 세므로 `updated_at`으로
 * 견준다. 활성 release와 source처럼 destination과 상관없는 칸을 읽을 때 쓴다.
 */
export function latestAppRecords<
  T extends { machine: Id<"mch">; app: Id<"app">; record: AppRecord },
>(rows: readonly T[]): T[] {
  const out = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.machine}\0${row.app}`;
    const kept = out.get(key);
    if (kept === undefined || kept.record.updated_at < row.record.updated_at) {
      out.set(key, row);
    }
  }
  return [...out.values()];
}

// 그 destination에서 읽은 앱 기록이 그 앱의 data를 싣는가. source와 기록만 싣는 기록(`sync_to` null)은 data stream이 없어
// 읽기 목록·따라잡기·흔적 정리의 하한에 들지 않는다.
function carriesData(
  row: { destination: string; record: AppRecord },
  destination: string,
): boolean {
  return row.destination === destination && row.record.sync_to === destination;
}

export function status(
  deps: FolderImportDeps,
  app: Id<"app">,
  destination: string,
): ImportStatus[] {
  const me = deps.machine();
  const known = records(deps, app);
  const origins = new Set<Id<"mch">>(
    known.apps
      .filter((row) => carriesData(row, destination))
      .map((row) => row.machine),
  );
  for (const row of deps.sql.all(
    `SELECT origin FROM folder_reads WHERE machine = ? AND app = ? AND destination = ? AND stream = 'data'`,
    [me, app, destination],
  )) {
    const origin = row.origin as Id<"mch">;
    if (!isForgotten(deps.sql, me, origin)) origins.add(origin);
  }
  return [...origins].sort().map((origin) => {
    const read = loadRead(deps.sql, me, { app, destination, origin });
    const held = deps.sql.get(
      `SELECT count(*) AS n FROM folder_held
       WHERE machine = ? AND app = ? AND destination = ? AND origin = ?`,
      [me, app, destination, origin],
    );
    return {
      machine: origin,
      imported_at: read.read_at,
      cursor: read.cursor,
      waiting_for: read.waiting_for,
      held: Number(held?.n ?? 0),
      error: read.error,
      owes_absent_pass: read.absent !== null,
    };
  });
}

/** 그 destination에서 알려진 모든 기계의 그 앱 cursor가 그 기계 앱 기록의 `data.head`에 닿았는가. */
export function readsCaughtUp(
  deps: FolderImportDeps,
  app: Id<"app">,
  destination: string,
): boolean {
  const me = deps.machine();
  return records(deps, app)
    .apps.filter((row) => carriesData(row, destination))
    .every(
      (row) =>
        loadRead(deps.sql, me, { app, destination, origin: row.machine })
          .cursor >= row.record.data.head,
    );
}

/**
 * 그 destination에서 읽은 알려진 기계의 그 앱 기록이 싣는 `settled`와 `horizon`. 흔적 정리는 앱 DB에 하나라 부르는 쪽이 그 앱이
 * data를 주고받는 모든 destination의 것을 모은다.
 */
export function peerHorizons(
  deps: FolderImportDeps,
  app: Id<"app">,
  destination: string,
): { machine: Id<"mch">; settled: string | null; horizon: string | null }[] {
  return records(deps, app)
    .apps.filter((row) => carriesData(row, destination))
    .map((row) => ({
      machine: row.machine,
      settled: row.record.settled,
      horizon: row.record.horizon,
    }));
}
