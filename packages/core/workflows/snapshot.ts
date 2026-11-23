import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, posix, resolve } from "node:path";
import { err, errorCode, ok, type Result } from "../../base/mod.ts";
import { WORKFLOW_FLOW_FILE } from "../../protocol/workflows/mod.ts";
import { isSha256Hash, objectPathFor } from "../storage/blobs/mod.ts";
import { WORKFLOW_SNAPSHOT_BLOB_PURPOSE } from "./checkpoint-schema.ts";

// 빈 파일(0 bytes)의 sha256. blob store는 0-byte prepare를 거절하므로 manifest에만 기록하고 materialize 시 빈 파일로 복원한다.
export const EMPTY_FILE_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const SNAPSHOT_VERSION = 1 as const;
const MAX_SNAPSHOT_FILES = 200;
const MAX_SNAPSHOT_FILE_BYTES = 4 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  ".ts",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".yaml",
  ".yml",
  ".md",
]);

const EXCLUDED_DIRS = new Set(["artifacts", "node_modules", ".git"]);

export type WorkflowSnapshotFile = {
  path: string;
  blob_id: string;
  size_bytes?: number;
};

export type WorkflowSnapshotManifest = {
  version: 1;
  files: WorkflowSnapshotFile[];
};

export type SnapshotBlobStore = {
  put(
    bytes: Uint8Array,
    purpose: string,
  ): Promise<Result<{ hash: string; sizeBytes: number }>>;
  get?(hash: string): Promise<Result<Uint8Array>>;
};

function isSafeRelativePath(rel: string): boolean {
  if (rel.length === 0 || rel.includes("\0") || rel.includes("\\")) {
    return false;
  }
  if (rel.startsWith("/") || rel.endsWith("/")) return false;
  const parts = rel.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

export function parseSnapshotManifest(
  manifestJson: string,
): Result<WorkflowSnapshotManifest> {
  let raw: unknown;
  try {
    raw = JSON.parse(manifestJson);
  } catch {
    return err({
      code: "invalid_input",
      message: "invalid workflow code snapshot manifest JSON",
    });
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return err({
      code: "invalid_input",
      message: "workflow code snapshot manifest must be an object",
    });
  }
  const obj = raw as Record<string, unknown>;
  if (obj["version"] !== SNAPSHOT_VERSION || !Array.isArray(obj["files"])) {
    return err({
      code: "invalid_input",
      message: "unsupported workflow code snapshot manifest version",
    });
  }
  const files: WorkflowSnapshotFile[] = [];
  const seen = new Set<string>();
  for (const item of obj["files"]) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return err({
        code: "invalid_input",
        message: "invalid file entry in workflow code snapshot manifest",
      });
    }
    const entry = item as Record<string, unknown>;
    const filePath = entry["path"];
    const blobId = entry["blob_id"];
    const sizeBytes = entry["size_bytes"];
    if (
      typeof filePath !== "string" ||
      !isSafeRelativePath(filePath) ||
      typeof blobId !== "string" ||
      !isSha256Hash(blobId)
    ) {
      return err({
        code: "invalid_input",
        message: "invalid path or blob_id in workflow code snapshot manifest",
      });
    }
    if (
      sizeBytes !== undefined &&
      (typeof sizeBytes !== "number" ||
        !Number.isInteger(sizeBytes) ||
        sizeBytes < 0)
    ) {
      return err({
        code: "invalid_input",
        message: "invalid size_bytes in workflow code snapshot manifest",
      });
    }
    if (seen.has(filePath)) {
      return err({
        code: "invalid_input",
        message: "duplicate path in workflow code snapshot manifest",
      });
    }
    seen.add(filePath);
    files.push({
      path: filePath,
      blob_id: blobId,
      ...(sizeBytes !== undefined ? { size_bytes: sizeBytes } : {}),
    });
  }
  return ok({ version: SNAPSHOT_VERSION, files });
}

// workflow 폴더의 source 파일들을 content-addressed blob으로 고정하고 결정론적 manifest JSON을 돌려준다.
// symlink와 artifacts/·node_modules/는 제외한다.
export async function captureWorkflowSnapshot(
  workflowDir: string,
  blobStore: SnapshotBlobStore,
): Promise<Result<string>> {
  const discovered: { rel: string; abs: string }[] = [];

  async function walk(relDir: string, absDir: string): Promise<Result<void>> {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch (e) {
      if (errorCode(e) === "ENOENT") {
        return err({
          code: "not_found",
          message: "workflow folder not found",
        });
      }
      return err({
        code: "unavailable",
        message: "workflow folder could not be read",
      });
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        const nextRel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
        const nested = await walk(nextRel, `${absDir}/${entry.name}`);
        if (!nested.ok) return nested;
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = extname(entry.name).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) continue;
      if (discovered.length >= MAX_SNAPSHOT_FILES) {
        return err({
          code: "invalid_input",
          message: `workflow snapshot exceeds maximum of ${MAX_SNAPSHOT_FILES} files`,
        });
      }
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      discovered.push({
        rel: posix.normalize(rel),
        abs: `${absDir}/${entry.name}`,
      });
    }
    return ok(undefined);
  }

  const walked = await walk("", workflowDir);
  if (!walked.ok) return walked;
  discovered.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  if (!discovered.some((f) => f.rel === WORKFLOW_FLOW_FILE)) {
    return err({
      code: "invalid_input",
      message: `${WORKFLOW_FLOW_FILE} is missing`,
    });
  }

  const files: WorkflowSnapshotFile[] = [];
  for (const item of discovered) {
    let info;
    try {
      info = await stat(item.abs);
    } catch {
      return err({
        code: "unavailable",
        message: `could not stat workflow file ${item.rel}`,
      });
    }
    if (info.size > MAX_SNAPSHOT_FILE_BYTES) {
      return err({
        code: "invalid_input",
        message: `workflow file ${item.rel} exceeds maximum snapshot size`,
      });
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(item.abs));
    } catch {
      return err({
        code: "unavailable",
        message: `could not read workflow file ${item.rel}`,
      });
    }
    if (bytes.byteLength === 0) {
      files.push({
        path: item.rel,
        blob_id: EMPTY_FILE_SHA256,
        size_bytes: 0,
      });
      continue;
    }
    const stored = await blobStore.put(bytes, WORKFLOW_SNAPSHOT_BLOB_PURPOSE);
    if (!stored.ok) return stored;
    files.push({
      path: item.rel,
      blob_id: stored.value.hash,
      size_bytes: stored.value.sizeBytes,
    });
  }

  const manifest: WorkflowSnapshotManifest = {
    version: SNAPSHOT_VERSION,
    files,
  };
  return ok(JSON.stringify(manifest));
}

export type MaterializeSnapshotOptions =
  | {
      readBlob(hash: string): Promise<Result<Uint8Array>>;
      dataRoot?: never;
    }
  | {
      dataRoot: string;
      readBlob?: never;
    };

async function readBlobFromDataRoot(
  dataRoot: string,
  hash: string,
): Promise<Result<Uint8Array>> {
  try {
    return ok(new Uint8Array(await readFile(objectPathFor(dataRoot, hash))));
  } catch (e) {
    if (errorCode(e) === "ENOENT") {
      return err({
        code: "not_found",
        message: `workflow snapshot blob ${hash} is missing`,
      });
    }
    return err({
      code: "unavailable",
      message: `workflow snapshot blob ${hash} could not be read`,
    });
  }
}

// 저장된 code_snapshot manifest JSON을 targetDir 아래에 복원한다(flow-host replay가 실행할 임시 폴더용).
export async function materializeSnapshot(
  manifestJson: string,
  targetDir: string,
  options: MaterializeSnapshotOptions,
): Promise<Result<{ dir: string; files: string[] }>> {
  const parsed = parseSnapshotManifest(manifestJson);
  if (!parsed.ok) return parsed;
  const rootAbs = resolve(targetDir);
  try {
    await mkdir(rootAbs, { recursive: true, mode: 0o700 });
  } catch {
    return err({
      code: "unavailable",
      message: "could not create snapshot target directory",
    });
  }
  const readBlob =
    options.readBlob !== undefined
      ? options.readBlob
      : (hash: string) => readBlobFromDataRoot(options.dataRoot, hash);
  const written: string[] = [];
  for (const file of parsed.value.files) {
    const dest = resolve(rootAbs, file.path);
    if (
      dest !== rootAbs &&
      !dest.startsWith(`${rootAbs}/`) &&
      !dest.startsWith(`${rootAbs}\\`)
    ) {
      return err({
        code: "invalid_input",
        message: `snapshot file escapes target directory: ${file.path}`,
      });
    }
    let bytes: Uint8Array;
    if (file.blob_id === EMPTY_FILE_SHA256 && (file.size_bytes ?? 0) === 0) {
      bytes = new Uint8Array(0);
    } else {
      const fetched = await readBlob(file.blob_id);
      if (!fetched.ok) return fetched;
      bytes = fetched.value;
    }
    try {
      await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
      await writeFile(dest, bytes, { mode: 0o600 });
    } catch {
      return err({
        code: "unavailable",
        message: `could not materialize snapshot file ${file.path}`,
      });
    }
    written.push(file.path);
  }
  return ok({ dir: rootAbs, files: written });
}
