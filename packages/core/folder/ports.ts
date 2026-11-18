// 폴더 교환이 core의 다른 module에 기대는 면. type만 둔다.
import type { Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { JsonValue } from "../../protocol/base/json-values.ts";
import type { CarryPutStatus, CarryVia } from "../../protocol/folder/carry.ts";

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
  invocation: string | null;
};

/** 내보내기가 읽는 sync log의 좁은 면. core의 `SyncLog`가 그대로 맞는다. */
export type FolderLog = {
  /** 그 앱 log의 마지막 seq(줄이 없으면 0). */
  head(app: string): number;
  /** `after` 뒤의 줄을 seq 순서로 `limit`개까지. */
  page(app: string, after: number, limit: number): readonly FolderLogRow[];
  readChangeset(hash: string, size: number): Promise<Result<Uint8Array>>;
};

/** 받는 자리가 file 하나·manifest 하나에 내린 결과. `have`는 이미 같은 것을 든다. */
export type CarryReceived = Exclude<CarryPutStatus, "partial">;

/**
 * `computers` 폴더의 받는 자리. link·폰·거울이 가져온 manifest와 file을 받고, 이 기계가 든 것을 내준다. folder가 낸다.
 * 받는 쪽 규칙은 길과 상관없이 이 자리 하나가 지킨다(`folder-sync.md` "받는 쪽 규칙"):
 * - manifest는 `verifyManifest`(서명 key는 `ctx.computerSigningKey`)가 믿고 `newerManifest`가 (그 기계, 그 서명 key)의
 *   표시(`folder_carry_marks`, 하위 폴더 밖, 지우지 않음)보다 크다고 할 때만 그 기계의 지금 목록이 된다. 이 기계 자신의
 *   manifest는 두지 않고, 자기 key로 맞고 더 크면 자기 표시만 올린다.
 * - 명단 view가 바뀔 때마다 든 manifest를 지금 key로 다시 검증한다. 맞지 않게 된 기계(빼기가 정해지지 않음, 충돌, 같은
 *   기계 이름의 컴퓨터가 둘, key가 바뀜)에서는 새것을 받지 않되 든 file은 둔다. 하위 폴더는 `ctx.computerRemoved`가 참일
 *   때(정해진 빼기)만 통째로 지운다.
 * - file은 staging에 받고, rename 직전에 그때의 지금 manifest 사슬(`expectedFile`)과 크기·sha256을 다시 견준다. 사슬에서
 *   빠진 file(덮던 목록 file이 빠지거나 바뀐 것 포함)은 지운다.
 */
export type FolderReplica = {
  /**
   * 이 기계의 manifest와 지금 목록인 다른 기계의 것. 글은 `read(machine, "machines/<mch>/manifest.json", …)`로 읽는다.
   * 다른 기계 것은 받아 들인 때와 길을 싣는다(이 기계 것은 null).
   */
  manifests(): Promise<
    Result<
      {
        machine: Id<"mch">;
        revision: number;
        size: number;
        sha256: string;
        received_at: string | null;
        via: CarryVia | null;
      }[]
    >
  >;
  /** manifest 글. 믿고 표시보다 새면 `accepted`, 같거나 옛 것이면 `have`, 믿지 못하면 `rejected`. */
  offerManifest(text: string, via: CarryVia): Promise<Result<CarryReceived>>;
  /** 믿는 manifest가 싣거나 덮는데 아직 없는 file. (machine, path) 글자 순서로 `after` 뒤부터 limit개. */
  wants(
    limit: number,
    after?: { machine: Id<"mch">; path: string },
  ): Promise<
    Result<
      {
        machine: Id<"mch">;
        path: string;
        size: number;
        sha256: string;
      }[]
    >
  >;
  /** 든 file이고 지금 목록이 그 크기·sha256으로 싣거나 덮는가(든 manifest 글 포함). */
  holds(machine: Id<"mch">, path: string): Promise<boolean>;
  /** 든 file의 한 구간. holds가 아니면 not_found. */
  read(
    machine: Id<"mch">,
    path: string,
    offset: number,
    length: number,
  ): Promise<Result<Uint8Array>>;
  /** manifest가 아닌 file 하나를 조각 순서대로 받는다. 첫 조각 전과 rename 직전에 지금 목록과 견준다. */
  receive(input: {
    machine: Id<"mch">;
    path: string;
    size: number;
    sha256: string;
    via: CarryVia;
    chunks: AsyncIterable<Uint8Array>;
  }): Promise<Result<CarryReceived>>;
};

/** 앱이 다른 기계에도 알리겠다고 낸 event를 그 앱의 event file로 쓴다. folder가 낸다. */
export type CrossEvents = {
  write(
    app: Id<"app">,
    release: Id<"rel">,
    event: { name: string; payload: JsonValue; at: string },
  ): Promise<Result<void>>;
};

/** 다른 기계에서 온 event file 하나(아직 이 기계가 내지 않은 것). apps가 이 기계에서 낸다. */
export type EventArrived = (input: {
  app: Id<"app">;
  origin: Id<"mch">;
  name: string;
  payload: JsonValue;
  at: string;
  bundle_hash: string;
}) => void;
