// 다른 release의 file을 data root에 그대로 복사해 둔다(held). 적용하지 않았고 잃지 않았다는 뜻이다.
// bytes를 `<root>/folder-held/<app>/<origin>/<n>.<kind>`에 temp와 rename으로 쓰고(0600), 그 뒤 한 transaction에서
// `folder_held` 행과 cursor를 둔다. 복사 뒤 transaction 전에 죽으면 다음 번에 같은 file을 다시 쓴다(같은 bytes).
// held는 적용하지도 지우지도 않는다(앱을 이 기계에서 지울 때만).
import { createHash } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  type ContainerHead,
  type DataKind,
  entryNumber,
  type FolderFileError,
  verifyContainer,
} from "../../../protocol/folder/mod.ts";
import type { FolderReader } from "../fs.ts";
import { type FolderImportDeps, hex16, saveRead } from "./deps.ts";

export const HELD_DIR = "folder-held";
// snapshot payload를 합치기 전에 풀어 두는 곳. 앱마다 한 번에 하나만 돌아 runApp이 시작할 때 비운다.
export const IMPORT_TMP_DIR = "folder-tmp";

export const heldPath = (
  app: Id<"app">,
  origin: Id<"mch">,
  n: number,
  kind: DataKind,
) => `${HELD_DIR}/${app}/${origin}/${entryNumber(n)}.${kind}`;

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

/** 복사를 마친 held file의 행과 cursor를 한 transaction에서. */
export function recordHeld(
  deps: FolderImportDeps,
  input: {
    app: Id<"app">;
    origin: Id<"mch">;
    n: number;
    kind: DataKind;
    bundle_hash: string;
    data_schema: number;
    sha256: string;
    size: number;
  },
): Result<void> {
  const me = deps.machine();
  const at = deps.clock.now();
  return deps.transaction((tx) => {
    tx.sql.run(
      `INSERT INTO folder_held
         (machine, app, origin, n, kind, bundle_hash, data_schema, path, sha256, size, held_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (machine, app, origin, n) DO NOTHING`,
      [
        me,
        input.app,
        input.origin,
        input.n,
        input.kind,
        input.bundle_hash,
        input.data_schema,
        heldPath(input.app, input.origin, input.n, input.kind),
        input.sha256,
        input.size,
        at,
      ],
    );
    saveRead(tx.sql, me, input.app, input.origin, {
      cursor: input.n,
      bundle_hash: input.bundle_hash,
      read_at: at,
      attempts: 0,
      next_try_at: null,
      waiting_for: null,
      error: null,
    });
    return ok(undefined);
  });
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
