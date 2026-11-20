import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  PROJECT_FILE_MAX_BYTES,
  type ProjectFileEntry,
  projectFilesCreate,
  projectFilesList,
  projectFilesRead,
  projectFilesRemove,
  projectFilesRename,
  projectFilesWrite,
} from "../../../protocol/projects/mod.ts";
import type { ApiReadDefinition, Sql } from "../../../protocol/server/mod.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import {
  loadProject,
  rootRelation,
  symlinkEscapesRoot,
} from "../registry/mod.ts";
import { decodeText } from "../search/model.ts";

type ProjectFilesDeps = {
  // ledger snapshot 하나에서 project를 읽는다. 연결은 읽고 나면 닫는다.
  snapshot<T>(
    read: (sql: Pick<Sql, "get" | "all">, asOfSeq: string) => Result<T>,
  ): Result<T>;
};

const MAX_READ_BYTES = PROJECT_FILE_MAX_BYTES;
const HIDDEN = new Set([".git", "node_modules"]);

const notFound = (message: string): Result<never> =>
  err({ code: "not_found", message });
const invalid = (message: string): Result<never> =>
  err({ code: "invalid_input", message });
const conflict = (message: string): Result<never> =>
  err({ code: "conflict", message });
const unavailable = (message: string): Result<never> =>
  err({ code: "unavailable", message });

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function errnoOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function mapFsError(error: unknown, fallback: string): Result<never> {
  switch (errnoOf(error)) {
    case "ENOENT":
      return notFound("path not found");
    case "EEXIST":
    case "ENOTEMPTY":
      return conflict("target already exists");
    case "EACCES":
    case "EPERM":
      return err({ code: "forbidden", message: "permission denied" });
    case "ELOOP":
    case "EISDIR":
    case "ENOTDIR":
      return invalid(fallback);
    default:
      return unavailable(fallback);
  }
}

// project의 등록 폴더 하나의 realpath를 찾는다.
async function rootOf(
  deps: ProjectFilesDeps,
  input: { project: string; folder?: string | undefined },
): Promise<Result<{ root: string }>> {
  const loaded = deps.snapshot((sql) => loadProject(sql, input.project));
  if (!loaded.ok) return loaded;
  const project = loaded.value;
  if (project === null) return notFound("project not found");
  const folder =
    input.folder === undefined
      ? project.folders[0]
      : project.folders.find((item) => item.path === input.folder);
  if (folder === undefined) {
    return invalid("folder is not a connected folder of the project");
  }
  try {
    return ok({ root: await realpath(folder.path) });
  } catch {
    return notFound("folder not found");
  }
}

// root 아래 path의 실제 경로. symlink를 따라간 끝이 root 밖이면 거절한다.
async function within(
  root: string,
  path: string | undefined,
): Promise<Result<string>> {
  try {
    const real = await realpath(path === undefined ? root : join(root, path));
    const escapes = symlinkEscapesRoot(root, real);
    if (!escapes.ok) return escapes;
    return escapes.value
      ? invalid("path is outside the connected folder")
      : ok(real);
  } catch {
    return notFound("path not found");
  }
}

// 쓰기·만들기·옮기기·지우기가 거치는 부모 폴더 검증. 중간 조각이 symlink로 root 밖을 가리키면 거절한다.
async function resolveParent(
  root: string,
  relPath: string,
  createMissing: boolean,
): Promise<Result<{ parentReal: string; leaf: string; targetPath: string }>> {
  const parts = relPath.split("/");
  const leaf = parts[parts.length - 1]!;
  let current = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = join(current, parts[i]!);
    let info;
    try {
      info = await lstat(next);
    } catch (error) {
      if (errnoOf(error) !== "ENOENT") {
        return mapFsError(error, "failed to inspect parent folder");
      }
      if (!createMissing) return notFound("parent folder not found");
      try {
        await mkdir(next, { mode: 0o755 });
      } catch (mkError) {
        if (errnoOf(mkError) !== "EEXIST") {
          return mapFsError(mkError, "failed to create parent folder");
        }
      }
      try {
        const real = await realpath(next);
        const escapes = symlinkEscapesRoot(root, real);
        if (!escapes.ok) return escapes;
        if (escapes.value) {
          return invalid("path is outside the connected folder");
        }
        current = real;
        continue;
      } catch (realError) {
        return mapFsError(realError, "failed to resolve parent folder");
      }
    }
    if (info.isSymbolicLink()) {
      let real: string;
      try {
        real = await realpath(next);
      } catch {
        return invalid("path is outside the connected folder");
      }
      const escapes = symlinkEscapesRoot(root, real);
      if (!escapes.ok) return escapes;
      if (escapes.value) {
        return invalid("path is outside the connected folder");
      }
      const targetInfo = await stat(real).catch(() => null);
      if (!targetInfo?.isDirectory()) return invalid("parent is not a folder");
      current = real;
      continue;
    }
    if (!info.isDirectory()) return invalid("parent is not a folder");
    current = next;
  }
  const targetPath = join(current, leaf);
  const escapes = symlinkEscapesRoot(root, targetPath);
  if (!escapes.ok) return escapes;
  if (escapes.value) return invalid("path is outside the connected folder");
  return ok({ parentReal: current, leaf, targetPath });
}

export function projectFilesListRead(
  deps: ProjectFilesDeps,
): ApiReadDefinition<typeof projectFilesList> {
  return {
    route: projectFilesList,
    async handle(_ctx, input) {
      const parsed = projectFilesList.input.safeParse(input);
      if (!parsed.success) return invalid("invalid read input");
      const found = await rootOf(deps, parsed.data);
      if (!found.ok) return found;
      const { root } = found.value;
      const real = await within(root, parsed.data.path);
      if (!real.ok) return real;
      if (!(await stat(real.value)).isDirectory())
        return invalid("not a folder");
      const entries: ProjectFileEntry[] = [];
      for (const name of await readdir(real.value)) {
        if (HIDDEN.has(name)) continue;
        // 깨진 symlink와 도는 동안 사라진 항목은 건너뛴다. 밖을 가리키는 symlink는 보이지 않는다.
        const base = parsed.data.path;
        const entry = await within(
          root,
          base === undefined ? name : `${base}/${name}`,
        );
        if (!entry.ok) continue;
        const info = await stat(entry.value).catch(() => null);
        if (info === null) continue;
        const folder = info.isDirectory();
        if (!folder && !info.isFile()) continue;
        entries.push({
          name,
          kind: folder ? "folder" : "file",
          size: folder ? 0 : info.size,
          modified_at: info.mtime.toISOString(),
        });
      }
      entries.sort((a, b) =>
        a.kind !== b.kind
          ? a.kind === "folder"
            ? -1
            : 1
          : a.name < b.name
            ? -1
            : a.name > b.name
              ? 1
              : 0,
      );
      return ok({ entries });
    },
  };
}

export function projectFilesReadRead(
  deps: ProjectFilesDeps,
): ApiReadDefinition<typeof projectFilesRead> {
  return {
    route: projectFilesRead,
    async handle(_ctx, input) {
      const parsed = projectFilesRead.input.safeParse(input);
      if (!parsed.success) return invalid("invalid read input");
      const found = await rootOf(deps, parsed.data);
      if (!found.ok) return found;
      const { root } = found.value;
      const real = await within(root, parsed.data.path);
      if (!real.ok) return real;
      // 한 byte 더 읽어 넘는지 안다. realpath 뒤 O_NOFOLLOW로 열어 사이의 symlink 바꿔치기를 막는다.
      let handle;
      try {
        handle = await open(
          real.value,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
      } catch (error) {
        return mapFsError(error, "not a file");
      }
      let bytes: Uint8Array;
      let modifiedAt: string;
      try {
        const info = await handle.stat();
        if (!info.isFile()) return invalid("not a file");
        modifiedAt = info.mtime.toISOString();
        const buffer = new Uint8Array(MAX_READ_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        bytes = buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
      const truncated = bytes.length > MAX_READ_BYTES;
      if (truncated) {
        // 잘린 자리가 UTF-8 글자 한가운데면 그 글자 앞에서 끊는다.
        let cut = MAX_READ_BYTES;
        while (cut > 0 && (bytes[cut]! & 0xc0) === 0x80) cut--;
        bytes = bytes.subarray(0, cut);
      }
      const text = decodeText(bytes);
      if (text === null) return invalid("not a UTF-8 text file");
      return ok({
        text,
        truncated,
        ...(truncated ? {} : { hash: sha256(bytes) }),
        modified_at: modifiedAt,
      });
    },
  };
}

// 같은 경로의 쓰기는 한 줄로 세워 base_hash 비교와 원자 교체 사이에 끼어들지 못하게 한다.
const writeQueues = new Map<string, Promise<unknown>>();

function serialWrite<T>(key: string, run: () => Promise<T>): Promise<T> {
  const result = (writeQueues.get(key) ?? Promise.resolve()).then(run, run);
  const tail = result.catch(() => {});
  writeQueues.set(key, tail);
  void tail.then(() => {
    if (writeQueues.get(key) === tail) writeQueues.delete(key);
  });
  return result;
}

export function projectFilesWriteHandler(
  deps: ProjectFilesDeps,
): MemoryHandler {
  return async (_ctx, input) => {
    const parsed = projectFilesWrite.input.safeParse(input);
    if (!parsed.success) return invalid("invalid write input");
    const bytes = new TextEncoder().encode(parsed.data.text);
    if (bytes.byteLength > PROJECT_FILE_MAX_BYTES) {
      return invalid("file exceeds the 1 MiB limit");
    }
    const found = await rootOf(deps, parsed.data);
    if (!found.ok) return found;
    const { root } = found.value;
    const resolved = await resolveParent(root, parsed.data.path, false);
    if (!resolved.ok) return resolved;
    const { parentReal, leaf, targetPath } = resolved.value;

    return await serialWrite(targetPath, async () => {
      let existingMode = 0o644;
      let existingHash: string | null = null;
      let existingInfo;
      try {
        existingInfo = await lstat(targetPath);
      } catch (error) {
        if (errnoOf(error) !== "ENOENT") {
          return mapFsError(error, "failed to inspect target file");
        }
        existingInfo = null;
      }

      if (existingInfo !== null) {
        // symlink에는 쓰지 않는다(O_NOFOLLOW 정책).
        if (existingInfo.isSymbolicLink()) {
          return invalid("cannot write through a symbolic link");
        }
        if (!existingInfo.isFile()) return invalid("not a file");
        let handle;
        try {
          handle = await open(
            targetPath,
            constants.O_RDONLY | constants.O_NOFOLLOW,
          );
        } catch (error) {
          return mapFsError(error, "cannot open target file");
        }
        try {
          const info = await handle.stat();
          if (!info.isFile()) return invalid("not a file");
          existingMode = info.mode & 0o777;
          if (parsed.data.base_hash !== undefined) {
            const currentBytes = await handle.readFile();
            existingHash = sha256(currentBytes);
          }
        } finally {
          await handle.close();
        }
      }

      if (
        parsed.data.base_hash !== undefined &&
        existingHash !== parsed.data.base_hash
      ) {
        return conflict("file changed on disk");
      }

      const temp = join(
        parentReal,
        `.${leaf}.lophn-${randomBytes(6).toString("hex")}.tmp`,
      );
      try {
        const handle = await open(
          temp,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          existingMode,
        );
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        // rename 직전에 대상이 symlink로 바뀌지 않았는지 한 번 더 본다.
        const beforeRename = await lstat(targetPath).catch(() => null);
        if (beforeRename?.isSymbolicLink()) {
          await rm(temp, { force: true }).catch(() => {});
          return invalid("cannot write through a symbolic link");
        }
        await rename(temp, targetPath);
      } catch (error) {
        await rm(temp, { force: true }).catch(() => {});
        return mapFsError(error, "failed to write file");
      }

      return ok({ hash: sha256(bytes) });
    });
  };
}

export function projectFilesCreateHandler(
  deps: ProjectFilesDeps,
): MemoryHandler {
  return async (_ctx, input) => {
    const parsed = projectFilesCreate.input.safeParse(input);
    if (!parsed.success) return invalid("invalid create input");
    const found = await rootOf(deps, parsed.data);
    if (!found.ok) return found;
    const { root } = found.value;
    const resolved = await resolveParent(root, parsed.data.path, true);
    if (!resolved.ok) return resolved;
    const { targetPath } = resolved.value;

    const taken = await lstat(targetPath).then(
      () => true,
      (error) => (errnoOf(error) === "ENOENT" ? false : error),
    );
    if (taken === true) return conflict("path already exists");
    if (taken !== false) {
      return mapFsError(taken, "failed to inspect target path");
    }

    try {
      if (parsed.data.kind === "folder") {
        await mkdir(targetPath, { mode: 0o755 });
      } else {
        const handle = await open(
          targetPath,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o644,
        );
        await handle.close();
      }
      return ok({});
    } catch (error) {
      return mapFsError(error, "failed to create path");
    }
  };
}

export function projectFilesRenameHandler(
  deps: ProjectFilesDeps,
): MemoryHandler {
  return async (_ctx, input) => {
    const parsed = projectFilesRename.input.safeParse(input);
    if (!parsed.success) return invalid("invalid rename input");
    const found = await rootOf(deps, parsed.data);
    if (!found.ok) return found;
    const { root } = found.value;
    const fromResolved = await resolveParent(root, parsed.data.from, false);
    if (!fromResolved.ok) return fromResolved;
    const toResolved = await resolveParent(root, parsed.data.to, false);
    if (!toResolved.ok) return toResolved;

    let fromInfo;
    try {
      fromInfo = await lstat(fromResolved.value.targetPath);
    } catch (error) {
      return mapFsError(error, "source path not found");
    }
    if (fromInfo.isSymbolicLink()) {
      let realTarget: string;
      try {
        realTarget = await realpath(fromResolved.value.targetPath);
      } catch {
        return invalid("path is outside the connected folder");
      }
      const escapes = symlinkEscapesRoot(root, realTarget);
      if (!escapes.ok) return escapes;
      if (escapes.value) {
        return invalid("path is outside the connected folder");
      }
    }

    if (fromResolved.value.targetPath === toResolved.value.targetPath) {
      return ok({});
    }

    // 폴더를 자기 안으로 옮기지 못하게 막는다.
    const relation = rootRelation(
      fromResolved.value.targetPath,
      toResolved.value.targetPath,
    );
    if (!relation.ok) return relation;
    if (relation.value === "equal" || relation.value === "ancestor") {
      return invalid("cannot move a folder into itself");
    }

    const caseOnly =
      fromResolved.value.parentReal === toResolved.value.parentReal &&
      fromResolved.value.leaf.toLowerCase() ===
        toResolved.value.leaf.toLowerCase();
    const taken = await lstat(toResolved.value.targetPath).then(
      () => true,
      () => false,
    );
    if (taken && !caseOnly) return conflict("target already exists");

    try {
      await rename(fromResolved.value.targetPath, toResolved.value.targetPath);
      return ok({});
    } catch (error) {
      return mapFsError(error, "failed to rename path");
    }
  };
}

export function projectFilesRemoveHandler(
  deps: ProjectFilesDeps,
): MemoryHandler {
  return async (_ctx, input) => {
    const parsed = projectFilesRemove.input.safeParse(input);
    if (!parsed.success) return invalid("invalid remove input");
    const found = await rootOf(deps, parsed.data);
    if (!found.ok) return found;
    const { root } = found.value;
    const resolved = await resolveParent(root, parsed.data.path, false);
    if (!resolved.ok) return resolved;
    const { targetPath } = resolved.value;

    let info;
    try {
      info = await lstat(targetPath);
    } catch (error) {
      return mapFsError(error, "path not found");
    }
    if (info.isSymbolicLink()) {
      let realTarget: string;
      try {
        realTarget = await realpath(targetPath);
      } catch {
        return invalid("path is outside the connected folder");
      }
      const escapes = symlinkEscapesRoot(root, realTarget);
      if (!escapes.ok) return escapes;
      if (escapes.value) {
        return invalid("path is outside the connected folder");
      }
    }
    if (targetPath === root) {
      return invalid("cannot remove project folder root");
    }

    try {
      await rm(targetPath, { recursive: true, force: false });
      return ok({});
    } catch (error) {
      return mapFsError(error, "failed to remove path");
    }
  };
}

export function projectFilesMutationHandlers(deps: ProjectFilesDeps): {
  write: MemoryHandler;
  create: MemoryHandler;
  rename: MemoryHandler;
  remove: MemoryHandler;
} {
  return {
    write: projectFilesWriteHandler(deps),
    create: projectFilesCreateHandler(deps),
    rename: projectFilesRenameHandler(deps),
    remove: projectFilesRemoveHandler(deps),
  };
}
