// `computers` 폴더의 받는 자리. link·폰·사람의 폴더가 가져온 다른 기계의 manifest와 file은 모두 여기를 지나 그 기계의
// 하위 폴더 `computers/machines/<그 기계>/`에 놓이고, 읽기(들이기, release, data 적용)는 그 폴더를 이름 붙인 폴더처럼
// 읽는다. 받는 쪽 규칙(`folder-sync.md`)을 길과 상관없이 여기 하나가 지킨다:
// - manifest: 명단의 컴퓨터 서명(`verifyManifest`)이 맞고 (그 기계, 그 서명 key)의 표시(`folder_carry_marks`)보다 revision이
//   클 때만 그 기계의 지금 목록이 된다. 표시는 하위 폴더 밖 ledger에 두고 지우지 않는다. 자기 manifest는 두지 않고 표시만 올린다.
// - file: 지금 목록의 사슬(`expectedFile`)이 그 path를 그 크기·sha256으로 실을 때만, data root의 staging에 받아 맞으면
//   rename한다. rename 바로 앞에서 그때의 목록과 다시 견준다(그 사이에 await가 없다).
// - 지금 목록은 그것을 검증한 서명 key가 지금 명단의 key(`signingKey`)와 같을 때만 센다. 명단이 바뀌면 다시 검증하고, 맞지
//   않게 된 기계는 새것을 받지 않되 든 file은 둔다. 하위 폴더를 통째로 지우는 것은 정해진 빼기(`removed`)일 때뿐이다.
// - 목록 file 아래의 file은 그 목록 file의 지금 판을 든 뒤에만, 그 판이 싣지 않는 것만 지운다.
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
} from "node:fs";
import { mkdir, open, rm, stat } from "node:fs/promises";
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
  expectedFile,
  expectedFiles,
  type ManifestBody,
  manifestBodySchema,
  manifestPath,
  manifestPathMachine,
  newerManifest,
  parseCarryPath,
  verifyManifest,
} from "../../protocol/folder/carry.ts";
import {
  isMachineDirName,
  MACHINES_DIR,
} from "../../protocol/folder/layout.ts";
import type { Sql, Tx } from "../../protocol/server/mod.ts";
import type { CarryReceived, FolderReplica } from "./ports.ts";

export const CARRY_STAGING_DIR = "carry-staging";
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
  /** 다른 기계의 하위 폴더에 file을 두거나 지웠다(읽기 scan을 깨운다). */
  filesChanged(): void;
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

// 목록 file(앱 목록, release.json, source/<n>.json). 이것을 받으면 그 아래 지울 것이 생길 수 있다.
const COVER =
  /\/(apps\/[^/]+\/files|releases\/[0-9a-f]{64}\/release|source\/[0-9]{12})\.json$/;

const same = (a: Expected | null, b: Expected) =>
  a !== null && a.size === b.size && a.sha256 === b.sha256;

export function createReplica(deps: ReplicaDeps): Replica {
  const root = join(deps.dataRoot, COMPUTERS_DIR);
  const stagingDir = join(deps.dataRoot, CARRY_STAGING_DIR);
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
    for (const machine of otherMachines()) {
      const text = readText(manifestPath(machine));
      if (text === null) continue;
      const verified = verifyManifest(text, deps.signingKey);
      const body = verified?.body ?? parseManifestText(text);
      if (body === null || body.machine !== machine) continue;
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

  const heldBytes = () => {
    const memo = new Map<string, Uint8Array | null>();
    return (path: string): Uint8Array | null => {
      if (!memo.has(path)) {
        try {
          memo.set(path, readFileSync(abs(path)));
        } catch {
          memo.set(path, null);
        }
      }
      return memo.get(path)!;
    };
  };

  function expected(machine: Id<"mch">, path: string): Expected | null {
    const body = currentBody(machine);
    return body === null ? null : expectedFile(body, path, heldBytes());
  }

  async function wantedOf(machine: Id<"mch">) {
    const body = machine === deps.machine() ? null : currentBody(machine);
    if (body === null) return [];
    const out: { path: string; size: number; sha256: string }[] = [];
    const entries = [...expectedFiles(body, heldBytes())].sort(([a], [b]) =>
      a < b ? -1 : 1,
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

  // 지금 목록 사슬이 더는 싣지 않는 file을 지운다. 목록 file이 지금 판이 아닌 동안은 그 앞 판이 싣던 file을 둔다.
  async function prune(machine: Id<"mch">): Promise<number> {
    const body = currentBody(machine);
    if (body === null) return 0;
    const files = heldFiles(machine);
    const wanted = expectedFiles(body, heldBytes());
    const verdict = new Map<string, boolean>();
    const keep = async (path: string): Promise<boolean> => {
      const known = verdict.get(path);
      if (known !== undefined) return known;
      let result: boolean;
      const parsed = parseCarryPath(path);
      if (wanted.has(path) || parsed === null) result = true;
      else if (parsed.coveredBy === null) result = false;
      else if (!existsSync(abs(parsed.coveredBy))) result = false;
      else {
        const cover = wanted.get(parsed.coveredBy);
        result =
          cover !== undefined &&
          (await shas.matches(abs(parsed.coveredBy), cover))
            ? false
            : await keep(parsed.coveredBy);
      }
      verdict.set(path, result);
      return result;
    };
    const doomed: string[] = [];
    for (const path of files) if (!(await keep(path))) doomed.push(path);
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

  async function receive(input: {
    machine: Id<"mch">;
    path: string;
    size: number;
    sha256: string;
    via: CarryVia;
    chunks: AsyncIterable<Uint8Array>;
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
    const temp = join(stagingDir, `file-${hex16(deps.random)}`);
    try {
      await mkdir(stagingDir, { recursive: true, mode: DIR_MODE });
      const hash = createHash("sha256");
      let size = 0;
      const handle = await open(temp, "wx", FILE_MODE);
      try {
        for await (const chunk of input.chunks) {
          size += chunk.byteLength;
          if (size > input.size) break;
          hash.update(chunk);
          await handle.write(chunk);
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (size !== input.size || hash.digest("hex") !== input.sha256) {
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
      await rm(temp, { force: true }).catch(() => undefined);
      return err({
        code: "unavailable",
        message: `could not receive ${path}: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      });
    }
    if (COVER.test(path)) await serial(() => prune(machine));
    deps.filesChanged();
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
            file.path <= after.path
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
        for (const machine of otherMachines()) {
          if (!deps.removed(machine)) continue;
          rmSync(abs(`${MACHINES_DIR}/${machine}`), {
            recursive: true,
            force: true,
          });
          held.delete(machine);
          manifests = true;
          files = true;
        }
        for (const machine of held.keys()) {
          if ((await prune(machine)) > 0) files = true;
        }
        if (manifests) deps.manifestsChanged();
        if (files) deps.filesChanged();
      }),
  };
}
