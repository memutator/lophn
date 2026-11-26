// 컴퓨터가 자기 몫을 destination에 쓴다: 선언의 `sync`가 table을 보내는 (앱, destination)마다 sync log를 data stream(`<n>.changes`, `<n>.snapshot`)으로,
// destination마다 기계 기록 `record.json`을. 쓰는 곳은 `machines/<자기 id>/` 아래뿐이다. 계기(debounce, timer)와 조립은
// folder wiring이 하고, 여기는 한 번 돌기와 상태만 낸다.
import {
  type Clock,
  ok,
  type RandomSource,
  type Result,
} from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { TableFilter } from "../../../protocol/apps/declaration/sync-plan.ts";
import type {
  FolderError,
  SharedProject,
} from "../../../protocol/folder/mod.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import type { DestinationsView } from "../destinations.ts";
import type { FolderLog } from "../ports.ts";
import { publishRecords } from "./record.ts";
import { readStream } from "./status.ts";
import { createStreams } from "./stream.ts";

export type ExportApp = {
  app: Id<"app">;
  slug: string;
  name: string;
  description: string;
  // 선언의 `sync`가 table을 보내는 destination 이름. destination마다 stream이 하나다.
  destinations: string[];
  release: { id: Id<"rel">; code_commit: string; data_schema: number } | null;
};

/** 내보내기가 쓰는 sync log의 면. core의 `SyncLog`가 그대로 맞는다. */
export type ExportLog = FolderLog & {
  /** 정리된 흔적과 부딪힐 자기 change 줄을 내보내지 않고 그 자리에서 held 줄로 바꾼다. */
  hold(seq: number): Result<void>;
  /**
   * 풀리지 않은 held 줄 가운데 변경이 이미 이 기계의 data에 있고 지금 활성 release가 그 destination으로 보내는 표를 건드리는
   * 것의 수. 하나라도 있으면 그 destination에 snapshot을 쓰지 않는다.
   */
  heldInData(app: string, destination: string): Promise<Result<number>>;
};

export type ExportFacts = {
  // remote가 꺼져 있으면 빈 목록과 null이다.
  addresses: {
    lan: string[];
    port: number | null;
    relay: string | null;
    relays?: string[];
  };
  hub?: boolean;
  alwaysOn: {
    keep_running: boolean;
    starts_at_login: boolean;
    keep_awake: boolean;
  } | null;
  lophn: {
    version: string;
    protocol: { version: number; min_version: number };
  };
  // 이 기계의 active git project 목록(architecture `project-identity`).
  projects: SharedProject[];
};

export type FolderExportDeps = {
  machine(): { id: Id<"mch">; name: string };
  destinations: DestinationsView;
  /** 활성 선언의 `sync`가 table을 보내는 앱. */
  apps(): ExportApp[];
  log: ExportLog;
  releaseKey(
    release: string,
  ): { code_commit: string; data_schema: number } | null;
  /**
   * 그 release의 선언이 `destination`으로 보내는 표(null이면 모든 표, 옛 release의 선언). log 줄은 그 줄의 release로
   * 거른다: 폰 앱의 줄에는 폰만 받는 표도 있고, release가 바뀌기 전 줄은 그 release의 표 집합으로 나가야 한다.
   */
  sentOf(release: string, destination: string): TableFilter;
  operationOf(invocation: string): { name: string; started_at: string } | null;
  /**
   * 그 앱의 write 줄을 잡은 채 log head를 읽고 앱 DB에서 `destination`으로 보내는 표의 사본을 `path`에 뜬다. 사본은 정확히
   * 그 seq까지를 담는다.
   */
  snapshotAt(
    app: Id<"app">,
    destination: string,
    path: string,
  ): Promise<Result<{ seq: number; size: number; sha256: string }>>;
  facts(): ExportFacts;
  /** 그 destination에서 그 앱을 읽는 모든 출처의 cursor가 그 출처 앱 기록의 `data.head`에 닿았는가. */
  readsCaughtUp(app: Id<"app">, destination: string): boolean;
  /** 그 destination에서 기록을 읽은 알려진(지우지 않은) 다른 기계의 그 앱 horizon. */
  peerHorizons(
    app: Id<"app">,
    destination: string,
  ): { machine: Id<"mch">; horizon: string }[];
  sql: Pick<Sql, "get" | "all">;
  transaction<T>(fn: (tx: Pick<Tx, "sql">) => Result<T>): Result<T>;
  clock: Clock;
  random: RandomSource;
  /** snapshot 사본을 앱 폴더 아래 임시 file로 뜬다. */
  dataRoot: string;
};

export type ExportOutcome = {
  files: number;
  bytes: number;
  /** horizon 밖이라 held 줄로 옮긴 변경 수. */
  held: number;
  /** 한 번의 한도(64 MiB)를 넘겨 남은 줄이 있다. */
  more: boolean;
  error: FolderError | null;
};

export type ExportStatus = {
  exported_at: string | null;
  /** 쓴 마지막 번호(없으면 0). */
  head: number;
  /** 아직 지나지 않은 sync log 줄 수. */
  pending: number;
  error: FolderError | null;
};

export type FolderExport = ReturnType<typeof createFolderExport>;

export function createFolderExport(deps: FolderExportDeps) {
  const streams = createStreams(deps);
  const dataKey = (app: Id<"app">, destination: string) => {
    const found = deps.apps().find((each) => each.app === app);
    return found === undefined || !found.destinations.includes(destination)
      ? null
      : {
          machine: deps.machine().id,
          app,
          destination,
          stream: "data" as const,
        };
  };

  return {
    runStream: streams.runStream,
    publishRecords: () => publishRecords(deps),

    /**
     * 그 destination 앱 기록의 `settled`와, horizon 밖이면 그때부터. 그 앱이 이 기계에서 그리 아직 내보낸 적이 없으면 null.
     */
    settledOf(
      app: Id<"app">,
      destination: string,
    ): { settled: string | null; away_since: string | null } | null {
      const key = dataKey(app, destination);
      const row = key === null ? null : readStream(deps.sql, key);
      return row === null
        ? null
        : { settled: row.settled, away_since: row.away_since };
    },

    /** 이 기계에서 그 앱을 그 destination으로 내보내지 않으면(그리 보내는 table이 없거나 앱이 없다) null. */
    status(app: Id<"app">, destination: string): ExportStatus | null {
      const key = dataKey(app, destination);
      if (key === null) return null;
      const row = readStream(deps.sql, key);
      return {
        exported_at: row?.written_at ?? null,
        head: row === null ? 0 : row.next_n - 1,
        pending: Math.max(0, deps.log.head(app) - (row?.last_seq ?? 0)),
        error: row?.error ?? null,
      };
    },

    /** 앱을 지울 때. local 상태만 지우고 폴더의 file은 그대로 둔다. */
    forget(app: Id<"app">): Result<void> {
      streams.forget(app);
      const machine = deps.machine().id;
      return deps.transaction((tx) => {
        tx.sql.run("DELETE FROM folder_streams WHERE machine = ? AND app = ?", [
          machine,
          app,
        ]);
        tx.sql.run("DELETE FROM folder_written WHERE machine = ? AND app = ?", [
          machine,
          app,
        ]);
        return ok(undefined);
      });
    },
  };
}
