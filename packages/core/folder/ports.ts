// 폴더 교환이 core의 다른 module에 기대는 면. type만 둔다.
import type { Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";

/** 받은 변경 하나. operation과 시작 시각은 주인 기계의 invocation 것이다. */
export type FolderChange = {
  /** 주인 sync log의 seq(십진 문자열). */
  id: string;
  hlc: string;
  operation: string | null;
  started_at: string | null;
  changeset: Uint8Array;
};

/**
 * 폴더에서 읽은 것을 앱 DB에 적용하는 길. core의 calls가 구현하고 folder import가 부른다.
 * - `conflict`: 그 앱의 활성 release가 `release`가 아니다(사이에 바뀌었다).
 * - `unavailable`: 앱 process가 없다.
 */
export type FolderApply = {
  /** file 하나 = 앱 DB transaction 하나. 제약에 걸린 변경만 건너뛴다. */
  applyChanges(input: {
    app: Id<"app">;
    release: Id<"rel">;
    origin: Id<"mch">;
    changes: readonly FolderChange[];
  }): Promise<
    Result<{
      applied: number;
      skipped: number;
      duplicate: number;
      held: number;
    }>
  >;
  /**
   * 다른 기계의 snapshot을 row·칸 clock으로 합친다. `path`는 core가 data root 아래에 payload만 풀어 둔 SQLite file.
   * `absentDeletes`가 있으면 clock이 `below` 이하이고 snapshot에 없으며 `keep`이 아닌 이 기계의 row를 지운다(horizon 밖에서
   * 돌아올 때). `keep`의 pk는 `lophn_sync_row.pk`의 hex다.
   */
  mergeSnapshot(input: {
    app: Id<"app">;
    release: Id<"rel">;
    origin: Id<"mch">;
    n: number;
    path: string;
    absentDeletes?: {
      below: string;
      keep: readonly { table: string; pk: string }[];
    };
  }): Promise<Result<{ changed: boolean; deleted: number }>>;
};

/** 내보내기가 읽는 sync log 줄. core의 sync log 줄이 그대로 맞는다. */
export type FolderLogRow = {
  seq: number;
  release: string;
  kind: string;
  origin: string;
  hlc: string | null;
  changeset: { hash: string; size: number } | null;
};

/** 내보내기가 읽는 sync log의 좁은 면. core의 `SyncLog`가 그대로 맞는다. */
export type FolderLog = {
  /** 그 앱 log의 마지막 seq(줄이 없으면 0). */
  head(app: string): number;
  /** `after` 뒤의 줄을 seq 순서로 `limit`개까지. */
  page(app: string, after: number, limit: number): readonly FolderLogRow[];
  readChangeset(hash: string, size: number): Promise<Result<Uint8Array>>;
};
