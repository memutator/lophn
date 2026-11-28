// 다른 기계의 project file 통로(`project_files/*`). 절대 경로를 그 기계의 등록 폴더로 풀어 core route를 부르고,
// 폴더 목록 cache + in-flight 중복 제거 + stale-while-revalidate(0ms 즉시 표시 후 뒤에서 갱신) + 동시 요청 상한(remote link
// 한도 8 아래 유지)과 파일 본문 읽기 cache를 둔다.
import {
  PROJECT_FILE_MAX_BYTES,
  type ProjectFileEntry,
  projectFilesCopy,
  projectFilesCreate,
  projectFilesList,
  projectFilesRead,
  projectFilesRemove,
  projectFilesRename,
  projectFilesWrite,
  projectFilesWriteBytes,
} from "../../../../protocol/projects/project-files.ts";
import type {
  FileFailure,
  FileReply,
  FileText,
  FileWritten,
} from "../../../ipc/files.ts";
import type { EditorFiles } from "../../editor/source.ts";
import type {
  FileOpResult,
  FolderEntry,
  ReadResult,
  WorkspaceSource,
} from "../../workspace/source.ts";
import type { CoreSource } from "../connection/connection.ts";

/** 폴더 목록 cache가 stale로 바뀌는 시간. 이 안이면 network 호출 없이 즉시 답한다. */
export const REMOTE_LIST_STALE_MS = 2_000;
/** 파일 본문 읽기 cache 수명. */
export const REMOTE_READ_TTL_MS = 30_000;
/** remote link 동시 call 한도(8)를 채우지 않도록 Explorer background 갱신을 제한한다. */
export const REMOTE_LIST_MAX_CONCURRENT = 3;
/** 파일 본문 cache 최대 항목 수. */
const MAX_READ_CACHE_ENTRIES = 50;
/** project 목록 자동 재조회 간격. */
const PROJECTS_INDEX_TTL_MS = 30_000;

interface CachedDir {
  readonly entries: readonly FolderEntry[];
  readonly meta: ReadonlyMap<string, { size: number; modifiedAt: string }>;
  readonly fetchedAt: number;
}

interface CachedFile {
  readonly text: string;
  readonly hash: string | null;
  readonly modifiedAt: number;
  readonly modifiedIso: string | null;
  readonly truncated: boolean;
  readonly fetchedAt: number;
}

interface LocatedPath {
  readonly project: string;
  readonly folder: string;
  readonly relPath: string | undefined;
}

export interface RemoteFilesOptions {
  readonly now?: () => number;
  readonly staleMs?: number;
  readonly readTtlMs?: number;
  readonly maxConcurrent?: number;
}

export interface RemoteFilesAdapter {
  /** `workspace.project(id)`가 읽은 등록 폴더를 경로 풀기 index에 올린다. */
  registerProject(
    projectId: string,
    folders: readonly { readonly path: string }[],
  ): void;
  /** project의 ready worktree 경로를 경로 풀기 index에 올린다. core `project_files/*`가 그 경로를 `folder`로 받는다. 등록 폴더와 따로 들어 project index 갱신이 지우지 않는다. */
  registerRoots(projectId: string, paths: readonly string[]): void;
  /** `otherMachineData.workspace`에 얹을 파일 관련 method 묶음. */
  readonly workspaceFiles: Pick<
    WorkspaceSource,
    | "remote"
    | "list"
    | "listCached"
    | "onDirectoryUpdated"
    | "create"
    | "rename"
    | "copy"
    | "writeBytes"
    | "trash"
  >;
  /** `otherMachineData.editor`의 `EditorSessions`에 넣을 파일 통로. */
  readonly editorFiles: EditorFiles;
}

function trimTrailing(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function parentPathOf(path: string): string {
  const clean = trimTrailing(normalizePath(path));
  const cut = clean.lastIndexOf("/");
  return cut <= 0 ? "/" : clean.slice(0, cut);
}

function dirCacheKey(machine: string, loc: LocatedPath): string {
  return `${machine}\0${loc.project}\0${loc.folder}\0${loc.relPath ?? ""}`;
}

function fileCacheKey(machine: string, loc: LocatedPath): string {
  return `${machine}\0${loc.project}\0${loc.folder}\0${loc.relPath ?? ""}`;
}

function mapCoreFailure(code: string | undefined): FileFailure {
  switch (code) {
    case "invalid_input":
    case "forbidden":
    case "not_found":
    case "conflict":
    case "unavailable":
      return code;
    case "unauthorized":
      return "forbidden";
    default:
      return "unavailable";
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** `project_files/write_bytes` 디코드 전 바이트 상한(24 MiB). */
const REMOTE_WRITE_BYTES_MAX = 24 * 1024 * 1024;

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** 동시 실행 수를 제한하는 작은 FIFO semaphore. */
function createLimiter(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (running >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    running += 1;
    try {
      return await work();
    } finally {
      running -= 1;
      const next = waiting.shift();
      if (next !== undefined) next();
    }
  };
}

export function createRemoteFiles(
  machine: string,
  core: CoreSource,
  options: RemoteFilesOptions = {},
): RemoteFilesAdapter {
  const now = options.now ?? (() => Date.now());
  const staleMs = options.staleMs ?? REMOTE_LIST_STALE_MS;
  const readTtlMs = options.readTtlMs ?? REMOTE_READ_TTL_MS;
  const limitList = createLimiter(
    Math.max(1, options.maxConcurrent ?? REMOTE_LIST_MAX_CONCURRENT),
  );

  // projectId -> 등록 폴더 절대 경로 목록
  const projectFolders = new Map<string, readonly string[]>();
  let projectsFetchedAt = -Infinity;
  let projectsInFlight: Promise<void> | null = null;

  // 폴더 목록 cache, 진행 중 호출, 절대 경로 -> cache key 매핑
  const dirCache = new Map<string, CachedDir>();
  const dirInFlight = new Map<
    string,
    Promise<ReadResult<readonly FolderEntry[]>>
  >();
  const dirListeners = new Set<
    (path: string, entries: readonly FolderEntry[]) => void
  >();

  // 파일 본문 cache(LRU 순서)와 진행 중 읽기
  const fileCache = new Map<string, CachedFile>();
  const fileInFlight = new Map<string, Promise<FileReply<FileText>>>();

  const projectRoots = new Map<string, readonly string[]>();

  function registerRoots(projectId: string, paths: readonly string[]): void {
    projectRoots.set(projectId, [...paths]);
  }

  function registerProject(
    projectId: string,
    folders: readonly { readonly path: string }[],
  ): void {
    projectFolders.set(
      projectId,
      folders.map((folder) => folder.path),
    );
  }

  async function refreshProjectIndex(force = false): Promise<void> {
    if (!force && now() - projectsFetchedAt < PROJECTS_INDEX_TTL_MS) return;
    if (projectsInFlight !== null) return projectsInFlight;
    projectsInFlight = (async () => {
      const reply = await core.call({
        kind: "read",
        resource: "projects",
        method: "list",
        body: { status: "active" },
      });
      if (!reply.ok) return;
      const listed = reply.value as {
        projects?: readonly {
          id: string;
          folders?: readonly { path: string }[];
        }[];
      };
      for (const item of listed.projects ?? []) {
        registerProject(item.id, item.folders ?? []);
      }
      projectsFetchedAt = now();
    })().finally(() => {
      projectsInFlight = null;
    });
    return projectsInFlight;
  }

  function locateSync(absPath: string): LocatedPath | null {
    const target = trimTrailing(normalizePath(absPath));
    let best: { project: string; folder: string; root: string } | null = null;
    const all = [...projectFolders, ...projectRoots];
    for (const [project, folders] of all) {
      for (const folder of folders) {
        const root = trimTrailing(normalizePath(folder));
        const match =
          target === root || target.startsWith(root === "/" ? "/" : `${root}/`);
        if (match && (best === null || root.length > best.root.length)) {
          best = { project, folder, root };
        }
      }
    }
    if (best === null) return null;
    if (target === best.root) {
      return { project: best.project, folder: best.folder, relPath: undefined };
    }
    const offset = best.root === "/" ? 1 : best.root.length + 1;
    const relPath = target.slice(offset);
    return {
      project: best.project,
      folder: best.folder,
      relPath: relPath === "" ? undefined : relPath,
    };
  }

  async function locate(absPath: string): Promise<LocatedPath | null> {
    const hit = locateSync(absPath);
    if (hit !== null) return hit;
    await refreshProjectIndex(false);
    const second = locateSync(absPath);
    if (second !== null) return second;
    // 새로 등록된 폴더일 수 있어 한 번만 강제 조회한다.
    await refreshProjectIndex(true);
    return locateSync(absPath);
  }

  function setFileCache(key: string, entry: CachedFile): void {
    if (fileCache.has(key)) fileCache.delete(key);
    fileCache.set(key, entry);
    while (fileCache.size > MAX_READ_CACHE_ENTRIES) {
      const oldest = fileCache.keys().next().value;
      if (oldest === undefined) break;
      fileCache.delete(oldest);
    }
  }

  function notifyDir(absPath: string, entries: readonly FolderEntry[]): void {
    for (const listener of dirListeners) listener(absPath, entries);
  }

  function invalidateDirAndAncestors(
    absPath: string,
    stopAtFolder: string,
  ): void {
    let cursor = trimTrailing(normalizePath(absPath));
    const root = trimTrailing(normalizePath(stopAtFolder));
    for (;;) {
      const loc = locateSync(cursor);
      if (loc !== null) dirCache.delete(dirCacheKey(machine, loc));
      if (cursor === root || cursor === "/") break;
      const next = parentPathOf(cursor);
      if (next === cursor) break;
      cursor = next;
    }
  }

  function invalidateSubtree(loc: LocatedPath): void {
    const exact = dirCacheKey(machine, loc);
    const prefix = loc.relPath === undefined ? exact : `${exact}/`;
    for (const key of [...dirCache.keys()]) {
      if (key === exact || key.startsWith(prefix)) dirCache.delete(key);
    }
    const fExact = fileCacheKey(machine, loc);
    const fPrefix = loc.relPath === undefined ? fExact : `${fExact}/`;
    for (const key of [...fileCache.keys()]) {
      if (key === fExact || key.startsWith(fPrefix)) fileCache.delete(key);
    }
  }

  function sameEntries(
    a: readonly FolderEntry[],
    b: readonly FolderEntry[],
  ): boolean {
    return (
      a.length === b.length &&
      a.every(
        (entry, index) =>
          entry.name === b[index]!.name && entry.kind === b[index]!.kind,
      )
    );
  }

  function fetchList(
    absPath: string,
    loc: LocatedPath,
    notifyOnChange: boolean,
  ): Promise<ReadResult<readonly FolderEntry[]>> {
    const key = dirCacheKey(machine, loc);
    const existing = dirInFlight.get(key);
    if (existing !== undefined) return existing;

    const promise = limitList(
      async (): Promise<ReadResult<readonly FolderEntry[]>> => {
        const reply = await core.call({
          kind: projectFilesList.kind,
          resource: projectFilesList.resource,
          method: projectFilesList.method,
          body: {
            project: loc.project,
            folder: loc.folder,
            ...(loc.relPath === undefined ? {} : { path: loc.relPath }),
          },
        });
        if (!reply.ok) {
          return { ok: false, message: reply.error?.code ?? "unavailable" };
        }
        const raw = (reply.value as { entries: readonly ProjectFileEntry[] })
          .entries;
        const entries: FolderEntry[] = raw.map((entry) => ({
          name: entry.name,
          kind: entry.kind,
        }));
        const meta = new Map<string, { size: number; modifiedAt: string }>();
        for (const entry of raw) {
          meta.set(entry.name, {
            size: entry.size,
            modifiedAt: entry.modified_at,
          });
          // 목록에서 mtime이 바뀐 파일은 읽기 cache를 비워 탭을 열 때 최신 본문을 읽게 한다.
          if (entry.kind === "file") {
            const childRel =
              loc.relPath === undefined
                ? entry.name
                : `${loc.relPath}/${entry.name}`;
            const fKey = fileCacheKey(machine, {
              project: loc.project,
              folder: loc.folder,
              relPath: childRel,
            });
            const cachedFile = fileCache.get(fKey);
            if (
              cachedFile !== undefined &&
              cachedFile.modifiedIso !== null &&
              cachedFile.modifiedIso !== entry.modified_at
            ) {
              fileCache.delete(fKey);
            }
          }
        }
        const before = dirCache.get(key);
        dirCache.set(key, { entries, meta, fetchedAt: now() });
        if (
          notifyOnChange &&
          (before === undefined || !sameEntries(before.entries, entries))
        ) {
          notifyDir(absPath, entries);
        }
        return { ok: true, value: entries };
      },
    ).finally(() => {
      dirInFlight.delete(key);
    });

    dirInFlight.set(key, promise);
    return promise;
  }

  function listCached(absPath: string): readonly FolderEntry[] | undefined {
    const loc = locateSync(absPath);
    if (loc === null) return undefined;
    return dirCache.get(dirCacheKey(machine, loc))?.entries;
  }

  async function list(
    absPath: string,
    opts?: { readonly force?: boolean },
  ): Promise<ReadResult<readonly FolderEntry[]>> {
    const loc = await locate(absPath);
    if (loc === null) return { ok: false, message: "not_found" };
    const key = dirCacheKey(machine, loc);
    const cached = dirCache.get(key);
    if (cached !== undefined && opts?.force !== true) {
      if (now() - cached.fetchedAt >= staleMs) {
        // stale-while-revalidate: 지금 cache를 0ms로 돌려주고 뒤에서 갱신한다.
        void fetchList(absPath, loc, true);
      }
      return { ok: true, value: cached.entries };
    }
    return fetchList(absPath, loc, false);
  }

  async function create(
    absPath: string,
    kind: "file" | "folder",
  ): Promise<FileOpResult> {
    const loc = await locate(absPath);
    if (loc === null || loc.relPath === undefined) {
      return { ok: false, code: "invalid_input" };
    }
    const reply = await core.call({
      kind: projectFilesCreate.kind,
      resource: projectFilesCreate.resource,
      method: projectFilesCreate.method,
      body: {
        project: loc.project,
        folder: loc.folder,
        path: loc.relPath,
        kind,
      },
    });
    if (!reply.ok) {
      return { ok: false, code: mapCoreFailure(reply.error?.code) };
    }
    invalidateDirAndAncestors(parentPathOf(absPath), loc.folder);
    return { ok: true };
  }

  async function rename(from: string, to: string): Promise<FileOpResult> {
    const fromLoc = await locate(from);
    const toLoc = await locate(to);
    if (
      fromLoc === null ||
      toLoc === null ||
      fromLoc.relPath === undefined ||
      toLoc.relPath === undefined ||
      fromLoc.project !== toLoc.project ||
      fromLoc.folder !== toLoc.folder
    ) {
      return { ok: false, code: "invalid_input" };
    }
    const reply = await core.call({
      kind: projectFilesRename.kind,
      resource: projectFilesRename.resource,
      method: projectFilesRename.method,
      body: {
        project: fromLoc.project,
        folder: fromLoc.folder,
        from: fromLoc.relPath,
        to: toLoc.relPath,
      },
    });
    if (!reply.ok) {
      return { ok: false, code: mapCoreFailure(reply.error?.code) };
    }
    invalidateSubtree(fromLoc);
    invalidateSubtree(toLoc);
    const fromParent = locateSync(parentPathOf(from));
    if (fromParent !== null) dirCache.delete(dirCacheKey(machine, fromParent));
    const toParent = locateSync(parentPathOf(to));
    if (toParent !== null) dirCache.delete(dirCacheKey(machine, toParent));
    return { ok: true };
  }

  async function copy(from: string, to: string): Promise<FileOpResult> {
    const fromLoc = await locate(from);
    const toLoc = await locate(to);
    if (
      fromLoc === null ||
      toLoc === null ||
      fromLoc.relPath === undefined ||
      toLoc.relPath === undefined ||
      fromLoc.project !== toLoc.project ||
      fromLoc.folder !== toLoc.folder
    ) {
      return { ok: false, code: "invalid_input" };
    }
    const reply = await core.call({
      kind: projectFilesCopy.kind,
      resource: projectFilesCopy.resource,
      method: projectFilesCopy.method,
      body: {
        project: fromLoc.project,
        folder: fromLoc.folder,
        from: fromLoc.relPath,
        to: toLoc.relPath,
        overwrite: false,
      },
    });
    if (!reply.ok) {
      return { ok: false, code: mapCoreFailure(reply.error?.code) };
    }
    invalidateSubtree(toLoc);
    invalidateDirAndAncestors(parentPathOf(to), toLoc.folder);
    return { ok: true };
  }

  async function writeBytesFile(
    absPath: string,
    bytes: Uint8Array,
    overwrite = false,
  ): Promise<FileReply<{ hash: string }>> {
    const loc = await locate(absPath);
    if (loc === null || loc.relPath === undefined) {
      return { ok: false, code: "invalid_input" };
    }
    if (bytes.byteLength > REMOTE_WRITE_BYTES_MAX) {
      return { ok: false, code: "too_large" };
    }
    const reply = await core.call({
      kind: projectFilesWriteBytes.kind,
      resource: projectFilesWriteBytes.resource,
      method: projectFilesWriteBytes.method,
      body: {
        project: loc.project,
        folder: loc.folder,
        path: loc.relPath,
        data_base64: bytesToBase64(bytes),
        overwrite,
      },
    });
    if (!reply.ok) {
      return { ok: false, code: mapCoreFailure(reply.error?.code) };
    }
    fileCache.delete(fileCacheKey(machine, loc));
    invalidateDirAndAncestors(parentPathOf(absPath), loc.folder);
    const { hash } = reply.value as { hash: string };
    return { ok: true, value: { hash } };
  }

  async function writeBytes(
    absPath: string,
    bytes: Uint8Array,
  ): Promise<FileOpResult> {
    const res = await writeBytesFile(absPath, bytes, false);
    return res.ok ? { ok: true } : { ok: false, code: res.code };
  }

  async function remove(absPath: string): Promise<FileOpResult> {
    const loc = await locate(absPath);
    if (loc === null || loc.relPath === undefined) {
      return { ok: false, code: "invalid_input" };
    }
    const reply = await core.call({
      kind: projectFilesRemove.kind,
      resource: projectFilesRemove.resource,
      method: projectFilesRemove.method,
      body: {
        project: loc.project,
        folder: loc.folder,
        path: loc.relPath,
      },
    });
    if (!reply.ok) {
      return { ok: false, code: mapCoreFailure(reply.error?.code) };
    }
    invalidateSubtree(loc);
    const parentLoc = locateSync(parentPathOf(absPath));
    if (parentLoc !== null) dirCache.delete(dirCacheKey(machine, parentLoc));
    return { ok: true };
  }

  async function readFile(absPath: string): Promise<FileReply<FileText>> {
    const loc = await locate(absPath);
    if (loc === null || loc.relPath === undefined) {
      return { ok: false, code: "forbidden" };
    }
    const key = fileCacheKey(machine, loc);
    const cached = fileCache.get(key);
    if (cached !== undefined && now() - cached.fetchedAt < readTtlMs) {
      if (cached.truncated) return { ok: false, code: "too_large" };
      if (cached.hash !== null) {
        return {
          ok: true,
          value: {
            text: cached.text,
            hash: cached.hash,
            modified_at: cached.modifiedAt,
          },
        };
      }
    }
    const pending = fileInFlight.get(key);
    if (pending !== undefined) return pending;

    const promise = (async (): Promise<FileReply<FileText>> => {
      const reply = await core.call({
        kind: projectFilesRead.kind,
        resource: projectFilesRead.resource,
        method: projectFilesRead.method,
        body: {
          project: loc.project,
          folder: loc.folder,
          path: loc.relPath,
        },
      });
      if (!reply.ok) {
        const code = reply.error?.code;
        if (code === "invalid_input") return { ok: false, code: "unsupported" };
        return { ok: false, code: mapCoreFailure(code) };
      }
      const value = reply.value as {
        text: string;
        truncated: boolean;
        hash?: string;
        modified_at?: string;
      };
      const modifiedAt =
        value.modified_at !== undefined
          ? Date.parse(value.modified_at) || now()
          : now();
      if (value.truncated) {
        setFileCache(key, {
          text: value.text,
          hash: null,
          modifiedAt,
          modifiedIso: value.modified_at ?? null,
          truncated: true,
          fetchedAt: now(),
        });
        return { ok: false, code: "too_large" };
      }
      const hash = value.hash ?? (await sha256Hex(value.text));
      setFileCache(key, {
        text: value.text,
        hash,
        modifiedAt,
        modifiedIso: value.modified_at ?? null,
        truncated: false,
        fetchedAt: now(),
      });
      return {
        ok: true,
        value: {
          text: value.text,
          hash,
          modified_at: modifiedAt,
        },
      };
    })().finally(() => {
      fileInFlight.delete(key);
    });

    fileInFlight.set(key, promise);
    return promise;
  }

  async function writeFile(input: {
    path: string;
    base_hash: string | null;
    text: string;
  }): Promise<FileReply<FileWritten>> {
    const loc = await locate(input.path);
    if (loc === null || loc.relPath === undefined) {
      return { ok: false, code: "forbidden" };
    }
    const bytes = new TextEncoder().encode(input.text);
    if (bytes.byteLength > PROJECT_FILE_MAX_BYTES) {
      return { ok: false, code: "too_large" };
    }
    const key = fileCacheKey(machine, loc);
    const reply = await core.call({
      kind: projectFilesWrite.kind,
      resource: projectFilesWrite.resource,
      method: projectFilesWrite.method,
      body: {
        project: loc.project,
        folder: loc.folder,
        path: loc.relPath,
        text: input.text,
        base_hash: input.base_hash,
      },
    });
    if (!reply.ok) {
      // 충돌·오류 뒤 SaveSession이 디스크 원본을 다시 읽으므로 cache를 비운다.
      fileCache.delete(key);
      return { ok: false, code: mapCoreFailure(reply.error?.code) };
    }
    const { hash } = reply.value as { hash: string };
    const ts = now();
    setFileCache(key, {
      text: input.text,
      hash,
      modifiedAt: ts,
      modifiedIso: null,
      truncated: false,
      fetchedAt: ts,
    });
    if (input.base_hash === null) {
      const parentLoc = locateSync(parentPathOf(input.path));
      if (parentLoc !== null) dirCache.delete(dirCacheKey(machine, parentLoc));
    }
    return { ok: true, value: { hash } };
  }

  const editorFiles: EditorFiles = {
    read: ({ path }) => readFile(path),
    async readBytes({ path }) {
      // 1 MiB를 넘겨 truncated된 글 파일은 읽기 전용 미리 보기로 돌려준다. 이미지·PDF는 remote project_files에 바이트 route가 없어 unsupported다.
      const loc = await locate(path);
      if (loc !== null && loc.relPath !== undefined) {
        const cached = fileCache.get(fileCacheKey(machine, loc));
        if (cached !== undefined && cached.truncated) {
          return {
            ok: true,
            value: {
              bytes: new TextEncoder().encode(cached.text),
              content_type: "text/plain",
              modified_at: cached.modifiedAt,
            },
          };
        }
      }
      return { ok: false, code: "unsupported" };
    },
    write: (input) => writeFile(input),
    writeBytes: ({ path, bytes }) => writeBytesFile(path, bytes, false),
    async delete({ path }) {
      const res = await remove(path);
      return res.ok ? { ok: true, value: {} } : res;
    },
    watch: () => Promise.resolve({ ok: true, value: {} }),
    onChanged: () => () => {},
    counts: () => {},
    onCloseRequest: () => () => {},
    answerClose: () => {},
  };

  return {
    registerProject,
    registerRoots,
    workspaceFiles: {
      remote: true,
      list,
      listCached,
      onDirectoryUpdated(listener) {
        dirListeners.add(listener);
        return () => dirListeners.delete(listener);
      },
      create,
      rename,
      copy,
      writeBytes,
      trash: remove,
    },
    editorFiles,
  };
}
