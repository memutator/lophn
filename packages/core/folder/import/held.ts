// 다른 release의 file을 data root에 그대로 복사해 둔다(held). 적용하지 않았고 잃지 않았다는 뜻이다.
// bytes를 `<root>/folder-held/<app>/<destination>/<origin>/<n>.<kind>`에 temp와 rename으로 쓰고(0600), 그 뒤 한 transaction에서
// `folder_held` 행과 cursor를 둔다. 복사 뒤 transaction 전에 죽으면 다음 번에 같은 file을 다시 쓴다(같은 bytes).
// held가 없어지는 길은 셋뿐이다: 이 기계가 그 release가 되어 적용했다(drain.ts), 같은 출처의 더 큰 번호 snapshot이
// 합쳐졌거나 held가 되어 그것이 담는다(`dropCovered`), 앱을 이 기계에서 지웠다.
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ok, type Result } from "../../../base/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  CONTAINER_HEAD_MAX_BYTES,
  type ContainerHead,
  type DataKind,
  entryNumber,
  type FolderFileError,
  HELD_MAX_BYTES,
  verifyContainer,
} from "../../../protocol/folder/mod.ts";
import type { FolderReader } from "../fs.ts";
import {
  type FolderImportDeps,
  hex16,
  loadRead,
  type ReadKey,
  saveRead,
} from "./deps.ts";

export const HELD_DIR = "folder-held";
// snapshot payload를 합치기 전에 풀어 두는 곳. 앱마다 한 번에 하나만 돌아 runApp이 시작할 때 비운다.
export const IMPORT_TMP_DIR = "folder-tmp";

// 1단계까지 둔 사본은 destination 없는 `<app>/<origin>/` 아래에 있고 행이 그 path를 그대로 든다.
export const heldPath = (key: ReadKey, n: number, kind: DataKind) =>
  `${HELD_DIR}/${key.app}/${key.destination}/${key.origin}/${entryNumber(n)}.${kind}`;

/**
 * 폴더 file을 `start`부터 끝까지 `target`에 temp로 쓰며 payload(`head.payloadOffset`부터)의 hash를 잰다. 크기와 hash가
 * header와 맞을 때만 temp를 `target`으로 rename한다. 맞지 않거나 읽지 못하면 temp를 지우고 아무것도 남기지 않는다.
 * 돌려주는 sha256과 size는 쓴 bytes 전체의 것이다.
 */
export async function copyVerified(
  reader: FolderReader,
  rel: string,
  head: ContainerHead,
  start: number,
  target: string,
  random: FolderImportDeps["random"],
): Promise<
  Result<
    { size: number; sha256: string },
    FolderFileError | { code: "unreadable"; message: string }
  >
> {
  const stream = await reader.readStream(rel, start);
  if (!stream.ok) {
    return {
      ok: false,
      error: { code: "unreadable", message: stream.error.message },
    };
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.tmp-${hex16(random)}`;
  const hash = createHash("sha256");
  const whole = createHash("sha256");
  let offset = start;
  let copied: { size: number; payloadSha256: string };
  try {
    const file = await open(temp, "wx", 0o600);
    try {
      for await (const chunk of stream.value
        .chunks as AsyncIterable<Uint8Array>) {
        const from = Math.max(0, head.payloadOffset - offset);
        if (from < chunk.byteLength) hash.update(chunk.subarray(from));
        whole.update(chunk);
        offset += chunk.byteLength;
        await file.write(chunk);
      }
      await file.sync();
    } finally {
      await file.close();
    }
    copied = { size: offset, payloadSha256: hash.digest("hex") };
  } catch (thrown) {
    await rm(temp, { force: true });
    return {
      ok: false,
      error: {
        code: "unreadable",
        message: `could not copy ${rel}: ${String(thrown)}`,
      },
    };
  }
  const verified = verifyContainer(head, copied);
  if (!verified.ok) {
    await rm(temp, { force: true });
    return verified;
  }
  await rename(temp, target);
  return ok({ size: copied.size - start, sha256: whole.digest("hex") });
}

/** 메모리에 다 읽은 file을 temp와 rename으로 쓴다. */
export async function writeAtomic(
  target: string,
  bytes: Uint8Array,
  random: FolderImportDeps["random"],
): Promise<void> {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.tmp-${hex16(random)}`;
  try {
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, target);
  } catch (thrown) {
    await rm(temp, { force: true });
    throw thrown;
  }
}

/**
 * 복사를 마친 held file의 행과 cursor를 한 transaction에서. snapshot이면 같은 출처의 그보다 옛 held를 같이 지우고
 * 그 사본 path를 돌려준다(부르는 쪽이 commit 뒤 지운다).
 */
export function recordHeld(
  deps: FolderImportDeps,
  input: ReadKey & {
    n: number;
    kind: DataKind;
    code_commit: string;
    data_schema: number;
    sha256: string;
    size: number;
  },
): Result<string[]> {
  const me = deps.machine();
  const at = deps.clock.now();
  return deps.transaction((tx) => {
    const covered =
      input.kind === "snapshot" ? dropCovered(tx.sql, me, input, input.n) : [];
    tx.sql.run(
      `INSERT INTO folder_held
         (machine, app, destination, origin, n, kind, code_commit, data_schema, path, sha256, size, held_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (machine, app, destination, origin, n) DO NOTHING`,
      [
        me,
        input.app,
        input.destination,
        input.origin,
        input.n,
        input.kind,
        input.code_commit,
        input.data_schema,
        heldPath(input, input.n, input.kind),
        input.sha256,
        input.size,
        at,
      ],
    );
    saveRead(tx.sql, me, input, {
      absent: loadRead(tx.sql, me, input).absent,
      cursor: input.n,
      code_commit: input.code_commit,
      read_at: at,
      attempts: 0,
      next_try_at: null,
      waiting_for: null,
      error: null,
    });
    return ok(covered);
  });
}

/**
 * 출처의 snapshot `n`이 합쳐지거나 held가 될 때, 부르는 쪽 transaction 안에서. 그 출처의 held 가운데 번호가 `n`보다 작은
 * 행을 release와 상관없이 지우고 사본 path를 돌려준다: 번호 n의 snapshot은 그 stream의 n보다 작은 번호의 변경을 모두
 * 담는다(폴더 계약 2).
 */
export function dropCovered(
  sql: Sql,
  me: Id<"mch">,
  key: ReadKey,
  n: number,
): string[] {
  const where = `machine = ? AND app = ? AND destination = ? AND origin = ? AND n < ?`;
  const params = [me, key.app, key.destination, key.origin, n];
  const paths = sql
    .all(`SELECT path FROM folder_held WHERE ${where}`, params)
    .map((row) => row.path as string);
  sql.run(`DELETE FROM folder_held WHERE ${where}`, params);
  return paths;
}

/** commit한 뒤 지운 held 행의 사본. 남은 file은 행이 없어 다시 읽히지 않는다. */
export async function removeHeldFiles(
  root: string,
  paths: readonly string[],
): Promise<void> {
  for (const rel of paths) await rm(heldFile(root, rel), { force: true });
}

/**
 * held changes `size` bytes를 더 복사하면 그 stream(destination, 출처)의 한도를 넘는가. 셈은 그 stream에서 가장 새 held snapshot 뒤의 held
 * changes다(그 앞은 snapshot이 담아 곧 지워진다). snapshot은 셈을 줄이므로 막지 않는다.
 */
export function heldOverLimit(
  sql: Pick<Sql, "get">,
  me: Id<"mch">,
  key: ReadKey,
  size: number,
  limit = HELD_MAX_BYTES,
): boolean {
  const stream = [me, key.app, key.destination, key.origin];
  const row = sql.get(
    `SELECT coalesce(sum(size), 0) AS bytes FROM folder_held
     WHERE machine = ? AND app = ? AND destination = ? AND origin = ? AND kind = 'changes'
       AND n > coalesce((SELECT max(n) FROM folder_held
         WHERE machine = ? AND app = ? AND destination = ? AND origin = ? AND kind = 'snapshot'), 0)`,
    [...stream, ...stream],
  );
  return Number(row?.bytes ?? 0) + size > limit;
}

/**
 * held changes 사본의 변경 수. header(2행)만 읽는다. 사본은 받을 때 검사를 마친 것이라 hash를 다시 보지 않는다.
 * 사본은 바뀌지 않아 `known`(path마다)에 둔다.
 */
export function heldChangeCount(
  root: string,
  rel: string,
  known: Map<string, number>,
): number {
  const cached = known.get(rel);
  if (cached !== undefined) return cached;
  let count = 0;
  try {
    const fd = openSync(heldFile(root, rel), "r");
    try {
      const bytes = new Uint8Array(CONTAINER_HEAD_MAX_BYTES);
      const read = readSync(fd, bytes, 0, bytes.byteLength, 0);
      const head = bytes.subarray(0, read);
      const end1 = head.indexOf(0x0a);
      const end2 = head.indexOf(0x0a, end1 + 1);
      const header = JSON.parse(
        new TextDecoder().decode(head.subarray(end1 + 1, end2)),
      ) as { changes?: unknown[] };
      count = header.changes?.length ?? 0;
    } finally {
      closeSync(fd);
    }
  } catch {
    // 사본이 없거나 깨졌다. drain이 그 행에서 멈추고 오류를 보인다.
    return 0;
  }
  known.set(rel, count);
  return count;
}

export const heldFile = (root: string, rel: string) =>
  join(root, ...rel.split("/"));

/** 그 앱의 held와 임시 file을 지운다. 앱을 이 기계에서 지울 때만. */
export async function removeAppFiles(
  root: string,
  app: Id<"app">,
): Promise<void> {
  await rm(join(root, HELD_DIR, app), { recursive: true, force: true });
  await rm(join(root, IMPORT_TMP_DIR, app), { recursive: true, force: true });
}
