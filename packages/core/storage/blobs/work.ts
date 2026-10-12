// blob 준비·설치의 파일 작업.
// 순서: 여유 확인 → 임시 streaming write + sha256 → 크기·예상 hash 검증 → fsync →
// chmod 0400 → 원자적 link 설치 → directory sync. 실패한 임시 파일은 버린다.

import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { PreparedBlob } from "../../../protocol/storage/mod.ts";
import {
  BLOB_READ_ONLY_MODE,
  BLOB_STORE_OBJECTS_DIR,
  objectPathFor,
  preparedOf,
  tmpDirFor,
  tmpPathFor,
} from "./model.ts";

// 안전 여유. 실측 크기를 모르므로 준비 최대치보다 여유가 있어야 받는다.
export const DISK_MARGIN_BYTES = 256 * 1024 * 1024;

export type PreparedInstall = {
  prepared: PreparedBlob;
  // 기존 blob을 재사용했으면 파일을 새로 쓰지 않았다.
  reused: boolean;
};

export type PreparedInput = {
  preparation: string;
  principal: string;
  purpose: string;
  expectedHash?: string;
};

export type BlobStoreWork = {
  // 준비 경계가 purpose 기록을 남길 root. 내부 경로 계산의 근원이다.
  readonly root: string;
  prepare(
    input: PreparedInput,
    bytes: ReadableStream<Uint8Array>,
  ): Promise<Result<PreparedInstall>>;
  // 준비 참조가 가리키는 완성 blob의 관측값.
  installed(hash: string): Promise<Result<{ hash: string; sizeBytes: number }>>;
  // 설치된 blob의 그 구간. 없으면 not_found다. hash는 경로로만 쓴다.
  read(
    hash: string,
    offset: number,
    length: number,
  ): Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;
};

export type BlobStoreDeps = {
  root: string;
  // 준비 파일 접미사. 내용에서 파생하지 않는다.
  suffix: () => string;
  // 실제 여유. 부족하면 새 준비를 unavailable로 막는다.
  quota: { availableBytes(path: string): Promise<number | undefined> };
};

export function createBlobStoreWork(deps: BlobStoreDeps): BlobStoreWork {
  async function ensureDir(path: string): Promise<boolean> {
    try {
      await Deno.mkdir(path, { recursive: true, mode: 0o700 });
      return true;
    } catch {
      return false;
    }
  }

  async function discard(file: Deno.FsFile, path: string): Promise<void> {
    try {
      file.close();
    } catch { /* 이미 닫힌 파일 */ }
    try {
      await Deno.remove(path);
    } catch { /* 이미 사라진 파일 */ }
  }

  // 같은 파일 시스템의 hard link가 원자적 설치다. 기존 파일을 덮어쓰지 않는다.
  async function linkInstall(
    temporary: string,
    target: string,
  ): Promise<Result<"installed" | "exists">> {
    try {
      await Deno.link(temporary, target);
      return ok("installed");
    } catch (thrown) {
      if (thrown instanceof Deno.errors.AlreadyExists) return ok("exists");
      return err({ code: "unavailable", message: "blob 설치에 실패했다" });
    }
  }

  // 임시 directory와 대상 directory를 sync한다. 지원 OS에서만 의미가 있다.
  async function syncDirs(dirs: readonly string[]): Promise<void> {
    for (const dir of dirs) {
      let handle: Deno.FsFile | undefined;
      try {
        handle = await Deno.open(dir, { read: true });
        await handle.sync();
      } catch {
        // directory sync를 지원하지 않는 OS는 파일 sync만으로 둔다.
      } finally {
        try {
          handle?.close();
        } catch { /* 이미 닫힌 directory */ }
      }
    }
  }

  return {
    root: deps.root,
    async prepare(input, bytes) {
      const tmpDir = tmpDirFor(deps.root);
      if (!await ensureDir(tmpDir)) {
        return err({
          code: "unavailable",
          message: "임시 directory를 열 수 없다",
        });
      }
      // 여유를 알 수 없거나 부족하면 새 준비를 막는다. 참조 blob은 건드리지 않는다.
      const available = await deps.quota.availableBytes(tmpDir);
      if (available === undefined) {
        return err({
          code: "unavailable",
          message: "디스크 여유를 관측할 수 없다",
        });
      }
      if (available < DISK_MARGIN_BYTES) {
        return err({ code: "unavailable", message: "디스크 여유가 부족하다" });
      }
      const temporary = tmpPathFor(tmpDir, deps.suffix());
      const opened = await openTemporary(temporary);
      if (!opened.ok) return opened;
      const handle = opened.value;
      const hash = createHash("sha256");
      let total = 0;
      try {
        // streaming write이며 그 바이트로 sha256과 크기를 함께 계산한다.
        for await (const chunk of bytes) {
          if (total + chunk.length > Number.MAX_SAFE_INTEGER) {
            return fail(handle, temporary, {
              code: "invalid_input",
              message: "blob 크기가 최대 한도를 넘는다",
            });
          }
          await handle.write(chunk);
          hash.update(chunk);
          total += chunk.length;
        }
      } catch {
        await discard(handle, temporary);
        return err({ code: "unavailable", message: "임시 write에 실패했다" });
      }
      // 크기·예상 hash 불일치는 invalid_input이다.
      if (total === 0) {
        await discard(handle, temporary);
        return err({ code: "invalid_input", message: "blob 내용이 없다" });
      }
      const digest = hash.digest("hex");
      if (input.expectedHash !== undefined && input.expectedHash !== digest) {
        await discard(handle, temporary);
        return err({
          code: "invalid_input",
          message: "예상 hash와 준비한 내용이 다르다",
        });
      }
      const syncResult = await installSync(handle, temporary);
      if (!syncResult.ok) {
        await discard(handle, temporary);
        return syncResult;
      }
      const target = objectPathFor(deps.root, digest);
      const objectsDir = target.slice(
        0,
        target.length - digest.slice(2).length - 1,
      );
      if (!await ensureDir(objectsDir)) {
        await discard(handle, temporary);
        return err({
          code: "unavailable",
          message: "blob directory를 열 수 없다",
        });
      }
      const linked = await linkInstall(temporary, target);
      if (!linked.ok) {
        await discard(handle, temporary);
        return linked;
      }
      if (linked.value === "exists") {
        // 같은 hash는 기존 파일을 검증해 재사용하고 새 파일은 버린다.
        await discard(handle, temporary);
        const existed = await observeBlob(deps.root, digest);
        if (!existed.ok) return existed;
        const prepared = preparedOf(input, existed.value);
        if (!prepared.ok) return prepared;
        await syncDirs([tmpDir, objectsDir]);
        return ok({ prepared: prepared.value, reused: true });
      }
      // link 설치 뒤 임시 이름만 떨어뜨린다. 설치 파일은 남는다.
      try {
        handle.close();
      } catch { /* 이미 닫힌 파일 */ }
      try {
        await Deno.remove(temporary);
      } catch { /* 이미 사라진 파일 */ }
      await syncDirs([tmpDir, objectsDir]);
      const observed = await observeBlob(deps.root, digest);
      if (!observed.ok) return observed;
      const prepared = preparedOf(input, observed.value);
      if (!prepared.ok) return prepared;
      return ok({ prepared: prepared.value, reused: false });
    },
    installed(hash) {
      return observeBlob(deps.root, hash);
    },
    read(hash, offset, length) {
      return readBlobRange(deps.root, hash, offset, length);
    },
  };

  function fail(
    handle: Deno.FsFile,
    temporary: string,
    error: { code: "invalid_input"; message: string },
  ): Result<never> {
    void discard(handle, temporary);
    return err(error);
  }
}

function openTemporary(path: string): Promise<Result<Deno.FsFile>> {
  return (async () => {
    try {
      return ok(
        await Deno.open(path, {
          createNew: true,
          write: true,
          read: true,
          mode: 0o600,
        }),
      );
    } catch {
      return err({ code: "unavailable", message: "임시 파일을 열 수 없다" });
    }
  })();
}

async function installSync(
  file: Deno.FsFile,
  path: string,
): Promise<Result<void>> {
  try {
    await file.sync();
    // 완성 blob은 0400이다. 권한은 파일 sync 전에 고정한다.
    await Deno.chmod(path, BLOB_READ_ONLY_MODE);
    return ok(undefined);
  } catch {
    return err({ code: "unavailable", message: "blob sync에 실패했다" });
  }
}

async function readBlobRange(
  root: string,
  hash: string,
  offset: number,
  length: number,
): Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>> {
  const path = `${root}/${BLOB_STORE_OBJECTS_DIR}/${hash.slice(0, 2)}/${
    hash.slice(2)
  }`;
  try {
    const file = await Deno.open(path, { read: true });
    try {
      const stat = await file.stat();
      const bytes = new Uint8Array(length);
      await file.seek(offset, Deno.SeekMode.Start);
      const read = await file.read(bytes);
      return ok({
        hash,
        sizeBytes: stat.size,
        bytes: bytes.subarray(0, read ?? 0),
      });
    } finally {
      file.close();
    }
  } catch (thrown) {
    if (thrown instanceof Deno.errors.NotFound) {
      return err({ code: "not_found", message: "blob이 없다" });
    }
    return err({ code: "unavailable", message: "blob을 읽지 못했다" });
  }
}

async function observeBlob(
  root: string,
  hash: string,
): Promise<Result<{ hash: string; sizeBytes: number }>> {
  try {
    const stat = await Deno.stat(
      `${root}/${BLOB_STORE_OBJECTS_DIR}/${hash.slice(0, 2)}/${hash.slice(2)}`,
    );
    if (!stat.isFile) return err({ code: "not_found", message: "blob이 없다" });
    return ok({ hash, sizeBytes: stat.size });
  } catch (thrown) {
    if (thrown instanceof Deno.errors.NotFound) {
      return err({ code: "not_found", message: "blob이 없다" });
    }
    return err({ code: "unavailable", message: "blob 관측에 실패했다" });
  }
}
