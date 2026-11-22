// 앱 기록 `app.json`. 내용이 바뀔 때만 `revision`을 올려 다시 쓴다. 바뀌었는지는 앞서 쓴 revision·updated_at으로 지금
// 내용을 다시 만들어 그때의 sha256과 견준다(쓴 bytes를 따로 두지 않는다).
import { ok, type Result, sha256Hex } from "../../../base/mod.ts";
import {
  type AppRecord,
  appRecordPath,
  appRecordSchema,
  encodeRecord,
  FOLDER_FORMAT,
} from "../../../protocol/folder/mod.ts";
import type { FolderAppProgress } from "./deps.ts";
import { recordWritten, setStream, streamOf, written } from "./state.ts";
import type { Target } from "./target.ts";

export async function writeAppRecord(
  target: Target,
  progress: FolderAppProgress,
): Promise<Result<void>> {
  const { app, me, sql, destination } = target;
  const data = streamOf(sql, me, app.app, destination, "data");
  const source = streamOf(sql, me, app.app, destination, "source");
  const body: Omit<AppRecord, "revision" | "updated_at"> = {
    format: FOLDER_FORMAT.version,
    machine: me,
    app: app.app,
    slug: app.slug,
    name: app.name,
    description: app.description,
    // 앱 기록의 칸 이름은 옛 lophn이 읽는 그대로다(그 판은 이 칸이 없는 기록을 읽지 못한다). 값은 이 destination이 그 앱의
    // 표를 받으면 이 destination 이름이고, source와 기록만 받으면 null이다.
    sync_to: app.sends_to.includes(destination) ? destination : null,
    active_release:
      app.release === null
        ? null
        : {
            code_commit: app.release.code_commit,
            data_schema: app.release.data_schema,
            created_at: app.release.created_at,
          },
    data: {
      head: data === null ? 0 : data.next_n - 1,
      snapshot: data?.last_snapshot_n ?? null,
    },
    source: { head: source === null ? 0 : source.next_n - 1 },
    read: progress.read,
    settled: progress.settled,
    horizon: progress.horizon,
  };
  const path = appRecordPath(me, app.app);
  const before = written(sql, me, destination, path);
  if (before !== null && before.n !== null) {
    const same = encodeRecord(appRecordSchema, {
      ...body,
      revision: before.n,
      updated_at: before.written_at,
    });
    if ((await sha256Hex(same)) === before.sha256) return ok(undefined);
  }
  const revision = (before?.n ?? 0) + 1;
  const at = target.now();
  const bytes = encodeRecord(appRecordSchema, {
    ...body,
    revision,
    updated_at: at,
  });
  const done = await target.writer.writeFile(path, bytes);
  if (!done.ok) return done;
  recordWritten(sql, {
    machine: me,
    destination,
    path,
    app: app.app,
    stream: "app",
    n: revision,
    sha256: await sha256Hex(bytes),
    size: bytes.byteLength,
    at,
  });
  setStream(
    sql,
    { machine: me, app: app.app, destination, stream: "app" },
    { next_n: revision + 1, written_at: at },
  );
  return ok(undefined);
}
