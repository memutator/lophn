// `computers` 폴더의 받는 자리. link·폰·사람의 폴더가 가져온 다른 기계의 manifest와 file은 모두 여기를 지나 그 기계의
// 하위 폴더 `computers/machines/<그 기계>/`에 놓이고, 읽기(들이기, release, data 적용)는 그 폴더를 이름 붙인 폴더처럼
// 읽는다. 받는 쪽 규칙(`folder-sync.md`)을 길과 상관없이 여기 하나가 지킨다:
// - manifest: 명단의 컴퓨터 서명(`verifyManifest`)이 맞고 (그 기계, 그 서명 key)의 표시(`folder_carry_marks`)보다 revision이
//   클 때만 그 기계의 지금 목록이 된다. 표시는 하위 폴더 밖 ledger에 두고 지우지 않는다. 자기 manifest는 두지 않고 표시만 올린다.
// - file: 지금 목록의 사슬(manifest → 앱 목록 → source json)이 그 path를 그 크기·sha256으로 실을 때만, data root의 staging에 받아 맞으면
//   rename한다. rename 바로 앞에서 그때의 목록과 다시 견준다(그 사이에 await가 없다).
// - 지금 목록은 그것을 검증한 서명 key가 지금 명단의 key(`signingKey`)와 같을 때만 센다. 명단이 바뀌면 다시 검증하고, 맞지
//   않게 된 기계는 새것을 받지 않되 든 file은 둔다. 정해진 빼기(`removed`)로 빠진 기계의 하위 폴더는
//   `computers` 밖에 옮겨 두고(받지도 내주지도 읽지도 않는다) 그 상태로 `CARRY_REMOVED_GRACE_MS`가 지나야 지운다.
// - 목록 file 아래의 file은 그 목록 file의 지금 판을 든 뒤에만, 그 판이 싣지 않는 것만 지운다. 앱 목록의 가장 새
//   snapshot이 그 hash로 오기 전에는 그보다 앞 번호의 data file을 둔다.
// 자기 하위 폴더는 내보내기만 쓴다. 여기서는 읽기만 한다(남의 writer 검사가 그대로 맞는다).
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdir, open, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type Clock,
  err,
  ok,
  type RandomSource,
  type Result,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import {
  type CarryVia,
  COMPUTERS_DIR,
  expectedFiles,
  isCover,
  type ManifestBody,
  manifestBodySchema,
  manifestEntries,
  manifestPath,
  manifestPathMachine,
  newerManifest,
  parseCarryPath,
  verifyManifest,
} from "../../protocol/remote/carry.ts";
import {
  isMachineDirName,
  MACHINES_DIR,
  parseDataPath,
} from "../../protocol/folder/layout.ts";
import {
  CARRY_REMOVED_GRACE_MS,
  CARRY_STAGING_KEEP_MS,
} from "../../protocol/folder/limits.ts";
import type { Sql, Tx } from "../../protocol/server/mod.ts";
import type { CarryReceived, FolderReplica } from "./ports.ts";

export const CARRY_STAGING_DIR = "carry-staging";
export const CARRY_REMOVED_DIR = "carry-removed";
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

type Expected = { size: number; sha256: string };

export type ReplicaDeps = {
  dataRoot: string;
  machine(): Id<"mch">;
  /** 명단 view에서 그 기계의 하나뿐인 컴퓨터 항목의 서명 key(`ctx.computerSigningKey`). */
  signingKey(machine: string): string | null;
  /** 그 기계가 정해진 빼기로 명단에서 빠졌다(`ctx.computerRemoved`). */
  removed(machine: string): boolean;
  sql: Pick<Sql, "get">;
  transaction<T>(fn: (tx: Pick<Tx, "sql">) => Result<T>): Result<T>;
  clock: Clock;
  random: RandomSource;
  /** 든 manifest가 바뀌었다(`StateChanged{carry_files}`). */
  manifestsChanged(): void;
  /** 다른 기계의 하위 폴더에 file을 두거나 지웠다(읽기 scan을 깨우고, 그 scan이 `StateChanged{carry_files}`를 한 번 낸다). */
  filesChanged(path?: string): void;
};

export type Replica = FolderReplica & {
  /** 지금 목록이 그 path에 기대하는 크기와 sha256(자기 기계 포함). */
  expected(machine: Id<"mch">, path: string): Expected | null;
  /** 그 기계의 지금 목록이 싣는데 아직 없는 file 모두. */
  wantedOf(
    machine: Id<"mch">,
  ): Promise<{ path: string; size: number; sha256: string }[]>;
  /** 명단이 바뀐 뒤: 든 manifest를 지금 key로 다시 검증하고 정해진 빼기로 빠진 기계의 하위 폴더를 지운다. */
  recheck(): Promise<void>;
  readonly stagingDir: string;
};

type Held = {
  text: string;
  body: ManifestBody;
  // 마지막으로 검증한 서명 key. 지금 명단의 key와 같아야 센다.
  key: string | null;
  received_at: string | null;
  via: CarryVia | null;
};

function hex16(random: RandomSource): string {
  const bytes = new Uint8Array(8);
  random.fill(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function parseManifestText(text: string): ManifestBody | null {
  try {
    const parsed = manifestBodySchema.safeParse(
      (JSON.parse(text) as { body?: unknown }).body,
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** file의 sha256을 크기·수정 시각마다 한 번만 구한다. 받은 file과 거울의 file을 볼 때마다 다시 읽지 않는다. */
export function createShaCache() {
  const cache = new Map<string, { size: number; mtime: number; sha: string }>();
  async function shaOf(path: string, size: number): Promise<string | null> {
    let info;
    try {
      info = await stat(path);
    } catch {
      return null;
    }
    if (!info.isFile() || info.size !== size) return null;
    const hit = cache.get(path);
    if (hit?.size === info.size && hit.mtime === info.mtimeMs) return hit.sha;
    const hash = createHash("sha256");
    try {
      for await (const chunk of createReadStream(path)) hash.update(chunk);
    } catch {
      return null;
    }
    const sha = hash.digest("hex");
    cache.set(path, { size: info.size, mtime: info.mtimeMs, sha });
    return sha;
  }
  return {
    /** path에 그 크기·sha256의 file이 있다. */
    async matches(path: string, expected: Expected): Promise<boolean> {
      return (await shaOf(path, expected.size)) === expected.sha256;
    },
    remember(path: string, sha: string): void {
      try {
        const info = statSync(path);
        cache.set(path, { size: info.size, mtime: info.mtimeMs, sha });
      } catch {
        cache.delete(path);
      }
    },
  };
}

const same = (a: Expected | null, b: Expected) =>
  a !== null && a.size === b.size && a.sha256 === b.sha256;

// 작고 시급한 mail과 기계 기록을 큰 앱 snapshot·bundle보다 먼저 나르도록 `wants`·`wantedOf` 순서를 정한다.
// `wants`의 `after` cursor와 같은 comparator를 써서 page 넘김이 일관되게 유지된다.
function carryPathRank(path: string): number {
  const parts = path.split("/");
  if (parts[2] === "mail") return 0;
  if (
    parts.length === 3 &&
    (parts[2] === "record.json" || parts[2] === "roster.json")
  ) {
    return 1;
  }
  return 2;
}

export function compareCarryPath(a: string, b: string): number {
  const diff = carryPathRank(a) - carryPathRank(b);
  if (diff !== 0) return diff;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function createReplica(deps: ReplicaDeps): Replica {
  const root = join(deps.dataRoot, COMPUTERS_DIR);
  const stagingDir = join(deps.dataRoot, CARRY_STAGING_DIR);
  const removedDir = join(deps.dataRoot, CARRY_REMOVED_DIR);
  const abs = (path: string) => join(root, ...path.split("/"));
  const held = new Map<Id<"mch">, Held>();
  const shas = createShaCache();
  let loaded = false;
  // manifest를 받고, 다시 검증하고, 지우는 일은 하나씩 한다.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work);
    queue = next.catch(() => undefined);
    return next;
  }

  const markOf = (machine: string, key: string): number | null => {
    const row = deps.sql.get(
      "SELECT revision FROM folder_carry_marks WHERE machine = ? AND origin = ? AND signing_key = ?",
      [deps.machine(), machine, key],
    );
    return row === undefined ? null : Number(row.revision);
  };
  const saveMark = (machine: string, key: string, revision: number) =>
    deps.transaction((tx) => {
      tx.sql.run(
        `INSERT INTO folder_carry_marks (machine, origin, signing_key, revision) VALUES (?, ?, ?, ?)
         ON CONFLICT (machine, origin, signing_key) DO UPDATE SET
           revision = max(folder_carry_marks.revision, excluded.revision)`,
        [deps.machine(), machine, key, revision],
      );
      return ok(undefined);
    });

  // 정해진 빼기로 빠졌고 아직 지우지 않은 컴퓨터의 하위 폴더(`carry-removed/<mch>`, 처음 본 때는 `<mch>.since`).
  const parkedMachines = (): Id<"mch">[] => {
    try {
      return readdirSync(removedDir).filter(isMachineDirName).sort();
    } catch {
      return [];
    }
  };

  const otherMachines = (): Id<"mch">[] => {
    try {
      return readdirSync(join(root, MACHINES_DIR))
        .filter(isMachineDirName)
        .filter((machine) => machine !== deps.machine())
        .sort();
    } catch {
      return [];
    }
  };

  const readText = (path: string): string | null => {
    try {
      return readFileSync(abs(path), "utf8");
    } catch {
      return null;
    }
  };

  // 든 manifest를 읽는다. 지금 명단으로 맞지 않아도 body는 든다(명단이 바뀌면 다시 본다).
  function load(): void {
    if (loaded) return;
    loaded = true;
    for (const machine of otherMachines()) loadMachine(machine);
  }

  function loadMachine(machine: Id<"mch">): void {
    const text = readText(manifestPath(machine));
    if (text === null) return;
    const verified = verifyManifest(text, deps.signingKey);
    const body = verified?.body ?? parseManifestText(text);
    if (body === null || body.machine !== machine) return;
    held.set(machine, {
      text,
      body,
      key: verified?.signingKey ?? null,
      received_at: null,
      via: null,
    });
    // rename 뒤 표시를 쓰기 전에 꺼졌다.
    if (
      verified !== null &&
      newerManifest(markOf(machine, verified.signingKey), body)
    ) {
      saveMark(machine, verified.signingKey, body.revision);
    }
  }

  // 그 기계의 지금 목록. 자기 것은 내보내기가 쓴 file이다(검증하지 않는다).
  function currentBody(machine: Id<"mch">): ManifestBody | null {
    if (machine === deps.machine()) {
      const text = readText(manifestPath(machine));
      const body = text === null ? null : parseManifestText(text);
      return body?.machine === machine ? body : null;
    }
    load();
    const found = held.get(machine);
    if (found === undefined || found.key === null) return null;
    return found.key === deps.signingKey(machine) ? found.body : null;
  }

  // 든 목록 file이 기대한 그대로일 때 그것이 싣는 file. 그대로가 아니면(없거나 앞 판) null. (file, 크기, 수정 시각, 기대한
  // sha256)마다 한 번만 읽고 hash한다: `carry/file`, `carry/put`, `receive`마다 앱 목록(8 MiB까지)과 source json을 다시 읽지
  // 않는다. 맞은 것만 둔다: 같은 크기·같은 수정 시각(초 단위 시각의 file system)으로 새 판이 오면 "맞지 않음"이 남는다.
  const covers = new Map<
    string,
    { size: number; mtime: number; sha: string; entries: Map<string, Expected> }
  >();
  function coverEntries(
    machine: Id<"mch">,
    path: string,
    want: Expected,
  ): Map<string, Expected> | null {
    const file = abs(path);
    let info;
    try {
      info = statSync(file);
    } catch {
      return null;
    }
    if (info.size !== want.size) return null;
    const hit = covers.get(file);
    if (
      hit?.size === info.size &&
      hit.mtime === info.mtimeMs &&
      hit.sha === want.sha256
    ) {
      return hit.entries;
    }
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(file);
    } catch {
      return null;
    }
    if (createHash("sha256").update(bytes).digest("hex") !== want.sha256) {
      return null;
    }
    // 그 목록 file 하나만 실은 목록으로 사슬 한 층을 편다(검사와 해석은 `expectedFiles`가 한다).
    const entries = expectedFiles(
      {
        format: 1,
        machine,
        revision: 1,
        written_at: "1970-01-01T00:00:00.000Z",
        files: [{ path, ...want }],
      },
      (asked) => (asked === path ? bytes : null),
    );
    entries.delete(path);
    covers.set(file, {
      size: info.size,
      mtime: info.mtimeMs,
      sha: want.sha256,
      entries,
    });
    return entries;
  }

  // 지금 목록이 path에 기대하는 것: 위 목록 file을 따라 올라간다.
  function expectedIn(
    machine: Id<"mch">,
    body: ManifestBody,
    path: string,
  ): Expected | null {
    const parsed = parseCarryPath(path);
    if (parsed === null || parsed.machine !== machine) return null;
    if (parsed.coveredBy === null) {
      const found = manifestEntries(body).find((file) => file.path === path);
      return found === undefined
        ? null
        : { size: found.size, sha256: found.sha256 };
    }
    const cover = expectedIn(machine, body, parsed.coveredBy);
    return cover === null
      ? null
      : (coverEntries(machine, parsed.coveredBy, cover)?.get(path) ?? null);
  }

  // 지금 목록 사슬 전체(`expectedFiles`와 같은 것)와, 그 가운데 지금 판 그대로 든 목록 file.
  function chainOf(machine: Id<"mch">, body: ManifestBody) {
    const files = new Map<string, Expected>();
    const current = new Set<string>();
    const queue: [string, Expected][] = manifestEntries(body).map((file) => [
      file.path,
      { size: file.size, sha256: file.sha256 },
    ]);
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const [path, want] = next;
      if (files.has(path)) continue;
      files.set(path, want);
      if (!isCover(path)) continue;
      const listed = coverEntries(machine, path, want);
      if (listed === null) continue;
      current.add(path);
      queue.push(...listed);
    }
    return { files, current };
  }

  function expected(machine: Id<"mch">, path: string): Expected | null {
    const body = currentBody(machine);
    return body === null ? null : expectedIn(machine, body, path);
  }

  async function wantedOf(machine: Id<"mch">) {
    const body = machine === deps.machine() ? null : currentBody(machine);
    if (body === null) return [];
    const out: { path: string; size: number; sha256: string }[] = [];
    const entries = [...chainOf(machine, body).files].sort(([a], [b]) =>
      compareCarryPath(a, b),
    );
    for (const [path, want] of entries) {
      if (!(await shas.matches(abs(path), want))) out.push({ path, ...want });
    }
    return out;
  }

  // 하위 폴더 아래 file(manifest 밖)의 path. 없으면 빈 목록.
  function heldFiles(machine: Id<"mch">): string[] {
    const base = abs(`${MACHINES_DIR}/${machine}`);
    try {
      return readdirSync(base, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) =>
          [
            `${MACHINES_DIR}/${machine}`,
            ...join(entry.parentPath, entry.name)
              .slice(base.length + 1)
              .split(/[\\/]/),
          ].join("/"),
        )
        .filter((path) => path !== manifestPath(machine));
    } catch {
      return [];
    }
  }

  function removeEmptyDirs(dir: string, keep: boolean): void {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(dir, name);
      try {
        if (statSync(path).isDirectory()) removeEmptyDirs(path, false);
      } catch {
        // 사이에 사라졌다.
      }
    }
    if (keep) return;
    try {
      rmdirSync(dir);
    } catch {
      // 비지 않았다.
    }
  }

  // 지금 목록 사슬이 더는 싣지 않는 file을 지운다. 목록 file이 지금 판이 아닌 동안은 그 앞 판이 싣던 file을 둔다. 사슬을
  // 편 때와 지울 때 사이에 await가 없다: 그 사이 새 목록 file이 rename되면 옛 사슬로 정한 것이 새 목록이 싣는 file을 지운다.
  async function prune(machine: Id<"mch">): Promise<number> {
    const before = currentBody(machine);
    if (before === null) return 0;
    // 앱마다 목록의 가장 새 snapshot이 아직 그 hash로 오지 않았으면 그보다 앞 번호의 data file을 둔다: 지우면 그 snapshot이
    // 올 때까지 읽기가 적용할 것이 없다(아직 적용하지 않은 변경을 버린다). 그 사이 snapshot이 와도 더 두는 쪽이다.
    const newest = new Map<
      string,
      { n: number; path: string; want: Expected }
    >();
    for (const [path, want] of chainOf(machine, before).files) {
      const data = parseDataPath(path);
      if (data?.kind !== "snapshot") continue;
      if ((newest.get(data.app)?.n ?? 0) < data.n) {
        newest.set(data.app, { n: data.n, path, want });
      }
    }
    const waiting = new Map<string, number>();
    for (const [app, snapshot] of newest) {
      if (!(await shas.matches(abs(snapshot.path), snapshot.want))) {
        waiting.set(app, snapshot.n);
      }
    }
    const body = currentBody(machine);
    if (body === null) return 0;
    const { files: wanted, current } = chainOf(machine, body);
    const verdict = new Map<string, boolean>();
    const keep = (path: string): boolean => {
      const known = verdict.get(path);
      if (known !== undefined) return known;
      let result: boolean;
      const parsed = parseCarryPath(path);
      const data = parseDataPath(path);
      if (wanted.has(path) || parsed === null) result = true;
      else if (data !== null && data.n < (waiting.get(data.app) ?? 0)) {
        result = true;
      } else if (parsed.coveredBy === null) result = false;
      // 지금 판인 목록 file이 싣지 않는다.
      else if (current.has(parsed.coveredBy)) result = false;
      // 목록 file이 앞 판이면 그것을 따른다(지금 사슬에서 빠졌으면 그 위가 정한다).
      else result = keep(parsed.coveredBy);
      verdict.set(path, result);
      return result;
    };
    const doomed = heldFiles(machine).filter((path) => !keep(path));
    for (const path of doomed) rmSync(abs(path), { force: true });
    if (doomed.length > 0) {
      removeEmptyDirs(abs(`${MACHINES_DIR}/${machine}`), true);
    }
    return doomed.length;
  }

  async function offer(text: string, via: CarryVia): Promise<CarryReceived> {
    load();
    const verified = verifyManifest(text, deps.signingKey);
    if (verified === null) return "rejected";
    const { body, signingKey } = verified;
    const machine = body.machine as Id<"mch">;
    const mark = markOf(machine, signingKey);
    if (machine === deps.machine()) {
      // 되돌아온 자기 manifest: 두지 않고 다음 revision이 그보다 크게 표시만 올린다.
      if (newerManifest(mark, body)) {
        const saved = saveMark(machine, signingKey, body.revision);
        if (!saved.ok) throw new Error(saved.error.message);
      }
      return "have";
    }
    if (!newerManifest(mark, body)) return "have";
    await mkdir(stagingDir, { recursive: true, mode: DIR_MODE });
    const temp = join(stagingDir, `manifest-${hex16(deps.random)}`);
    const handle = await open(temp, "wx", FILE_MODE);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const target = abs(manifestPath(machine));
    mkdirSync(dirname(target), { recursive: true, mode: DIR_MODE });
    renameSync(temp, target);
    const saved = saveMark(machine, signingKey, body.revision);
    if (!saved.ok) throw new Error(saved.error.message);
    held.set(machine, {
      text,
      body,
      key: signingKey,
      received_at: deps.clock.now(),
      via,
    });
    const removed = await prune(machine);
    deps.manifestsChanged();
    if (removed > 0) deps.filesChanged();
    return "accepted";
  }

  async function sha256OfFile(file: string): Promise<string> {
    const hash = createHash("sha256");
    const handle = await open(file, "r");
    try {
      const buffer = new Uint8Array(1024 * 1024);
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        hash.update(buffer.subarray(0, bytesRead));
      }
    } finally {
      await handle.close();
    }
    return hash.digest("hex");
  }

  // 받다 끊긴 file은 (machine, path, sha256)마다 staging에 남겨 다음 pass가 그 크기부터 잇는다. 같은 file을 두 상대에게서 같이
  // 받으면 이어 쓰기가 섞이므로 받는 동안은 표시해 둔다. 오래 둔 것은 지운다(그 사이 목록이 바뀌었을 수 있다).
  const receiving = new Set<string>();
  const partialPath = (input: {
    machine: string;
    path: string;
    sha256: string;
  }) =>
    join(
      stagingDir,
      `partial-${createHash("sha256").update(`${input.machine}\n${input.path}\n${input.sha256}`).digest("hex")}`,
    );

  async function sweepPartials(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(stagingDir);
    } catch {
      return;
    }
    const cutoff = deps.clock.nowMs() - CARRY_STAGING_KEEP_MS;
    for (const name of names) {
      if (!name.startsWith("partial-")) continue;
      const file = join(stagingDir, name);
      if (receiving.has(file)) continue;
      try {
        if ((await stat(file)).mtimeMs < cutoff)
          await rm(file, { force: true });
      } catch {
        // 사이에 끝났다.
      }
    }
  }

  async function received(input: {
    machine: Id<"mch">;
    path: string;
    sha256: string;
  }): Promise<number | null> {
    const file = partialPath(input);
    if (receiving.has(file)) return null;
    try {
      return (await stat(file)).size;
    } catch {
      return 0;
    }
  }

  async function receive(input: {
    machine: Id<"mch">;
    path: string;
    size: number;
    sha256: string;
    via: CarryVia;
    chunks: AsyncIterable<Uint8Array>;
    offset?: number;
  }): Promise<Result<CarryReceived>> {
    const { machine, path } = input;
    // 자기 하위 폴더는 내보내기만 쓴다.
    if (
      machine === deps.machine() ||
      parseCarryPath(path)?.machine !== machine
    ) {
      return ok("rejected");
    }
    if (!same(expected(machine, path), input)) return ok("rejected");
    if (await shas.matches(abs(path), input)) return ok("have");
    const temp = partialPath(input);
    if (receiving.has(temp)) return ok("rejected");
    receiving.add(temp);
    try {
      await mkdir(stagingDir, { recursive: true, mode: DIR_MODE });
      await sweepPartials();
      const start = input.offset ?? 0;
      let size = 0;
      try {
        size = (await stat(temp)).size;
      } catch {
        size = 0;
      }
      // 앞서 받은 만큼과 이어지지 않으면 처음부터다.
      if (size !== start) {
        if (start !== 0) return ok("rejected");
        size = 0;
      }
      const handle = await open(temp, start === 0 ? "w" : "a", FILE_MODE);
      try {
        for await (const chunk of input.chunks) {
          size += chunk.byteLength;
          if (size > input.size) break;
          await handle.write(chunk);
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      // 모자라면 받은 만큼을 두고 다음에 잇는다.
      if (size < input.size) return ok("rejected");
      if (size !== input.size || (await sha256OfFile(temp)) !== input.sha256) {
        await rm(temp, { force: true });
        return ok("rejected");
      }
      // 받는 사이 목록이 바뀌었을 수 있다. 다시 보고 await 없이 rename한다.
      if (!same(expected(machine, path), input)) {
        await rm(temp, { force: true });
        return ok("rejected");
      }
      const target = abs(path);
      mkdirSync(dirname(target), { recursive: true, mode: DIR_MODE });
      renameSync(temp, target);
      shas.remember(target, input.sha256);
    } catch (thrown) {
      return err({
        code: "unavailable",
        message: `could not receive ${path}: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      });
    } finally {
      receiving.delete(temp);
    }
    // 목록 file이나 snapshot이 오면 그것이 덮는 앞 판의 file을 지울 수 있다.
    if (isCover(path) || parseDataPath(path)?.kind === "snapshot") {
      await serial(() => prune(machine));
    }
    deps.filesChanged(path);
    return ok("accepted");
  }

  async function holds(machine: Id<"mch">, path: string): Promise<boolean> {
    if (manifestPathMachine(path) === machine) {
      return machine === deps.machine()
        ? existsSync(abs(path))
        : currentBody(machine) !== null;
    }
    const want = expected(machine, path);
    return want !== null && (await shas.matches(abs(path), want));
  }

  return {
    stagingDir,
    expected,
    wantedOf,

    async manifests() {
      load();
      const out = [];
      for (const machine of [deps.machine(), ...held.keys()].sort()) {
        const text =
          machine === deps.machine()
            ? readText(manifestPath(machine))
            : currentBody(machine) === null
              ? null
              : held.get(machine)!.text;
        const body = text === null ? null : parseManifestText(text);
        if (text === null || body === null) continue;
        const bytes = new TextEncoder().encode(text);
        const found = held.get(machine);
        out.push({
          machine,
          revision: body.revision,
          size: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          received_at: found?.received_at ?? null,
          via: found?.via ?? null,
        });
      }
      return ok(out);
    },

    async offerManifest(text, via) {
      try {
        return ok(await serial(() => offer(text, via)));
      } catch (thrown) {
        return err({
          code: "unavailable",
          message: `could not keep the manifest: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
        });
      }
    },

    async wants(limit, after) {
      load();
      const out: {
        machine: Id<"mch">;
        path: string;
        size: number;
        sha256: string;
      }[] = [];
      for (const machine of [...held.keys()].sort()) {
        if (after !== undefined && machine < after.machine) continue;
        for (const file of await wantedOf(machine)) {
          if (
            after !== undefined &&
            machine === after.machine &&
            compareCarryPath(file.path, after.path) <= 0
          ) {
            continue;
          }
          out.push({ machine, ...file });
          if (out.length >= limit) return ok(out);
        }
      }
      return ok(out);
    },

    holds,

    async read(machine, path, offset, length) {
      if (!(await holds(machine, path))) {
        return err({ code: "not_found", message: `${path} is not held here` });
      }
      try {
        const handle = await open(abs(path), "r");
        try {
          const bytes = new Uint8Array(length);
          let filled = 0;
          while (filled < length) {
            const { bytesRead } = await handle.read(
              bytes,
              filled,
              length - filled,
              offset + filled,
            );
            if (bytesRead === 0) break;
            filled += bytesRead;
          }
          return ok(bytes.subarray(0, filled));
        } finally {
          await handle.close();
        }
      } catch {
        return err({ code: "not_found", message: `${path} is not held here` });
      }
    },

    receive,
    received,

    recheck: () =>
      serial(async () => {
        load();
        let manifests = false;
        let files = false;
        for (const [machine, found] of held) {
          const verified = verifyManifest(found.text, deps.signingKey);
          const key = verified?.signingKey ?? null;
          if (key !== found.key) {
            found.key = key;
            manifests = true;
          }
          if (
            verified !== null &&
            newerManifest(markOf(machine, verified.signingKey), found.body)
          ) {
            saveMark(machine, verified.signingKey, found.body.revision);
          }
        }
        // 정해진 빼기로 빠진 컴퓨터의 하위 폴더는 `computers` 밖으로 옮겨 두고(읽기가 더 읽지 않는다) 처음 본 때부터
        // `CARRY_REMOVED_GRACE_MS`가 지나면 지운다. 그 사이 빼기가 풀리면 되돌린다. 처음 본 때(`<mch>.since`)는 옮기기 전에
        // 늘 새로 쓰고, 되돌리거나 지울 때는 먼저 지운다: 그 사이에 꺼져 남은 옛 때가 다음 빼기의 기다림을 건너뛰게 하지 않는다.
        const nowMs = deps.clock.nowMs();
        const stamp = (machine: Id<"mch">) => {
          const temp = join(
            removedDir,
            `${machine}.since.tmp-${hex16(deps.random)}`,
          );
          writeFileSync(temp, String(nowMs), { mode: FILE_MODE });
          renameSync(temp, join(removedDir, `${machine}.since`));
        };
        for (const machine of otherMachines()) {
          if (!deps.removed(machine)) continue;
          mkdirSync(removedDir, { recursive: true, mode: DIR_MODE });
          stamp(machine);
          rmSync(join(removedDir, machine), { recursive: true, force: true });
          renameSync(
            abs(`${MACHINES_DIR}/${machine}`),
            join(removedDir, machine),
          );
          held.delete(machine);
          manifests = true;
          files = true;
        }
        for (const machine of parkedMachines()) {
          const parked = join(removedDir, machine);
          const since = join(removedDir, `${machine}.since`);
          if (!deps.removed(machine)) {
            rmSync(since, { force: true });
            const back = abs(`${MACHINES_DIR}/${machine}`);
            if (existsSync(back)) {
              rmSync(parked, { recursive: true, force: true });
            } else {
              mkdirSync(dirname(back), { recursive: true, mode: DIR_MODE });
              renameSync(parked, back);
              loadMachine(machine);
            }
            manifests = true;
            files = true;
            continue;
          }
          let seen: number;
          try {
            seen = Number(readFileSync(since, "utf8"));
          } catch {
            seen = Number.NaN;
          }
          // 없거나 읽지 못하는 때는 지금으로 다시 쓴다(기다림이 다시 시작한다).
          if (!Number.isSafeInteger(seen) || seen <= 0) {
            stamp(machine);
            continue;
          }
          if (nowMs - seen >= CARRY_REMOVED_GRACE_MS) {
            rmSync(since, { force: true });
            rmSync(parked, { recursive: true, force: true });
          }
        }
        for (const machine of held.keys()) {
          if ((await prune(machine)) > 0) files = true;
        }
        if (manifests) deps.manifestsChanged();
        if (files) deps.filesChanged();
      }),
  };
}
