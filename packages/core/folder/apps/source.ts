// 앱 source를 기계마다의 증분 git bundle로 주고받는다(`source/<n>.bundle`, 그 뒤에 `<n>.json`).
// 내보내기: branch가 마지막으로 낸 heads와 다르고 새 commit이 있을 때만, 앞서 낸 heads와 다른 기계에서 받은 것을 빼고 쓴다.
// 받기: 번호 순서로 목록과 bytes를 검사하고 prerequisite가 이 저장소에 있을 때만 `refs/remotes/<mch>/*`로 fetch한다.
// 사람의 branch, HEAD, 작업 tree는 처음 저장소를 만들 때(main을 release의 commit에 둔다) 말고는 건드리지 않는다.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, rename, rm, stat } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  canonicalize,
  err,
  ok,
  type RandomSource,
  type Result,
  sha256Hex,
} from "../../../base/mod.ts";
import { appDefaultSource } from "../../../protocol/apps/app-storage.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  decodeRecord,
  encodeRecord,
  FOLDER_FORMAT,
  type FolderErrorCode,
  RECORD_MAX_BYTES,
  SOURCE_BUNDLE_MAX_BYTES,
  type SourceMeta,
  sourceMetaSchema,
  sourcePath,
} from "../../../protocol/folder/mod.ts";
import type { FolderReader } from "../fs.ts";
import {
  branchHeads,
  bundlePrerequisites,
  checkoutMain,
  createBundle,
  fetchBundle,
  git,
  hasCommit,
  initRepository,
  newCommitCount,
} from "./git.ts";
import { recordWritten, setStream, streamOf } from "./state.ts";
import type { Target } from "./target.ts";

export type SourceError = { code: FolderErrorCode; message: string };

const failed = (
  code: FolderErrorCode,
  message: string,
): Result<never, SourceError> => err({ code, message });

function hex16(random: RandomSource): string {
  const bytes = new Uint8Array(8);
  random.fill(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

// data root 아래의 임시 file. 폴더(바깥 도구가 옮긴다)에 반쯤 쓴 file을 두지 않으려고 여기서 만든 뒤 writer로 옮긴다.
async function tempFile(
  dataRoot: string,
  random: RandomSource,
): Promise<string> {
  const dir = `${dataRoot}/folder-tmp`;
  await mkdir(dir, { recursive: true });
  return `${dir}/source-${hex16(random)}.bundle`;
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function exportSource(
  target: Target,
): Promise<Result<void, SourceError>> {
  const { app, me, sql, destination } = target;
  const repo = app.source_path;
  if (repo === null) return ok(undefined);
  const heads = await branchHeads(repo);
  if (!heads.ok) return failed("apply_failed", heads.error.message);
  const n = streamOf(sql, me, app.app, destination, "source")?.next_n ?? 1;
  let before: SourceMeta | null = null;
  if (n > 1) {
    const read = await target.reader.read(
      sourcePath(me, app.app, n - 1, "json"),
      RECORD_MAX_BYTES,
    );
    if (!read.ok) return failed("invalid_file", read.error.message);
    const meta = decodeRecord(sourceMetaSchema, read.value);
    if (!meta.ok) return failed(meta.error.code, meta.error.message);
    before = meta.value;
  }
  if (
    before !== null &&
    canonicalize(before.heads) === canonicalize(heads.value)
  ) {
    return ok(undefined);
  }
  const excluded = Object.values(before?.heads ?? {});
  const count = await newCommitCount(repo, excluded);
  if (!count.ok) return failed("apply_failed", count.error.message);
  if (count.value === 0) return ok(undefined);
  const temp = await tempFile(target.dataRoot, target.random);
  try {
    const created = await createBundle(repo, temp, excluded);
    if (!created.ok) return failed("apply_failed", created.error.message);
    const size = (await stat(temp)).size;
    if (size > SOURCE_BUNDLE_MAX_BYTES) {
      return failed(
        "too_large",
        `the source bundle is ${size} bytes, over ${SOURCE_BUNDLE_MAX_BYTES}`,
      );
    }
    const prerequisites = await bundlePrerequisites(temp);
    if (!prerequisites.ok) {
      return failed("apply_failed", prerequisites.error.message);
    }
    const sha256 = await fileSha256(temp);
    const bundlePath = sourcePath(me, app.app, n, "bundle");
    const wrote = await target.writer.writeStream(
      bundlePath,
      createReadStream(temp),
    );
    if (!wrote.ok) return failed("not_writable", wrote.error.message);
    const at = target.now();
    const json = encodeRecord(sourceMetaSchema, {
      format: FOLDER_FORMAT.version,
      machine: me,
      app: app.app,
      n,
      heads: heads.value,
      prerequisites: prerequisites.value,
      size,
      sha256,
      created_at: at,
    });
    const jsonPath = sourcePath(me, app.app, n, "json");
    const listed = await target.writer.writeFile(jsonPath, json);
    if (!listed.ok) return failed("not_writable", listed.error.message);
    for (const [path, hash, bytes] of [
      [bundlePath, sha256, size],
      [jsonPath, await sha256Hex(json), json.byteLength],
    ] as const) {
      recordWritten(sql, {
        machine: me,
        destination,
        path,
        app: app.app,
        stream: "source",
        n,
        sha256: hash,
        size: bytes,
        at,
      });
    }
    setStream(
      sql,
      { machine: me, app: app.app, destination, stream: "source" },
      { next_n: n + 1, written_at: at },
    );
    return ok(undefined);
  } catch (thrown) {
    return failed(
      "apply_failed",
      thrown instanceof Error ? thrown.message : String(thrown),
    );
  } finally {
    await rm(temp, { force: true });
  }
}

/** 받을 준비가 된 bundle(data root 아래 임시 file), 아직 안 옴, 또는 맞지 않는 file. */
export type Fetched =
  | { kind: "ready"; file: string; meta: SourceMeta }
  | { kind: "waiting" }
  | { kind: "error"; error: SourceError };

// `<n>.json`과 `.bundle`을 검사해 bundle을 임시 file로 옮긴다. 목록이나 bundle이 없거나 크기·hash가 맞지 않으면 아직 안 온 것이다.
export async function fetchSourceEntry(input: {
  reader: FolderReader;
  origin: Id<"mch">;
  app: Id<"app">;
  n: number;
  dataRoot: string;
  random: RandomSource;
}): Promise<Fetched> {
  const { reader, origin, app, n } = input;
  const read = await reader.read(
    sourcePath(origin, app, n, "json"),
    RECORD_MAX_BYTES,
  );
  if (!read.ok) {
    return read.error.code === "not_found"
      ? { kind: "waiting" }
      : {
          kind: "error",
          error: { code: "invalid_file", message: read.error.message },
        };
  }
  const meta = decodeRecord(sourceMetaSchema, read.value);
  if (!meta.ok) return { kind: "error", error: meta.error };
  if (
    meta.value.machine !== origin ||
    meta.value.app !== app ||
    meta.value.n !== n
  ) {
    return {
      kind: "error",
      error: {
        code: "invalid_file",
        message: `source/${n}.json names another machine, app or number`,
      },
    };
  }
  if (meta.value.size > SOURCE_BUNDLE_MAX_BYTES) {
    return {
      kind: "error",
      error: { code: "too_large", message: `source bundle ${n} is too large` },
    };
  }
  const stream = await reader.readStream(
    sourcePath(origin, app, n, "bundle"),
    0,
  );
  if (!stream.ok) {
    return stream.error.code === "not_found"
      ? { kind: "waiting" }
      : {
          kind: "error",
          error: { code: "invalid_file", message: stream.error.message },
        };
  }
  if (stream.value.size !== meta.value.size) return { kind: "waiting" };
  const file = await tempFile(input.dataRoot, input.random);
  const hash = createHash("sha256");
  try {
    await pipeline(
      stream.value.chunks,
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          hash.update(chunk);
          done(null, chunk);
        },
      }),
      createWriteStream(file, { mode: 0o600 }),
    );
  } catch {
    await rm(file, { force: true });
    return { kind: "waiting" };
  }
  if (hash.digest("hex") !== meta.value.sha256) {
    await rm(file, { force: true });
    return { kind: "waiting" };
  }
  return { kind: "ready", file, meta: meta.value };
}

async function missingPrerequisite(
  repo: string,
  meta: SourceMeta,
): Promise<boolean> {
  for (const sha of meta.prerequisites) {
    if (!(await hasCommit(repo, sha))) return true;
  }
  return false;
}

/**
 * 한 출처의 bundle을 cursor 다음부터 `head`까지 순서대로 fetch한다. 기다리거나 맞지 않는 번호에서 멈춘다.
 * 돌려주는 것은 마지막으로 받은 번호와 멈춘 까닭.
 */
export async function fetchSource(input: {
  repo: string;
  reader: FolderReader;
  origin: Id<"mch">;
  app: Id<"app">;
  cursor: number;
  head: number;
  dataRoot: string;
  random: RandomSource;
}): Promise<{
  cursor: number;
  stopped: { waiting_for: number } | { error: SourceError } | null;
}> {
  let cursor = input.cursor;
  for (let n = cursor + 1; n <= input.head; n++) {
    const fetched = await fetchSourceEntry({ ...input, n });
    if (fetched.kind === "waiting") {
      return { cursor, stopped: { waiting_for: n } };
    }
    if (fetched.kind === "error") return { cursor, stopped: fetched };
    try {
      if (await missingPrerequisite(input.repo, fetched.meta)) {
        return { cursor, stopped: { waiting_for: n } };
      }
      const done = await fetchBundle(input.repo, fetched.file, input.origin);
      if (!done.ok) {
        return {
          cursor,
          stopped: {
            error: { code: "apply_failed", message: done.error.message },
          },
        };
      }
    } finally {
      await rm(fetched.file, { force: true });
    }
    cursor = n;
  }
  return { cursor, stopped: null };
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 이 기계에 source가 없는 앱의 저장소를 `<root>/apps/<app>/source`에 만든다: 한 출처의 bundle을 모두 받고 main을
 * `commit`에 둔다. 아직 그 commit까지 오지 않았으면 아무것도 남기지 않고 null이다. 앞서 만들다 잇기 전에 끊긴 저장소(commit
 * 있음)는 그대로 쓴다(cursor 0: 다시 받아도 같은 ref다). `cursor`는 받은 마지막 번호다.
 */
export async function createRepository(input: {
  dataRoot: string;
  app: Id<"app">;
  origin: Id<"mch">;
  reader: FolderReader;
  head: number;
  commit: string;
  random: RandomSource;
}): Promise<Result<{ path: string; cursor: number } | null>> {
  const dir = appDefaultSource(input.dataRoot, input.app);
  if (await exists(dir)) {
    const head = await git(dir, "rev-parse", "--verify", "HEAD");
    return head.ok
      ? ok({ path: dir, cursor: 0 })
      : err({
          code: "conflict",
          message: `${dir} exists and is not a committed repository`,
        });
  }
  if (input.head === 0) return ok(null);
  const staging = `${dir}.new`;
  try {
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const made = await initRepository(staging);
    if (!made.ok) return made;
    const fetched = await fetchSource({ ...input, repo: staging, cursor: 0 });
    if (fetched.stopped !== null && "error" in fetched.stopped) {
      return err({
        code: "unavailable",
        message: fetched.stopped.error.message,
      });
    }
    if (!(await hasCommit(staging, input.commit))) return ok(null);
    const checked = await checkoutMain(staging, input.commit);
    if (!checked.ok) return checked;
    await rename(staging, dir);
    return ok({ path: dir, cursor: fetched.cursor });
  } catch (thrown) {
    return err({
      code: "unavailable",
      message: thrown instanceof Error ? thrown.message : String(thrown),
    });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
