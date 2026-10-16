import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import type { PreparedFile } from "../../../../protocol/lophn-agent/mod.ts";
import type { FileStat, JudgedFile } from "./judge.ts";
import type { RewindStore } from "./store.ts";

// 파일 복원의 transaction 밖 일이다(lophn-agent/revert "복원 쓰기"). 순서는 관측 →
// prepareRestore → (Rewind command) → installRestore다. 파일 일은 모두 async API다: core가 import하는
// 모듈이라 동기 file API를 두지 않는다(동기 관측은 prepare.ts, reader Worker용). root는 file tool에 열린
// 허용 폴더의 절대 경로이고 path는 그 기준 상대 경로다. 판정 단위(JudgedFile)가 자기 root를 가진다.

const hashOf = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const GONE: FileStat = { exists: false, sha256: null, link: false };

function missing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

// path가 root 안을 가리키는지 본다. 이미 있는 가장 가까운 상위 폴더의 실제 경로가 root 밖이면(상위
// 폴더가 symlink) 쓰지 않는다.
async function resolveInside(root: string, path: string): Promise<string> {
  const full = join(root, path);
  const outside = relative(root, full);
  if (outside === "" || outside.startsWith("..") || isAbsolute(outside)) {
    throw new Error("path is outside the project folder");
  }
  const realRoot = await realpath(root);
  let probe = dirname(full);
  for (;;) {
    try {
      const real = await realpath(probe);
      if (real !== realRoot && !real.startsWith(realRoot + sep)) {
        throw new Error("path is outside the project folder");
      }
      return full;
    } catch (error) {
      if (!missing(error)) throw error;
      const parent = dirname(probe);
      if (parent === probe) throw error;
      probe = parent;
    }
  }
}

async function observeOne(root: string, path: string): Promise<FileStat> {
  let full: string;
  try {
    full = await resolveInside(root, path);
  } catch (error) {
    // root 밖을 가리키는 경로는 건드리지 않는다.
    return missing(error) ? GONE : { exists: true, sha256: null, link: true };
  }
  let stat;
  try {
    stat = await lstat(full);
  } catch (error) {
    if (missing(error)) return GONE;
    throw error;
  }
  if (!stat.isFile() || stat.nlink > 1) {
    return { exists: true, sha256: null, link: true };
  }
  return {
    exists: true,
    sha256: hashOf(await readFile(full)),
    link: false,
  };
}

// 경로마다 지금 상태를 본다. symlink(lstat)이거나 hard link(nlink > 1)면 link=true다. 없는 경로는
// exists=false다. 내용은 sha256(hex)이다.
export async function observeFilesAsync(
  root: string,
  paths: readonly string[],
): Promise<Map<string, FileStat>> {
  const seen = new Map<string, FileStat>();
  for (const path of paths) seen.set(path, await observeOne(root, path));
  return seen;
}

// 쓰기 직전 내용(pre-image)을 읽는다. 파일이 없으면 null이다. root 밖이거나 일반 파일이 아니면 던진다.
export async function readInside(
  root: string,
  path: string,
): Promise<Uint8Array | null> {
  try {
    const full = await resolveInside(root, path);
    if (!(await lstat(full)).isFile()) throw new Error("not a file");
    return new Uint8Array(await readFile(full));
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

// 판정에 든 경로마다 PreparedFile 하나를 만든다(복원·건너뜀·이름 변경의 옛 경로 모두).
//   observed_sha256·link: current의 관측.
//   staged: plan=restore이고 write 동작이면 pre-image를 저장소에서 읽을 수 있어 true, 그 밖에는 false.
//   redo_ref: 다시 하기는 없어 늘 null이다.
export async function prepareRestore(input: {
  store: RewindStore;
  session: string;
  judged: readonly JudgedFile[];
  current: ReadonlyMap<string, FileStat>;
}): Promise<PreparedFile[]> {
  const prepared = new Map<string, PreparedFile>();
  for (const file of input.judged) {
    const restoring = file.plan === "restore";
    const paths = [file.path, ...file.actions.map((action) => action.path)];
    for (const path of new Set(paths)) {
      if (prepared.has(path)) continue;
      const seen = input.current.get(path) ?? GONE;
      const write = restoring
        ? file.actions.find((action) =>
          action.kind === "write" && action.path === path
        )
        : undefined;
      prepared.set(path, {
        path,
        observed_sha256: seen.sha256,
        link: seen.link,
        staged: write?.kind === "write"
          ? await staged(input.store, input.session, write.blob)
          : false,
        redo_ref: null,
      });
    }
  }
  return [...prepared.values()];
}

async function staged(
  store: RewindStore,
  session: string,
  key: string,
): Promise<boolean> {
  try {
    await store.read(session, key);
    return true;
  } catch {
    return false;
  }
}

export type InstallResult = {
  path: string;
  result: "restored" | "skipped";
};

async function replaceFile(
  full: string,
  content: Uint8Array,
  expected: string,
): Promise<void> {
  await mkdir(dirname(full), { recursive: true });
  let mode: number | undefined;
  try {
    mode = (await lstat(full)).mode & 0o777;
  } catch (error) {
    if (!missing(error)) throw error;
  }
  const temp = join(
    dirname(full),
    `.${basename(full)}.${randomUUID()}.lophn-tmp`,
  );
  try {
    await writeFile(temp, content);
    if (hashOf(await readFile(temp)) !== expected) {
      throw new Error("written content does not match its hash");
    }
    if (mode !== undefined) await chmod(temp, mode);
    await rename(temp, full);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

// 지금 hash가 준비 때 본 hash와 같을 때만 true다. 다르면 그 사이 누군가 고친 파일이다.
async function unchanged(
  root: string,
  path: string,
  prepared: PreparedFile | undefined,
): Promise<boolean> {
  if (prepared === undefined || prepared.link) return false;
  const now = await observeOne(root, path);
  return !now.link && now.sha256 === prepared.observed_sha256;
}

// 준비가 복원을 받쳐 주는가: 동작이 건드리는 경로마다 준비가 있고 link가 아니며, write 동작의
// pre-image를 저장소에서 읽을 수 있다. 준비가 없는 복원은 command가 restored로 기록하지 않고 설치도
// 하지 않는다.
export function restorable(
  file: JudgedFile,
  prepared: ReadonlyMap<string, PreparedFile>,
): boolean {
  return file.plan === "restore" && file.actions.every((action) => {
    const ready = prepared.get(action.path);
    return ready !== undefined && !ready.link &&
      (action.kind === "delete" || ready.staged);
  });
}

// Rewind command가 확정된 뒤 restorable한 plan=restore 경로를 복원한다. 경로마다 쓰기 직전에 지금
// hash가 prepared.observed_sha256과 같은지 다시 비교해 다르면 덮지 않고 skipped로 돌려준다. 같으면 임시
// 파일에 쓰고 hash를 확인해 원자 교체한다(없던 상위 폴더는 만든다). delete 동작은 파일을 지운다.
// 임시 파일은 남기지 않는다.
export async function installRestore(input: {
  store: RewindStore;
  session: string;
  judged: readonly JudgedFile[];
  prepared: readonly PreparedFile[];
}): Promise<InstallResult[]> {
  const byPath = new Map(input.prepared.map((file) => [file.path, file]));
  const results: InstallResult[] = [];
  for (const file of input.judged) {
    if (!restorable(file, byPath)) continue;
    const done = await installUnit(input, file, byPath);
    results.push({ path: file.path, result: done ? "restored" : "skipped" });
  }
  return results;
}

async function installUnit(
  input: { store: RewindStore; session: string },
  file: JudgedFile,
  byPath: ReadonlyMap<string, PreparedFile>,
): Promise<boolean> {
  try {
    const contents = new Map<string, Uint8Array>();
    for (const action of file.actions) {
      const prepared = byPath.get(action.path);
      if (!await unchanged(file.root, action.path, prepared)) return false;
      if (action.kind === "write") {
        contents.set(
          action.path,
          await input.store.read(input.session, action.blob),
        );
      }
    }
    for (const action of file.actions) {
      const full = await resolveInside(file.root, action.path);
      if (action.kind === "delete") {
        await rm(full, { force: true });
      } else {
        await replaceFile(full, contents.get(action.path)!, action.sha256);
      }
    }
    return true;
  } catch {
    return false;
  }
}
