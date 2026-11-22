// 읽기가 기대는 면과 local 상태 표(`folder_reads`, `folder_records`)의 작은 읽기·쓰기.
// 모든 행은 첫 칸 machine이 지금 기계 id인 것만 본다(복제된 data root에서 온 행은 없는 것이다).
import {
  type Clock,
  formatAt,
  type RandomSource,
  type Result,
} from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { TableFilter } from "../../../protocol/apps/declaration/sync-plan.ts";
import {
  type AppRecord,
  BACKOFF_FIRST_MS,
  BACKOFF_MAX_MS,
  type FolderError,
  type FolderErrorCode,
  type MachineRecord,
} from "../../../protocol/folder/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { DestinationsView } from "../destinations.ts";
import type { FolderApply } from "../ports.ts";

export type ImportApp = {
  app: Id<"app">;
  // 선언의 `sync`가 table을 보내는 destination과 그리 가는 표(null이면 모든 표, 옛 release). destination마다 출처의 stream을
  // 따로 읽는다. 같은 release의 변경만 적용하므로 받은 변경도 그 destination의 표만 남긴다. 비면 그 앱의 data를 읽지 않는다.
  destinations: readonly { name: string; sent: TableFilter }[];
  /** 이 기계의 활성 release. 없으면 그 앱은 읽지 않는다. */
  release: { id: Id<"rel">; code_commit: string; data_schema: number } | null;
};

export type FolderImportDeps = {
  machine: () => Id<"mch">;
  /** 이 기계의 이름과 제품 판(시작 전이면 null). 기계 목록(`FolderExchange.machines`)의 이 기계 줄. */
  self(): { name: string; lophn_version: string | null };
  destinations: Pick<DestinationsView, "list" | "resolve">;
  apps(): readonly ImportApp[];
  apply: FolderApply;
  /** folder-export가 아는 이 기계의 그 앱 그 destination stream 상태. `away_since`가 있으면 이 기계가 horizon 밖이다. */
  exportState(
    app: Id<"app">,
    destination: string,
  ): {
    settled: string | null;
    data_head: number;
    away_since: string | null;
  };
  /** 이 기계 sync log의 풀리지 않은 held 줄이 건드리는 row. pk는 `lophn_sync_row.pk`의 hex. */
  heldRows(app: Id<"app">): readonly { table: string; pk: string }[];
  sql: Pick<Sql, "get" | "all">;
  /** ledger 쓰기 transaction 하나. 돌려준 값이 err이면 rollback한다. */
  transaction<T>(fn: (tx: { readonly sql: Sql }) => Result<T>): Result<T>;
  clock: Clock;
  random: RandomSource;
  /** data root. held 사본과 snapshot 임시 file이 여기 아래에 간다. */
  root: string;
  /** 출처·앱마다 held changes 한도. 없으면 `HELD_MAX_BYTES`. test가 작게 둔다. */
  heldMaxBytes?: number;
};

export const folderError = (
  clock: Clock,
  code: FolderErrorCode,
  message: string,
  details?: Record<string, unknown>,
): FolderError => ({
  code,
  message,
  at: clock.now(),
  ...(details === undefined ? {} : { details }),
});

export function hex16(random: RandomSource): string {
  const bytes = new Uint8Array(8);
  random.fill(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * 이 기계가 horizon 밖에서 그 출처의 snapshot을 지우기 없이 합쳤다: 그 stream은 "다른 곳에서 지워지고 흔적이 정리된
 * row"를 지우는 합치기를 아직 빚졌다. `caught_up_at`은 출처의 앱 기록이 이 기계가 낸 것을 다 받았다고 처음 보인 때의
 * `read[이 기계].at`(출처의 시계)다. 그 뒤에 만든 snapshot만 "없음"이 "지워짐"이다.
 */
export type AbsentPass = { caught_up_at: string | null };

export type ReadRow = {
  cursor: number;
  read_at: string | null;
  attempts: number;
  next_try_at: string | null;
  waiting_for: number | null;
  error: FolderError | null;
  absent: AbsentPass | null;
};

// `folder_reads.error` 칸에 오류와 빚진 합치기를 같이 둔다: `{ error, absent }`. 둘 다 없으면 NULL이다.
// 칸 하나를 더하는 schema step 없이 재시작을 넘긴다.
type StateColumn = { error: FolderError | null; absent: AbsentPass | null };

/** 읽는 data stream 하나: (앱, destination, 출처 기계). */
export type ReadKey = {
  app: Id<"app">;
  destination: string;
  origin: Id<"mch">;
};

export function loadRead(
  sql: Pick<Sql, "get">,
  me: Id<"mch">,
  key: ReadKey,
): ReadRow {
  const row = sql.get(
    `SELECT cursor, read_at, attempts, next_try_at, waiting_for, error FROM folder_reads
     WHERE machine = ? AND app = ? AND destination = ? AND origin = ? AND stream = 'data'`,
    [me, key.app, key.destination, key.origin],
  );
  if (row === undefined) {
    return {
      cursor: 0,
      read_at: null,
      attempts: 0,
      next_try_at: null,
      waiting_for: null,
      error: null,
      absent: null,
    };
  }
  const state: StateColumn =
    row.error === null
      ? { error: null, absent: null }
      : (JSON.parse(row.error as string) as StateColumn);
  return {
    cursor: Number(row.cursor),
    read_at: row.read_at as string | null,
    attempts: Number(row.attempts),
    next_try_at: row.next_try_at as string | null,
    waiting_for: row.waiting_for === null ? null : Number(row.waiting_for),
    error: state.error,
    absent: state.absent,
  };
}

export function saveRead(
  sql: Sql,
  me: Id<"mch">,
  key: ReadKey,
  row: ReadRow & { code_commit?: string },
): void {
  sql.run(
    `INSERT INTO folder_reads
       (machine, app, destination, origin, stream, cursor, code_commit, read_at, attempts, next_try_at, waiting_for, error)
     VALUES (?, ?, ?, ?, 'data', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (machine, app, destination, origin, stream) DO UPDATE SET
       cursor = excluded.cursor,
       code_commit = coalesce(excluded.code_commit, folder_reads.code_commit),
       read_at = excluded.read_at,
       attempts = excluded.attempts,
       next_try_at = excluded.next_try_at,
       waiting_for = excluded.waiting_for,
       error = excluded.error`,
    [
      me,
      key.app,
      key.destination,
      key.origin,
      row.cursor,
      row.code_commit ?? null,
      row.read_at,
      row.attempts,
      row.next_try_at,
      row.waiting_for,
      row.error === null && row.absent === null
        ? null
        : JSON.stringify({ error: row.error, absent: row.absent }),
    ],
  );
}

/** 1분부터 두 배씩 1시간까지. `attempts`는 이번 실패 전까지의 수다. */
export function backoffUntil(nowMs: number, attempts: number): string {
  const delay = Math.min(
    BACKOFF_FIRST_MS * 2 ** Math.min(attempts, 20),
    BACKOFF_MAX_MS,
  );
  return formatAt(nowMs + delay);
}

// 다른 기계의 기록 사본. 기계 기록은 destination마다 같은 내용이라 기계마다 가장 큰 revision 하나를 두고, 앱 기록은
// destination마다 다른 data stream을 싣으므로 (기계, 앱, destination)마다 둔다.
export type StoredRecords = {
  machines: Map<
    Id<"mch">,
    {
      record: MachineRecord;
      destination: string;
      read_at: string;
      forgotten_at: string | null;
    }
  >;
  apps: {
    machine: Id<"mch">;
    app: Id<"app">;
    record: AppRecord;
    destination: string;
    read_at: string;
    forgotten_at: string | null;
  }[];
};

export function loadRecords(
  sql: Pick<Sql, "all">,
  me: Id<"mch">,
  app?: Id<"app">,
): StoredRecords {
  const rows = sql.all(
    `SELECT origin, kind, key, record, destination, read_at, forgotten_at FROM folder_records
     WHERE machine = ? AND (kind = 'machine' OR ? IS NULL OR key = ?) ORDER BY origin, kind, key, destination`,
    [me, app ?? null, app ?? null],
  );
  const out: StoredRecords = { machines: new Map(), apps: [] };
  for (const row of rows) {
    const base = {
      destination: row.destination as string,
      read_at: row.read_at as string,
      forgotten_at: row.forgotten_at as string | null,
    };
    if (row.kind === "machine") {
      const origin = row.origin as Id<"mch">;
      const record = JSON.parse(row.record as string) as MachineRecord;
      const kept = out.machines.get(origin);
      if (kept === undefined || kept.record.revision < record.revision) {
        out.machines.set(origin, { ...base, record });
      }
    } else {
      out.apps.push({
        ...base,
        machine: row.origin as Id<"mch">,
        app: row.key as Id<"app">,
        record: JSON.parse(row.record as string) as AppRecord,
      });
    }
  }
  return out;
}

export function isForgotten(
  sql: Pick<Sql, "get">,
  me: Id<"mch">,
  origin: Id<"mch">,
): boolean {
  return (
    sql.get(
      `SELECT 1 FROM folder_records WHERE machine = ? AND origin = ? AND forgotten_at IS NOT NULL LIMIT 1`,
      [me, origin],
    ) !== undefined
  );
}
