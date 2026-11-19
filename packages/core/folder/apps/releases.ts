// 활성 release를 `releases/<bundle hash>/`로 쓴다. bundle file은 봉인한 사본에서 그대로 읽어 `files/<path>`로 쓰고,
// 모든 file을 쓴 뒤 크기와 sha256을 실은 `release.json`을 마지막에 쓴다(목록이 없으면 읽는 쪽에는 "아직 안 옴"이다).
// 자기 release 폴더는 활성 release와 그 바로 앞 것만 남기고, 그보다 옛 것은 쓴 지 30일이 지나면 지운다.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { err, ok, type Result, sha256Hex } from "../../../base/mod.ts";
import { appBundleCopy } from "../../../protocol/apps/app-storage.ts";
import { bundleManifestSchema } from "../../../protocol/apps/mod.ts";
import {
  COMPACTION_KEEP_MS,
  encodeRecord,
  FOLDER_FORMAT,
  releaseDir,
  releaseFilePath,
  releaseRecordPath,
  releaseRecordSchema,
} from "../../../protocol/folder/mod.ts";
import type { Target } from "./target.ts";
import {
  markDeleted,
  recordWritten,
  written,
  writtenReleases,
} from "./state.ts";

export const MANIFEST_FILE = "manifest.json";
export const DECLARATION_FILE = "declaration.json";

// macOS·Windows 같은 대소문자 무시·NFC 정규화 file system에서 서로 덮거나 file·폴더가 부딪히는 두 path를 찾는다.
export function findReleasePathCollision(
  paths: readonly string[],
): [string, string] | null {
  const files = new Map<string, string>();
  const dirs = new Map<string, string>();
  for (const path of paths) {
    const parts = path
      .split("/")
      .map((part) => part.normalize("NFC").toLowerCase());
    const folded = parts.join("/");
    const sameFile = files.get(folded);
    if (sameFile !== undefined) return [sameFile, path];
    const sameDir = dirs.get(folded);
    if (sameDir !== undefined) return [sameDir, path];
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = i === 0 ? parts[i]! : `${prefix}/${parts[i]!}`;
      const conflictFile = files.get(prefix);
      if (conflictFile !== undefined) return [conflictFile, path];
      if (!dirs.has(prefix)) dirs.set(prefix, path);
    }
    files.set(folded, path);
  }
  return null;
}

async function* hashing(
  chunks: AsyncIterable<Uint8Array>,
  hash: ReturnType<typeof createHash>,
): AsyncIterable<Uint8Array> {
  for await (const chunk of chunks) {
    hash.update(chunk);
    yield chunk;
  }
}

export async function writeActiveRelease(
  target: Target,
): Promise<Result<void>> {
  const { app, me, sql } = target;
  const release = app.release;
  if (release === null) return ok(undefined);
  const recordPath = releaseRecordPath(me, app.app, release.bundle_hash);
  if (written(sql, me, target.destination, recordPath) !== null) {
    return ok(undefined);
  }
  const copy = appBundleCopy(target.dataRoot, app.app, release.bundle_hash);
  let manifestBytes: Uint8Array;
  try {
    manifestBytes = await readFile(`${copy}/${MANIFEST_FILE}`);
  } catch {
    return err({ code: "unavailable", message: "bundle copy is missing" });
  }
  if ((await sha256Hex(manifestBytes)) !== release.bundle_hash) {
    return err({
      code: "unavailable",
      message: "bundle copy does not match its hash",
    });
  }
  const manifest = bundleManifestSchema.safeParse(
    JSON.parse(new TextDecoder().decode(manifestBytes)),
  );
  if (!manifest.success) {
    return err({ code: "unavailable", message: "bundle manifest is invalid" });
  }
  const declarationHash = manifest.data.files.find(
    (file) => file.path === DECLARATION_FILE,
  )?.hash;
  if (declarationHash === undefined) {
    return err({ code: "unavailable", message: "bundle has no declaration" });
  }
  const releasePaths = [
    ...manifest.data.files.map((file) => file.path),
    MANIFEST_FILE,
  ];
  const collision = findReleasePathCollision(releasePaths);
  if (collision !== null) {
    return err({
      code: "invalid_input",
      message: `release contains paths that collide on case-insensitive or NFC filesystems: ${collision[0]} and ${collision[1]}`,
    });
  }
  const files: { path: string; size: number; sha256: string }[] = [];
  for (const path of releasePaths) {
    const hash = createHash("sha256");
    const done = await target.writer.writeStream(
      releaseFilePath(me, app.app, release.bundle_hash, path),
      hashing(createReadStream(`${copy}/${path}`), hash),
    );
    if (!done.ok) return done;
    files.push({ path, size: done.value.size, sha256: hash.digest("hex") });
  }
  const bytes = encodeRecord(releaseRecordSchema, {
    format: FOLDER_FORMAT.version,
    machine: me,
    app: app.app,
    bundle_hash: release.bundle_hash,
    code_commit: release.code_commit,
    declaration_hash: declarationHash,
    data_schema: release.data_schema,
    data_changes: release.data_changes as never,
    created_at: release.created_at,
    files,
  });
  const done = await target.writer.writeFile(recordPath, bytes);
  if (!done.ok) return done;
  recordWritten(sql, {
    machine: me,
    destination: target.destination,
    path: recordPath,
    app: app.app,
    stream: "release",
    n: null,
    sha256: await sha256Hex(bytes),
    size: bytes.byteLength,
    at: target.now(),
  });
  return ok(undefined);
}

// `releases/<hash>/release.json`의 hash.
const hashOf = (recordPath: string) => recordPath.split("/").at(-2)!;

export async function pruneReleases(target: Target): Promise<Result<void>> {
  const { app, me, sql } = target;
  const active = app.release?.bundle_hash ?? null;
  const others = writtenReleases(sql, me, target.destination, app.app).filter(
    (row) => hashOf(row.path) !== active,
  );
  const cutoff = target.nowMs() - COMPACTION_KEEP_MS;
  // 가장 늦게 쓴 다른 것이 바로 앞 release다.
  for (const row of others.slice(1)) {
    if (Date.parse(row.written_at) > cutoff) continue;
    const removed = await target.writer.remove(
      releaseDir(me, app.app, hashOf(row.path)),
    );
    if (!removed.ok) return removed;
    markDeleted(sql, me, target.destination, row.path, target.now());
  }
  return ok(undefined);
}

/** 앱 기록의 `releases`: 이 기계가 폴더에 둔 release(지우지 않은 것). */
export function listedReleases(target: Target): string[] {
  return writtenReleases(
    target.sql,
    target.me,
    target.destination,
    target.app.app,
  )
    .map((row) => hashOf(row.path))
    .sort();
}
