// 앱 하나의 destination 하나의 data stream을 따라잡는다. 번호는 stream마다 1부터 빈틈없이 늘고, 쓴 번호는 다시 쓰지 않는다.
// 한 앱이 표마다 다른 destination으로 보내면 stream이 destination마다 따로 있고, 모두 같은 sync log를 읽되 자기 destination의
// 줄(과 destination이 없는 줄)만 내보낸다. hold와 held·snapshot 막기도 그 줄만 본다.
// 쓰기 순서: file bytes의 sha256을 먼저 구해 `folder_written`에 의도로 적고(이때 stream의 next_n은 그대로다), writer로
// temp에 쓰고 rename한 뒤, 한 transaction에서 next_n과 last_seq를 올린다. 그래서 next_n 이상 번호의 `folder_written` 행은
// 끝나지 않은 의도다: 다시 돌 때 그 file이 같은 sha256이면 끝난 것으로 적고, 없으면 의도를 지우고, 다르면 남의 writer다.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  filterChangeset,
  ok,
  type RandomSource,
  type Result,
  sha256Hex,
} from "../../../base/mod.ts";
import { appFolder } from "../../../protocol/apps/app-storage.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  CHANGES_FILE_MAX_COUNT,
  CHANGES_PAYLOAD_MAX_BYTES,
  type ChangeMeta,
  COMPACTION_KEEP_MS,
  CONTAINER_HEAD_MAX_BYTES,
  containerPrefix,
  type DataKind,
  dataDir,
  dataEntryPath,
  encodeChanges,
  type FolderError,
  type FolderErrorCode,
  readContainerHead,
  RUN_MAX_BYTES,
  SNAPSHOT_PAYLOAD_MAX_BYTES,
} from "../../../protocol/folder/mod.ts";
import {
  CARRY_DATA_FILES_MAX,
  COMPUTERS_DESTINATION,
} from "../../../protocol/remote/carry.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import {
  createFolderReader,
  createFolderWriter,
  type FolderReader,
} from "../fs.ts";
import type { FolderLogRow } from "../ports.ts";
import { compact } from "./compact.ts";
import type { ExportApp, ExportOutcome, FolderExportDeps } from "./mod.ts";
import {
  ensureStream,
  readStream,
  type StreamKey,
  type StreamRow,
  updateStream,
  writtenRows,
} from "./status.ts";

const PAGE = 500;
// snapshot 사본을 뜨는 앱 폴더 아래 임시 폴더(destination마다). 뜨기 전에 비워 앞서 죽은 run이 남긴 것을 지운다.
const TEMP_DIR = "folder-export";

type ExportOrigin = ChangeMeta["origin"];
const EXPORT_ORIGINS = new Set<string>(["computer", "device", "rewind"]);

type ReleaseKey = { code_commit: string; data_schema: number };

// 이번 run이 snapshot을 쓸 까닭. required는 그것 없이 stream을 이을 수 없다(첫 file, release가 바뀜, bytes로 남지 못한 자기
// 변경). compaction은 30일 지난 snapshot을 새로 써 옛 file을 지우려는 것이라 미뤄도 된다.
type SnapshotNeed = "required" | "compaction";

// ok(true)는 계속, ok(false)는 이번 run을 멈춘다(까닭은 outcome의 error나 more).
type Step = Result<boolean>;

function hex16(random: RandomSource): string {
  const bytes = new Uint8Array(8);
  random.fill(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function fileSha256(
  reader: FolderReader,
  rel: string,
): Promise<string | null> {
  const read = await reader.readStream(rel, 0);
  if (!read.ok) return null;
  const hash = createHash("sha256");
  for await (const chunk of read.value.chunks) hash.update(chunk);
  return hash.digest("hex");
}

function maxOf(values: bigint[]): bigint | null {
  return values.reduce<bigint | null>(
    (max, value) => (max === null || value > max ? value : max),
    null,
  );
}

export function createStreams(deps: FolderExportDeps) {
  // 앱마다 log에서 본 가장 큰 hlc. core가 다시 뜨면 처음 한 번 log를 끝까지 읽는다.
  const logMax = new Map<string, { seq: number; hlc: bigint | null }>();

  function maxHlc(app: string): bigint | null {
    let seen = logMax.get(app) ?? { seq: 0, hlc: null };
    for (;;) {
      const rows = deps.log.page(app, seen.seq, PAGE);
      if (rows.length === 0) break;
      const hlc = maxOf([
        ...(seen.hlc === null ? [] : [seen.hlc]),
        ...rows.flatMap((row) => (row.hlc === null ? [] : [BigInt(row.hlc)])),
      ]);
      seen = { seq: rows.at(-1)!.seq, hlc };
    }
    logMax.set(app, seen);
    return seen.hlc;
  }

  async function runStream(
    appId: Id<"app">,
    name: string,
  ): Promise<Result<ExportOutcome>> {
    const outcome: ExportOutcome = {
      files: 0,
      bytes: 0,
      held: 0,
      more: false,
      error: null,
    };
    const app = deps.apps().find((each) => each.app === appId);
    if (
      app === undefined ||
      app.release === null ||
      !app.destinations.includes(name)
    ) {
      return ok(outcome);
    }
    const destination = deps.destinations.resolve(name);
    if (destination === null) return ok(outcome);
    const me = deps.machine().id;
    const key: StreamKey = {
      machine: me,
      app: app.app,
      destination: name,
      stream: "data",
    };
    const sticky = readStream(deps.sql, key)?.error;
    // 알아채지 못한 복제가 같은 하위 폴더에 쓰고 있다. 사람이 볼 때까지 다시 쓰지 않는다.
    if (sticky?.code === "foreign_writer")
      return ok({ ...outcome, error: sticky });
    const run = new Run(deps, app, app.release, key, outcome, maxHlc);
    if (destination.state === "missing") {
      return run.fail(
        "destination_missing",
        `The sync folder "${name}" is missing at ${destination.path}`,
      );
    }
    if (destination.state === "not_writable") {
      return run.fail(
        "not_writable",
        `The sync folder "${name}" at ${destination.path} is not writable`,
      );
    }
    const done = await run.go(destination.path);
    return done.ok ? ok(outcome) : done;
  }

  return {
    runStream,
    forget(app: string) {
      logMax.delete(app);
    },
  };
}

class Run {
  private reader!: FolderReader;
  private writer!: ReturnType<typeof createFolderWriter>;
  private cursor = 0;
  private batch: {
    release: string;
    key: ReleaseKey;
    changes: { meta: ChangeMeta; bytes: Uint8Array }[];
    size: number;
  } | null = null;

  private readonly deps: FolderExportDeps;
  private readonly app: ExportApp;
  private readonly release: NonNullable<ExportApp["release"]>;
  private readonly key: StreamKey;
  private readonly outcome: ExportOutcome;
  private readonly maxHlc: (app: string) => bigint | null;
  // horizon 밖이면 이 clock 이하의 아직 내보내지 않은 자기 변경은 내보내지 않고 held로 바꾼다.
  private holdUpTo: bigint | null = null;

  constructor(
    deps: FolderExportDeps,
    app: ExportApp,
    release: NonNullable<ExportApp["release"]>,
    key: StreamKey,
    outcome: ExportOutcome,
    maxHlc: (app: string) => bigint | null,
  ) {
    this.deps = deps;
    this.app = app;
    this.release = release;
    this.key = key;
    this.outcome = outcome;
    this.maxHlc = maxHlc;
  }

  private state(): StreamRow | null {
    return readStream(this.deps.sql, this.key);
  }

  private tx(fn: (sql: Sql) => void): Result<void> {
    return this.deps.transaction((tx) => {
      fn(tx.sql);
      return ok(undefined);
    });
  }

  fail(code: FolderErrorCode, message: string): Result<ExportOutcome> {
    const error: FolderError = { code, message, at: this.deps.clock.now() };
    const saved = this.tx((sql) => updateStream(sql, this.key, { error }));
    if (!saved.ok) return saved;
    this.outcome.error = error;
    return ok(this.outcome);
  }

  private stop(code: FolderErrorCode, message: string): Step {
    const failed = this.fail(code, message);
    return failed.ok ? ok(false) : failed;
  }

  async go(root: string): Promise<Result<void>> {
    const { deps, app, key } = this;
    this.reader = createFolderReader(root);
    this.writer = createFolderWriter({
      root,
      machine: key.machine,
      random: deps.random,
    });

    let step = await this.recover();
    if (step.ok && step.value) step = await this.checkForeign();
    if (!step.ok) return step;
    if (!step.value) return ok(undefined);

    const before = this.state();
    const peer = maxOf(
      deps
        .peerHorizons(app.app, key.destination)
        .map((each) => BigInt(each.horizon)),
    );
    const settled = before?.settled == null ? null : BigInt(before.settled);
    // 이 기계가 다른 기계의 horizon 밖이면, 그 이하 clock의 아직 내보내지 않은 변경은 정리된 흔적과 부딪힐 수 있다.
    // 내보내지도 버리지도 않고 held 줄로 바꾼다. 한 번도 settled가 없던 기계도 같다(옛 변경을 가졌을 수 있다).
    this.holdUpTo =
      peer !== null && (settled === null || settled < peer) ? peer : null;

    this.cursor = before?.last_seq ?? 0;
    const due = this.snapshotDue(before);
    if (due !== null) {
      step = await this.snapshot(due);
      if (!step.ok) return step;
      if (!step.value) return ok(undefined);
    }
    step = await this.follow();
    if (!step.ok) return step;
    if (!step.value) return ok(undefined);
    return this.settle(peer);
  }

  // log의 '다시 snapshot' 줄은 follow가 만나 snapshot을 쓴다(다른 기계에서 온 일의 줄은 건너뛴다).
  private snapshotDue(state: StreamRow | null): SnapshotNeed | null {
    const { deps, app, release } = this;
    if (
      state === null ||
      state.last_snapshot_n === null ||
      state.code_commit !== release.code_commit
    ) {
      return "required";
    }
    // 마지막 snapshot이 오래되면 새로 써서 그 앞 file을 compaction할 수 있게 한다. 새 변경이 없으면 쓰지 않는다.
    if (deps.log.head(app.app) <= state.last_seq) return null;
    // `computers`의 앱 목록(files.json)은 마지막 snapshot 뒤 file을 다 싣는다. 너무 많아지기 전에 snapshot을 일찍 쓴다.
    if (
      this.key.destination === COMPUTERS_DESTINATION &&
      state.next_n - 1 - state.last_snapshot_n >= CARRY_DATA_FILES_MAX
    ) {
      return "compaction";
    }
    const last = writtenRows(deps.sql, this.key).find(
      (row) => row.n === state.last_snapshot_n,
    );
    return last !== undefined &&
      Date.parse(last.written_at) <= deps.clock.nowMs() - COMPACTION_KEEP_MS
      ? "compaction"
      : null;
  }

  // 이 stream이 내보내는 줄: 이 destination의 줄과 destination이 없는 줄. 다른 destination의 줄은 그 stream이 맡는다.
  private mine(row: FolderLogRow): boolean {
    return row.destination === null || row.destination === this.key.destination;
  }

  // hold 규칙에 걸리는 줄: 아직 내보내지 않은 이 기계의 변경 가운데 clock이 horizon 이하인 것.
  private covered(row: FolderLogRow): boolean {
    return (
      this.holdUpTo !== null &&
      this.mine(row) &&
      row.kind === "change" &&
      EXPORT_ORIGINS.has(row.origin) &&
      row.hlc !== null &&
      BigInt(row.hlc) <= this.holdUpTo
    );
  }

  // 줄의 changeset에서 그 줄의 release가 이 destination으로 보내는 표의 구간. 폰 앱의 줄은 폰만 받는 표도 담는다. bytes가
  // 없는 줄은 null이다.
  private async sentPart(
    row: FolderLogRow,
  ): Promise<Result<Uint8Array | null>> {
    if (row.changeset === null) return ok(null);
    const bytes = await this.deps.log.readChangeset(
      row.changeset.hash,
      row.changeset.size,
    );
    if (!bytes.ok) return bytes;
    const sent = this.deps.sentOf(row.release, this.key.destination);
    return sent === null ? bytes : filterChangeset(bytes.value, sent);
  }

  // cursor 뒤의 모든 줄에 hold 규칙을 건다. snapshot은 그 seq까지의 줄을 건너뛰므로 snapshot 앞에 한다. 보내는 표가 없는
  // 줄은 폴더로 가지 않으니 붙들지 않는다.
  private async holdPast(): Promise<Result<void>> {
    const { deps, app } = this;
    if (this.holdUpTo === null) return ok(undefined);
    let after = this.cursor;
    for (;;) {
      const rows = deps.log.page(app.app, after, PAGE);
      if (rows.length === 0) return ok(undefined);
      for (const row of rows) {
        if (!this.covered(row)) continue;
        const sent = await this.sentPart(row);
        if (!sent.ok) return sent;
        if (sent.value !== null && sent.value.length === 0) continue;
        const held = deps.log.hold(row.seq);
        if (!held.ok) return held;
        this.outcome.held += 1;
      }
      after = rows.at(-1)!.seq;
    }
  }

  // held로 바꾼 자기 변경은 앱 DB에 그대로 있어 snapshot에 실린다. 사람이 풀기 전에는 snapshot을 쓰지 않고, 그것 없이
  // 이을 수 없는 stream은 멈춘 채 사람에게 그 까닭을 보인다.
  private heldStop(count: number): Step {
    const { deps, app } = this;
    const error: FolderError = {
      code: "away_too_long",
      message: `${count} ${count === 1 ? "change" : "changes"} of ${app.name} made on this computer ${count === 1 ? "is" : "are"} held. lophn cannot send a full copy of its data to the sync folder until ${count === 1 ? "it is" : "they are"} applied or discarded (lophn app sync-held).`,
      at: deps.clock.now(),
    };
    const away =
      this.holdUpTo !== null && this.state()?.away_since == null
        ? { away_since: deps.clock.now() }
        : {};
    const saved = this.tx((sql) =>
      updateStream(sql, this.key, { error, ...away }),
    );
    if (!saved.ok) return saved;
    this.outcome.error = error;
    return ok(false);
  }

  // 의도만 있고 끝나지 않은 번호를 맞춘다.
  private async recover(): Promise<Step> {
    const state = this.state();
    if (state === null) return ok(true);
    const pending = writtenRows(this.deps.sql, this.key).filter(
      (row) => row.n >= state.next_n,
    );
    for (const row of pending) {
      const head = await this.reader.readHead(
        row.path,
        CONTAINER_HEAD_MAX_BYTES,
      );
      if (!head.ok && head.error.code === "not_found") {
        // rename 전에 멈췄다. 그 번호는 아직 아무도 보지 않았다.
        const dropped = this.tx((sql) =>
          sql.run(
            "DELETE FROM folder_written WHERE machine = ? AND destination = ? AND path = ?",
            [this.key.machine, this.key.destination, row.path],
          ),
        );
        if (!dropped.ok) return dropped;
        continue;
      }
      if (!head.ok) {
        return this.stop(
          "not_writable",
          `Could not read ${row.path}: ${head.error.message}`,
        );
      }
      const parsed = await readContainerHead(head.value.bytes, row.path);
      if (
        head.value.size !== row.size ||
        !parsed.ok ||
        (await fileSha256(this.reader, row.path)) !== row.sha256
      ) {
        return this.foreign(row.path);
      }
      const header = parsed.value.header;
      // snapshot이 담은 seq는 file에 없다: last_seq를 그대로 두면 그 뒤 변경이 다음 file로 한 번 더 나간다(받는 쪽은 같은
      // 변경 id를 한 번만 적용한다).
      const finish: Partial<StreamRow> =
        header.kind === "changes"
          ? {
              last_seq: Math.max(
                state.last_seq,
                ...header.changes.map((change) => Number(change.id)),
              ),
            }
          : { last_snapshot_n: row.n, code_commit: header.release.code_commit };
      const done = this.tx((sql) =>
        updateStream(sql, this.key, {
          ...finish,
          next_n: row.n + 1,
          written_at: row.written_at,
        }),
      );
      if (!done.ok) return done;
    }
    return ok(true);
  }

  private foreign(path: string): Step {
    return this.stop(
      "foreign_writer",
      `${path} in this machine's sync folder was not written by this machine. Another copy of this machine may be writing here; export of this app is stopped until a person looks.`,
    );
  }

  // 자기 하위 폴더에 자기가 쓰지 않은 번호나 크기가 다른 file이 있으면 멈춘다. 모든 file을 매번 hash하지 않고 크기만 본다
  // (snapshot은 1 GiB까지다). 끝나지 않은 의도는 recover가 hash로 본다.
  private async checkForeign(): Promise<Step> {
    const dir = dataDir(this.key.machine, this.app.app);
    const names = await this.reader.list(dir);
    if (!names.ok) {
      return this.stop(
        "not_writable",
        `Could not list ${dir}: ${names.error.message}`,
      );
    }
    const known = new Map(
      writtenRows(this.deps.sql, this.key).map((row) => [row.path, row]),
    );
    for (const name of names.value) {
      const rel = `${dir}/${name}`;
      const row = known.get(rel);
      if (row === undefined) return this.foreign(rel);
      const head = await this.reader.readHead(rel, 0);
      if (head.ok && head.value.size !== row.size) return this.foreign(rel);
    }
    return ok(true);
  }

  private async put(
    n: number,
    kind: DataKind,
    sha256: string,
    size: number,
    body: Uint8Array | (() => AsyncIterable<Uint8Array>),
    finish: Partial<StreamRow>,
  ): Promise<Step> {
    const { deps, key } = this;
    const rel = dataEntryPath(key.machine, this.app.app, n, kind);
    const intent = this.tx((sql) => {
      ensureStream(sql, key);
      sql.run(
        `INSERT INTO folder_written (machine, destination, path, app, stream, n, sha256, size, written_at)
         VALUES (?, ?, ?, ?, 'data', ?, ?, ?, ?)`,
        [
          key.machine,
          key.destination,
          rel,
          key.app,
          n,
          sha256,
          size,
          deps.clock.now(),
        ],
      );
    });
    if (!intent.ok) return intent;
    const written =
      body instanceof Uint8Array
        ? await this.writer.writeFile(rel, body)
        : await this.writer.writeStream(rel, body());
    if (!written.ok) {
      // writer는 실패하면 temp를 지우고 rename하지 않는다. 그 번호는 아무도 보지 않았다.
      const dropped = this.tx((sql) =>
        sql.run(
          "DELETE FROM folder_written WHERE machine = ? AND destination = ? AND path = ?",
          [key.machine, key.destination, rel],
        ),
      );
      if (!dropped.ok) return dropped;
      return this.stop(
        "not_writable",
        `Could not write ${rel}: ${written.error.message}`,
      );
    }
    const now = deps.clock.now();
    const done = this.tx((sql) => {
      sql.run(
        "UPDATE folder_written SET written_at = ? WHERE machine = ? AND destination = ? AND path = ?",
        [now, key.machine, key.destination, rel],
      );
      updateStream(sql, key, {
        ...finish,
        next_n: n + 1,
        written_at: now,
        error: null,
      });
    });
    if (!done.ok) return done;
    this.outcome.files += 1;
    this.outcome.bytes += size;
    return ok(true);
  }

  private async snapshot(need: SnapshotNeed): Promise<Step> {
    const { deps, app, release } = this;
    if (this.outcome.bytes >= RUN_MAX_BYTES) {
      this.outcome.more = true;
      return ok(false);
    }
    const passed = await this.holdPast();
    if (!passed.ok) return passed;
    const inData = deps.log.heldInData(app.app, this.key.destination);
    if (inData > 0)
      return need === "required" ? this.heldStop(inData) : ok(true);
    const dir = join(
      appFolder(deps.dataRoot, app.app),
      TEMP_DIR,
      this.key.destination,
    );
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const temp = join(dir, `${hex16(deps.random)}.sqlite`);
    try {
      const taken = await deps.snapshotAt(app.app, this.key.destination, temp);
      if (!taken.ok) {
        return taken.error.code === "unavailable"
          ? this.stop(
              "app_not_running",
              `${app.name} is not running, so its data could not be copied`,
            )
          : taken;
      }
      // 기다리는 사이 activation이 release를 바꿨으면 이 사본의 release를 모른다. 다음 run이 다시 뜬다.
      const now = deps.apps().find((each) => each.app === app.app);
      if (
        now?.release?.code_commit !== release.code_commit ||
        !now.destinations.includes(this.key.destination)
      ) {
        return ok(false);
      }
      const size = (await stat(temp)).size;
      if (size > SNAPSHOT_PAYLOAD_MAX_BYTES) {
        return this.stop(
          "too_large",
          `The data of ${app.name} for "${this.key.destination}" is over 1 GiB and cannot go to the sync folder`,
        );
      }
      const previous = this.state()?.last_snapshot_n ?? null;
      const n = this.state()?.next_n ?? 1;
      const prefix = await containerPrefix({
        machine: this.key.machine,
        app: app.app,
        n,
        kind: "snapshot",
        release: {
          code_commit: release.code_commit,
          data_schema: release.data_schema,
        },
        created_at: deps.clock.now(),
        payload: { size, sha256: taken.value.sha256 },
      });
      if (!prefix.ok) return this.stop(prefix.error.code, prefix.error.message);
      const hash = createHash("sha256").update(prefix.value);
      for await (const chunk of createReadStream(temp))
        hash.update(chunk as Uint8Array);
      const head = prefix.value;
      const put = await this.put(
        n,
        "snapshot",
        hash.digest("hex"),
        head.byteLength + size,
        async function* () {
          yield head;
          for await (const chunk of createReadStream(temp))
            yield chunk as Uint8Array;
        },
        {
          last_seq: Math.max(this.cursor, taken.value.seq),
          last_snapshot_n: n,
          code_commit: release.code_commit,
        },
      );
      if (!put.ok || !put.value) return put;
      this.cursor = this.state()!.last_seq;
      if (previous !== null) {
        const compacted = await compact({
          sql: deps.sql,
          transaction: deps.transaction,
          writer: this.writer,
          key: this.key,
          before: previous,
          nowMs: deps.clock.nowMs(),
        });
        if (!compacted.ok) {
          return this.stop(
            "not_writable",
            `Could not remove old files: ${compacted.error.message}`,
          );
        }
      }
      return ok(true);
    } finally {
      await rm(temp, { force: true });
    }
  }

  private async flush(): Promise<Step> {
    const batch = this.batch;
    this.batch = null;
    if (batch === null) return ok(true);
    const n = this.state()?.next_n ?? 1;
    const encoded = await encodeChanges({
      machine: this.key.machine,
      app: this.app.app,
      n,
      release: batch.key,
      created_at: this.deps.clock.now(),
      changes: batch.changes,
    });
    if (!encoded.ok)
      return this.stop(encoded.error.code, encoded.error.message);
    return this.put(
      n,
      "changes",
      await sha256Hex(encoded.value),
      encoded.value.byteLength,
      encoded.value,
      { last_seq: this.cursor },
    );
  }

  // last_seq 뒤의 log 줄을 seq 순서로 내보낸다.
  private async follow(): Promise<Step> {
    const { deps, app } = this;
    for (;;) {
      const rows = deps.log.page(app.app, this.cursor, PAGE);
      if (rows.length === 0) break;
      let resnapshot = false;
      for (const row of rows) {
        // 다른 기계에서 온 일(받은 변경, snapshot 합치기)의 '다시 snapshot' 줄은 폰을 위한 것이다. 그 data는 그 기계가 이미
        // 냈으니 여기서 snapshot을 쓰면 두 기계가 서로의 snapshot을 합칠 때마다 snapshot을 주고받는다.
        if (row.kind === "snapshot" && row.origin === "machine") {
          this.cursor = row.seq;
          continue;
        }
        if (!this.mine(row)) {
          this.cursor = row.seq;
          continue;
        }
        if (row.kind === "snapshot") {
          resnapshot = true;
          break;
        }
        // 다른 기계에서 온 줄, 건너뛴 줄, held 줄은 다시 내보내지 않는다.
        if (row.kind !== "change" || !EXPORT_ORIGINS.has(row.origin)) {
          this.cursor = row.seq;
          continue;
        }
        const key = deps.releaseKey(row.release);
        // 주인의 release가 바뀐 뒤의 첫 file은 snapshot이다.
        if (
          row.hlc === null ||
          row.changeset === null ||
          key === null ||
          key.code_commit !== this.state()?.code_commit
        ) {
          resnapshot = true;
          break;
        }
        const bytes = await this.sentPart(row);
        if (!bytes.ok) return bytes;
        // 이 기계에만 있는 표만 바꾼 줄(폰 앱의 줄)이다. 폴더로 갈 것이 없다.
        if (bytes.value === null || bytes.value.length === 0) {
          this.cursor = row.seq;
          continue;
        }
        if (this.covered(row)) {
          const held = deps.log.hold(row.seq);
          if (!held.ok) return held;
          this.cursor = row.seq;
          this.outcome.held += 1;
          continue;
        }
        const origin = row.origin as ExportOrigin;
        const batch = this.batch;
        if (
          batch !== null &&
          (batch.release !== row.release ||
            batch.changes.length >= CHANGES_FILE_MAX_COUNT ||
            batch.size + bytes.value.byteLength > CHANGES_PAYLOAD_MAX_BYTES)
        ) {
          const flushed = await this.flush();
          if (!flushed.ok || !flushed.value) return flushed;
          if (this.outcome.bytes >= RUN_MAX_BYTES) {
            this.outcome.more = true;
            return ok(false);
          }
        }
        const operation =
          row.invocation === null ? null : deps.operationOf(row.invocation);
        this.batch ??= { release: row.release, key, changes: [], size: 0 };
        this.batch.changes.push({
          meta: {
            id: String(row.seq),
            hlc: row.hlc,
            origin,
            operation: operation?.name ?? null,
            started_at: operation?.started_at ?? null,
          },
          bytes: bytes.value,
        });
        this.batch.size += bytes.value.byteLength;
        this.cursor = row.seq;
      }
      if (resnapshot) {
        const flushed = await this.flush();
        if (!flushed.ok || !flushed.value) return flushed;
        const step = await this.snapshot("required");
        if (!step.ok || !step.value) return step;
      }
    }
    const flushed = await this.flush();
    if (!flushed.ok || !flushed.value) return flushed;
    // 끝의 건너뛴 줄까지 지났다.
    if (this.cursor > (this.state()?.last_seq ?? 0)) {
      const passed = this.tx((sql) =>
        updateStream(sql, this.key, { last_seq: this.cursor }),
      );
      if (!passed.ok) return passed;
    }
    return ok(true);
  }

  // 내보낼 것이 없고 모든 출처를 받았으면 settled를 log의 가장 큰 hlc로 올린다(내려가지 않는다).
  private settle(peer: bigint | null): Result<void> {
    const { deps, app } = this;
    const state = this.state();
    let settled = state?.settled == null ? null : BigInt(state.settled);
    if (
      (state?.last_seq ?? 0) >= deps.log.head(app.app) &&
      deps.readsCaughtUp(app.app, this.key.destination)
    ) {
      const max = this.maxHlc(app.app);
      if (max !== null && (settled === null || max > settled)) settled = max;
    }
    const away = peer !== null && settled !== null && settled < peer;
    return this.tx((sql) =>
      updateStream(sql, this.key, {
        settled: settled === null ? null : settled.toString(),
        away_since: away ? (state?.away_since ?? deps.clock.now()) : null,
        error: null,
      }),
    );
  }
}
