// sync log의 기록과 읽기. 쓰기는 apps가 main thread에서 쓰는 ledger 연결(write-link)의 짧은 transaction 하나씩이다.
// 폰에 보낼 줄의 changeset은 blob store에 둔다. blob store는 hash로 file 하나를 두므로 invocation이 이미 쥔 bytes와
// 같으면 같은 file을 가리킬 뿐 새로 담지 않는다.
// bytes를 담지 못하는 변경(너무 큼, blob 준비 실패, 결과 모름)은 '다시 snapshot' 줄로 남긴다: 그 변경을 보내지 못하면
// 폰이 조용히 갈라지므로, 그 줄에 닿은 폰은 새 snapshot을 받는다. 다른 기계에서 온 일(받은 변경, snapshot 합치기)의
// '다시 snapshot' 줄은 origin `machine`이다: 폰에는 필요하지만 폴더로는 다시 내보내지 않는다(그 기계가 이미 낸 것이다).
// 이 기계의 write와 rewind는 clock을 다는 표(폰 앱은 모두, 그 밖에는 선언이 보내는 표)의 구간만 줄에 담는다. 담을 것이
// 없는 write는 `skipped` 줄이다: 줄이 없으면 core가 뜰 때의 메우기가 그 invocation을 매번 '다시 snapshot'으로 본다.
// 폰 앱이 아닌 앱의 write는 destination마다 줄을 나눠 그 destination으로 가는 표만 담고 줄에 그 destination을 적는다:
// 내보내기의 hold와 held는 줄 단위라, 섞인 줄은 한 destination에서만 붙들 수 없다. destination이 없는 줄(폰 앱의 줄,
// '다시 snapshot' 줄, 건너뛴 줄)은 모든 destination의 것이다.
import { err, filterChangeset, ok, type Result } from "../../../base/mod.ts";
import {
  type SyncPlan,
  sendsTo,
  sentTables,
} from "../../../protocol/apps/declaration/sync-plan.ts";
import type { AppInvocation } from "../../../protocol/apps/calls/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { Sql, SqlParam, Tx } from "../../../protocol/server/mod.ts";
import {
  BLOB_READ_MAX_BYTES,
  type PreparedBlob,
} from "../../../protocol/storage/mod.ts";
import { eraseBlobRefs } from "../../storage/blobs/mod.ts";
import {
  CHANGESET_MAX_BYTES,
  type ChangesetBlobs,
} from "../invocations/mod.ts";
import { headSeq } from "../invocations/store.ts";
import type { InvocationLedger } from "../ports.ts";
import { SYNC_LOG_FIELD_NAME, SYNC_LOG_OWNER_KIND } from "./schema.ts";

export type SyncOrigin = "computer" | "device" | "rewind" | "machine";

export type SyncLogRow = {
  seq: number;
  release: string;
  // 이 줄이 가는 destination. null이면 모든 destination이다(폰 앱의 줄, 표가 없는 줄).
  destination: string | null;
  kind: "change" | "skipped" | "snapshot" | "held";
  origin: SyncOrigin;
  device: string | null;
  machine: string | null;
  hlc: string | null;
  changeset: { hash: string; size: number } | null;
  invocation: string | null;
};

// 폰에서 온 변경 하나(받은 그대로의 changeset과 hlc).
export type PhoneChange = {
  device: Id<"dev">;
  id: string;
  hlc: string;
  changeset: Uint8Array;
};

// 다른 기계에서 폴더로 온 변경 하나. id는 주인 기계 sync log의 seq(십진 문자열)다. destination은 그 변경이 온 폴더다.
export type MachineChange = {
  machine: Id<"mch">;
  destination: string;
  id: string;
  hlc: string;
  changeset: Uint8Array;
};

// held로 남길 변경. device·machine·id는 그 변경이 폰이나 다른 기계에서 왔을 때만 있다.
export type HeldChange = {
  origin: SyncOrigin;
  device?: Id<"dev">;
  machine?: Id<"mch">;
  // 다른 기계에서 폴더로 왔으면 그 destination.
  destination?: string;
  id?: string;
  hlc: string;
  changeset: Uint8Array;
};

/** 호출 경로(calls)와 rewind가 sync log에 남기는 길. 남기지 못해도 호출 결과는 바꾸지 않는다. */
export type SyncRecorder = {
  /** 같은 기기가 같은 변경 id를 이미 보냈으면 그 줄의 seq. */
  duplicate(device: string, id: string): Result<number | null>;
  /** 같은 기계의 같은 변경 id가 이미 log에 있으면 그 줄의 seq. 기기의 줄과 섞지 않는다. */
  duplicateFrom(machine: Id<"mch">, id: string): Result<number | null>;
  /**
   * 컴퓨터의 write(호출, 앱 시작). 응답에 hlc가 없으면 sync 앱이 아니거나 바뀐 것이 없다. bytes가 없으면(너무 커서
   * 버려짐) '다시 snapshot' 줄이다.
   */
  written(
    inv: AppInvocation,
    hlc: string | undefined,
    bytes: Uint8Array | null,
  ): Promise<void>;
  /** 보냈는데 결과를 모르는 write. sync 앱이면 바뀌었을 수 있으니 '다시 snapshot' 줄이다. */
  unknown(inv: AppInvocation): Promise<void>;
  /** 폰에서 온 변경. 다른 기기에는 원래 changeset과 hlc를 보낸다(effective는 invocation의 기록에만 쓴다). */
  phone(
    inv: AppInvocation,
    change: PhoneChange,
    status: "applied" | "skipped",
  ): Promise<Result<number>>;
  /** 다른 기계에서 온 변경. 폰에는 원래 changeset과 hlc를 보내고, 폴더로는 다시 내보내지 않는다. */
  machine(
    inv: AppInvocation,
    change: MachineChange,
    status: "applied" | "skipped",
  ): Promise<Result<number>>;
  /**
   * 다른 기계의 snapshot을 합쳐 바뀐 것이 있다. 합친 변경들은 clock이 하나가 아니라 줄 하나로 폰에 보낼 수 없어 '다시
   * snapshot' 줄이다(origin `machine`, 그 합치기 invocation).
   */
  merged(inv: AppInvocation): Promise<Result<number>>;
  /**
   * 받았지만 정리된 흔적과 안전하게 합칠 수 없어 적용하지 않은 변경(폰이나 다른 기계에서 온 것). bytes를 blob으로 쥐고,
   * 쥐지 못하면 줄을 남기지 않고 오류다(다시 snapshot 줄로 바꾸면 그 변경을 잃는다). invocation은 비어 있다.
   */
  held(
    app: Id<"app">,
    release: Id<"rel">,
    change: HeldChange,
    reason: "past_horizon",
  ): Promise<Result<number>>;
  /** rewind가 실제로 바꾼 것(effective)과 그것에 찍은 새 clock. */
  rewound(
    app: Id<"app">,
    release: Id<"rel">,
    effective: Uint8Array,
    hlc: string,
  ): Promise<void>;
};

export type SyncLog = SyncRecorder & {
  /** 그 앱 log의 마지막 seq(줄이 없으면 0). */
  head(app: string): number;
  /** `after` 뒤에 '다시 snapshot' 줄이 있는가. */
  snapshotNeeded(app: string, after: number): boolean;
  /** `after` 뒤의 줄을 seq 순서로 `limit`개까지. */
  page(app: string, after: number, limit: number): SyncLogRow[];
  readChangeset(hash: string, size: number): Promise<Result<Uint8Array>>;
  /** 그 앱의 풀리지 않은 held 줄을 seq 순서로. */
  heldList(app: string): SyncLogRow[];
  /**
   * 이 기계의 아직 내보내지 않은 change 줄을 그 자리에서 held로 바꾼다(horizon 밖의 내보내기). 줄의 seq, origin,
   * invocation, bytes는 그대로다. 그 줄이 이미 change가 아니면 아무것도 하지 않는다.
   */
  hold(seq: number): Result<void>;
  /**
   * 풀리지 않은 held 줄 가운데 변경이 이미 이 기계의 data에 있는 것(`heldInData`)의 수. `destination`을 주면 그
   * destination의 줄(과 destination이 없는 줄)만 센다.
   */
  heldInData(app: string, destination?: string): number;
  /** held 줄을 풀었다고 적는다. bytes와 줄은 남는다. */
  resolve(seq: number, at: string): Result<void>;
  /** activation 뒤: 옛 release의 줄(held는 빼고)을 지우고, 지운 것이 있으면 새 release에 '다시 snapshot' 줄을 남긴다. */
  prune(app: Id<"app">, keep: Id<"rel">): Promise<Result<void>>;
  /**
   * core가 앱의 commit과 log 줄 사이에서 죽었을 때의 빈틈을 닫는다. 활성 release의 live write 가운데 바뀐 것이
   * 있거나(changeset) 결과를 모르는 것이 log 줄이 없으면 '다시 snapshot' 줄을 남긴다. 그 변경의 hlc는 앱 DB의
   * clock에만 있어 core가 changeset으로 다시 보낼 수 없다.
   */
  backfill(app: Id<"app">): Promise<Result<number>>;
};

export type SyncLogDeps = {
  sql: Pick<Sql, "get" | "all">;
  // ledger 쓰기 transaction 하나. 돌려준 값이 err이면 rollback한다.
  transaction<T>(fn: (tx: Tx) => Result<T>): Result<T>;
  blobs: ChangesetBlobs;
  ledger: Pick<InvocationLedger, "list">;
  activeRelease(app: Id<"app">): Result<Id<"rel"> | null>;
  // 그 release가 sync 앱이면 선언이 정한 길(`syncPlanOf`), 아니면 null.
  plan(app: string, release: string): SyncPlan | null;
  now(): string;
  // 줄을 쓴 transaction이 commit된 뒤. `AppSyncChanged`를 낸다.
  changed(app: string, release: string, seq: number): void;
};

type Append = {
  app: string;
  release: string;
  destination?: string | null;
  kind: SyncLogRow["kind"];
  origin: SyncOrigin;
  device?: string;
  machine?: string;
  change_id?: string;
  hlc: string | null;
  invocation: string | null;
  bytes?: Uint8Array | null;
};

function oneChunk(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/**
 * held 줄의 변경이 이미 이 기계의 data에 있는가: 내보내기가 그 자리에서 held로 바꾼 이 기계의 줄(computer, rewind, 폰에서
 * 받아 적용한 device 줄)이다. 받고 적용하지 않은 변경의 줄(`held()`)은 origin이 machine이거나 invocation 없는 device다.
 */
export function heldInData(row: {
  origin: string;
  invocation: string | null;
}): boolean {
  return (
    row.origin === "computer" ||
    row.origin === "rewind" ||
    (row.origin === "device" && row.invocation !== null)
  );
}

function rowOf(row: Record<string, SqlParam>): SyncLogRow {
  const hash = row["changeset_hash"];
  return {
    seq: Number(row["seq"]),
    release: String(row["release"]),
    destination:
      row["destination"] === null ? null : String(row["destination"]),
    kind: row["kind"] as SyncLogRow["kind"],
    origin: row["origin"] as SyncOrigin,
    device: row["device"] === null ? null : String(row["device"]),
    machine: row["machine"] === null ? null : String(row["machine"]),
    hlc: row["hlc"] === null ? null : String(row["hlc"]),
    changeset:
      hash === null
        ? null
        : { hash: String(hash), size: Number(row["changeset_size"]) },
    invocation: row["invocation"] === null ? null : String(row["invocation"]),
  };
}

function insertRow(tx: Tx, row: Append, blob: PreparedBlob | null): number {
  const inserted = tx.sql.run(
    `INSERT INTO app_sync_log
       (app, release, destination, kind, origin, device, machine, change_id, hlc, changeset_hash, changeset_size,
        invocation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.app,
      row.release,
      row.destination ?? null,
      row.kind,
      row.origin,
      row.device ?? null,
      row.machine ?? null,
      row.change_id ?? null,
      row.hlc,
      blob?.hash ?? null,
      blob?.size_bytes ?? null,
      row.invocation,
      tx.now(),
    ],
  );
  return Number(inserted.lastInsertRowid);
}

// 이 기계의 write·rewind changeset을 줄로 나눈다. 폰 앱(폰 길이 모든 표를 맞춘다)과 sync 앱이 아닌 release는 destination이
// 없는 줄 하나에 그대로 담는다. 그 밖에는 destination마다 그리 보내는 표의 구간이고, 담을 것이 없는 destination은 빠진다.
// bytes가 없거나(너무 큼) 깨졌으면 destination이 없는 줄 하나로 두어 그 줄이 지금처럼('다시 snapshot') 다뤄진다.
function splitByDestination(
  plan: SyncPlan | null,
  bytes: Uint8Array | null,
): { destination: string | null; bytes: Uint8Array | null }[] {
  if (plan === null || bytes === null || plan.phone) {
    return [{ destination: null, bytes }];
  }
  const parts: { destination: string; bytes: Uint8Array }[] = [];
  for (const destination of sendsTo(plan)) {
    const sent = sentTables(plan, destination);
    const kept = sent === null ? ok(bytes) : filterChangeset(bytes, sent);
    if (!kept.ok) return [{ destination: null, bytes }];
    if (kept.value.length > 0) parts.push({ destination, bytes: kept.value });
  }
  return parts;
}

export function createSyncLog(deps: SyncLogDeps): SyncLog {
  async function append(row: Append): Promise<Result<number>> {
    let blob: PreparedBlob | null = null;
    if (row.kind === "change" || row.kind === "held") {
      const bytes = row.bytes ?? null;
      const prepared =
        bytes !== null &&
        bytes.length > 0 &&
        bytes.length <= CHANGESET_MAX_BYTES
          ? await deps.blobs.prepare(oneChunk(bytes))
          : null;
      if (prepared?.ok) blob = prepared.value;
      else if (row.kind === "held") {
        return prepared === null
          ? err({
              code: "invalid_input",
              message: "a held change has no bytes or is too large",
            })
          : prepared;
      } else return append({ ...row, kind: "snapshot", bytes: null });
    }
    const done = deps.transaction((tx) => {
      const seq = insertRow(tx, row, blob);
      if (blob !== null) {
        const registered = tx.registerBlobRef({
          owner_kind: SYNC_LOG_OWNER_KIND,
          owner_key: String(seq),
          field: SYNC_LOG_FIELD_NAME,
          registered_seq: headSeq(tx.sql),
          source: { kind: "prepared", blob: { ...blob } },
        });
        if (!registered.ok) return registered;
      }
      return ok(seq);
    });
    if (!done.ok && blob !== null && row.kind === "change") {
      return append({ ...row, kind: "snapshot", bytes: null });
    }
    if (done.ok) deps.changed(row.app, row.release, done.value);
    return done;
  }

  function heldList(app: string): SyncLogRow[] {
    return deps.sql
      .all(
        `SELECT * FROM app_sync_log
         WHERE app = ? AND kind = 'held' AND resolved_at IS NULL ORDER BY seq`,
        [app],
      )
      .map(rowOf);
  }

  // 다른 기계에서 온 일의 줄은 그 기계를 적고, change_id는 그 invocation이다(같은 기계의 변경 id인 십진 seq와 겹치지 않고
  // 같은 변경을 다시 받을 때 duplicate로 오인되지 않는다).
  function marker(inv: AppInvocation): Promise<Result<number>> {
    const caller = inv.caller;
    const from =
      caller !== null && caller.kind === "person"
        ? (caller.machine ?? null)
        : null;
    return append({
      app: inv.app,
      release: inv.release,
      kind: "snapshot",
      ...(from === null
        ? { origin: "computer" as const }
        : { origin: "machine" as const, machine: from, change_id: inv.id }),
      hlc: null,
      invocation: inv.id,
    });
  }

  return {
    duplicate(device, id) {
      const row = deps.sql.get(
        "SELECT seq FROM app_sync_log WHERE device = ? AND change_id = ?",
        [device, id],
      );
      return ok(row === undefined ? null : Number(row["seq"]));
    },

    duplicateFrom(machine, id) {
      const row = deps.sql.get(
        "SELECT seq FROM app_sync_log WHERE machine = ? AND change_id = ?",
        [machine, id],
      );
      return ok(row === undefined ? null : Number(row["seq"]));
    },

    async written(inv, hlc, bytes) {
      if (hlc === undefined) return;
      const parts = splitByDestination(deps.plan(inv.app, inv.release), bytes);
      if (parts.length === 0) {
        await append({
          app: inv.app,
          release: inv.release,
          kind: "skipped",
          origin: "computer",
          hlc,
          invocation: inv.id,
        });
        return;
      }
      for (const part of parts) {
        await append({
          app: inv.app,
          release: inv.release,
          destination: part.destination,
          kind: "change",
          origin: "computer",
          hlc,
          invocation: inv.id,
          bytes: part.bytes,
        });
      }
    },

    async unknown(inv) {
      if (inv.effect === "read" || deps.plan(inv.app, inv.release) === null)
        return;
      await marker(inv);
    },

    phone(inv, change, status) {
      return append({
        app: inv.app,
        release: inv.release,
        kind: status === "applied" ? "change" : "skipped",
        origin: "device",
        device: change.device,
        change_id: change.id,
        hlc: change.hlc,
        invocation: inv.id,
        bytes: change.changeset,
      });
    },

    machine(inv, change, status) {
      return append({
        app: inv.app,
        release: inv.release,
        destination: change.destination,
        kind: status === "applied" ? "change" : "skipped",
        origin: "machine",
        machine: change.machine,
        change_id: change.id,
        hlc: change.hlc,
        invocation: inv.id,
        bytes: change.changeset,
      });
    },

    merged: marker,

    held(app, release, change) {
      return append({
        app,
        release,
        destination: change.destination ?? null,
        kind: "held",
        origin: change.origin,
        device: change.device,
        machine: change.machine,
        change_id: change.id,
        hlc: change.hlc,
        invocation: null,
        bytes: change.changeset,
      });
    },

    async rewound(app, release, effective, hlc) {
      // 되돌린 것이 모두 이 기계에만 있는 표면 줄이 없다. 폰도 폴더도 받을 것이 없다.
      for (const part of splitByDestination(
        deps.plan(app, release),
        effective,
      )) {
        await append({
          app,
          release,
          destination: part.destination,
          kind: "change",
          origin: "rewind",
          hlc,
          invocation: null,
          bytes: part.bytes,
        });
      }
    },

    head(app) {
      const row = deps.sql.get(
        "SELECT COALESCE(MAX(seq), 0) AS head FROM app_sync_log WHERE app = ?",
        [app],
      );
      return Number(row?.["head"] ?? 0);
    },

    snapshotNeeded(app, after) {
      return (
        deps.sql.get(
          `SELECT 1 FROM app_sync_log
           WHERE app = ? AND kind = 'snapshot' AND seq > ? LIMIT 1`,
          [app, after],
        ) !== undefined
      );
    },

    page(app, after, limit) {
      return deps.sql
        .all(
          `SELECT * FROM app_sync_log WHERE app = ? AND seq > ?
           ORDER BY seq LIMIT ?`,
          [app, after, limit],
        )
        .map(rowOf);
    },

    async readChangeset(hash, size) {
      const bytes = new Uint8Array(size);
      let offset = 0;
      while (offset < size) {
        const chunk = await deps.blobs.read(
          hash,
          offset,
          Math.min(BLOB_READ_MAX_BYTES, size - offset),
        );
        if (!chunk.ok) return chunk;
        if (chunk.value.hash !== hash || chunk.value.bytes.length === 0) {
          return err({
            code: "unavailable",
            message: "changeset is unreadable",
          });
        }
        bytes.set(chunk.value.bytes, offset);
        offset += chunk.value.bytes.length;
      }
      return ok(bytes);
    },

    heldList,

    heldInData(app, destination) {
      return heldList(app).filter(
        (row) =>
          heldInData(row) &&
          (destination === undefined ||
            row.destination === null ||
            row.destination === destination),
      ).length;
    },

    hold(seq) {
      return deps.transaction((tx) => {
        tx.sql.run(
          "UPDATE app_sync_log SET kind = 'held' WHERE seq = ? AND kind = 'change'",
          [seq],
        );
        return ok(undefined);
      });
    },

    resolve(seq, at) {
      return deps.transaction((tx) => {
        const updated = tx.sql.run(
          "UPDATE app_sync_log SET resolved_at = ? WHERE seq = ? AND kind = 'held'",
          [at, seq],
        );
        return Number(updated.changes) === 0
          ? err({ code: "not_found", message: "no held change has this seq" })
          : ok(undefined);
      });
    },

    prune(app, keep) {
      let marked: number | null = null;
      const done = deps.transaction((tx) => {
        // held 줄은 release가 바뀌어도 남는다: 아직 아무 데도 적용하지 않은 사람의 변경이다.
        const seqs = tx.sql
          .all(
            "SELECT seq FROM app_sync_log WHERE app = ? AND release <> ? AND kind <> 'held'",
            [app, keep],
          )
          .map((row) => String(row["seq"]));
        if (seqs.length === 0) return ok(undefined);
        const erased = eraseBlobRefs(tx, SYNC_LOG_OWNER_KIND, seqs);
        if (!erased.ok) return erased;
        tx.sql.run(
          "DELETE FROM app_sync_log WHERE app = ? AND release <> ? AND kind <> 'held'",
          [app, keep],
        );
        // 지운 줄을 받지 못한 폰이 같은 release로 돌아와도(옛 release를 다시 올림) 빈 곳을 건너뛰지 않게 한다.
        marked = insertRow(
          tx,
          {
            app,
            release: keep,
            kind: "snapshot",
            origin: "computer",
            hlc: null,
            invocation: null,
          },
          null,
        );
        return ok(undefined);
      });
      if (done.ok && marked !== null) deps.changed(app, keep, marked);
      return Promise.resolve(done);
    },

    async backfill(app) {
      const active = deps.activeRelease(app);
      if (!active.ok) return active;
      const release = active.value;
      if (release === null || deps.plan(app, release) === null) return ok(0);
      const listed = deps.ledger.list({ app, release, mode: "live" });
      if (!listed.ok) return listed;
      const logged = new Set(
        deps.sql
          .all(
            "SELECT invocation FROM app_sync_log WHERE app = ? AND invocation IS NOT NULL",
            [app],
          )
          .map((row) => String(row["invocation"])),
      );
      const missing = listed.value
        .filter(
          (inv) =>
            inv.effect !== "read" &&
            (inv.changeset !== null || inv.status === "unknown") &&
            !logged.has(inv.id),
        )
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const inv of missing) {
        const marked = await marker(inv);
        if (!marked.ok) return marked;
      }
      return ok(missing.length);
    },
  };
}

/** 앱을 지울 때 그 앱의 sync log 줄과 blob 참조를 지운다. app.delete의 Tx 안에서 부른다. */
export function eraseSyncLog(tx: Tx, app: string): Result<void> {
  const seqs = tx.sql
    .all("SELECT seq FROM app_sync_log WHERE app = ?", [app])
    .map((row) => String(row["seq"]));
  const erased = eraseBlobRefs(tx, SYNC_LOG_OWNER_KIND, seqs);
  if (!erased.ok) return erased;
  tx.sql.run("DELETE FROM app_sync_log WHERE app = ?", [app]);
  return ok(undefined);
}
