// I/O worker blob GC 파일 작업의 요구 테스트(platform/blob-store#R8, R9,
// R10, R11, R13). 관측은 지우지 않고, 실제 GC는 참조 차단·backup 진행 중
// 거절·유예기간 통과분만 지운다. temp dir의 실제 파일로 본다.

import { assert, assertEquals } from "@std/assert";
import { ok } from "../../../packages/base/mod.ts";
import {
  BLOB_UNAVAILABLE_REASONS,
  BLOB_UNREFERENCED_GRACE_MS,
} from "../../../packages/contracts/platform/mod.ts";
import {
  unavailableAnswer,
} from "../../../packages/platform/blob-store/mod.ts";
import {
  clearTemporary,
  collectGarbage,
  type GcDeps,
  observeBlobGc,
  trimCapacity,
} from "./gc.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const NOW = Date.parse("2026-10-01T00:00:00.000Z");
const AGED = NOW - BLOB_UNREFERENCED_GRACE_MS - 1000;

function blobPath(root: string, hash: string): string {
  return `${root}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`;
}

async function seedBlob(root: string, hash: string, observedAtMs: number) {
  const path = blobPath(root, hash);
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeFile(path, new Uint8Array([1, 2, 3, 4]));
  // Deno.utime는 초를 받는다(ms 아님).
  const seconds = Math.floor(observedAtMs / 1000);
  await Deno.utime(path, seconds, seconds);
}

async function blobExists(root: string, hash: string): Promise<boolean> {
  try {
    await Deno.stat(blobPath(root, hash));
    return true;
  } catch {
    return false;
  }
}

function depsOf(
  root: string,
  over: Partial<GcDeps> = {},
  overReferences?: readonly { hash: string }[],
): GcDeps {
  return {
    root,
    listInstalled: async () => {
      const entries: {
        hash: string;
        observedAtMs: number;
        sizeBytes: number;
        registeredAtMs: number;
      }[] = [];
      for await (const prefix of Deno.readDir(`${root}/blobs/sha256`)) {
        for await (
          const suffix of Deno.readDir(
            `${root}/blobs/sha256/${prefix.name}`,
          )
        ) {
          const path = `${root}/blobs/sha256/${prefix.name}/${suffix.name}`;
          const stat = await Deno.stat(path);
          const at = stat.mtime?.getTime() ?? 0;
          entries.push({
            hash: `${prefix.name}${suffix.name}`,
            observedAtMs: at,
            sizeBytes: stat.size,
            registeredAtMs: at,
          });
        }
      }
      return ok(entries);
    },
    listReferences: over.listReferences ??
      (async () => {
        await Promise.resolve();
        return ok(overReferences ?? []);
      }),
    listBackupPending: async () => {
      const entries: { name: string; pending: boolean }[] = [];
      try {
        for await (const entry of Deno.readDir(`${root}/backups`)) {
          if (!entry.isDirectory) continue;
          let pending = false;
          try {
            await Deno.stat(`${root}/backups/${entry.name}/backup.pending`);
            pending = true;
          } catch {
            pending = false;
          }
          entries.push({ name: entry.name, pending });
        }
      } catch {
        return ok([]);
      }
      return ok(entries);
    },
    removeBlob: async (hash) => {
      await Deno.remove(blobPath(root, hash));
      return ok(undefined);
    },
    listTmp: async () => {
      const entries: { name: string; observedAtMs: number }[] = [];
      try {
        for await (const entry of Deno.readDir(`${root}/blobs/tmp`)) {
          const stat = await Deno.stat(`${root}/blobs/tmp/${entry.name}`);
          entries.push({
            name: entry.name,
            observedAtMs: stat.mtime?.getTime() ?? 0,
          });
        }
      } catch {
        return ok([]);
      }
      return ok(entries);
    },
    removeTmp: async (name) => {
      await Deno.remove(`${root}/blobs/tmp/${name}`);
      return ok(undefined);
    },
    nowMs: () => nowMs ?? NOW,
    graceMs: over.graceMs,
    ...over,
  };
}

const nowMs = NOW;
// R10: 기동·매일 관측은 파일을 지우지 않고 수만 센다.
Deno.test("platform/blob-store#R10: 관측은 지우지 않고 수만 센다", async () => {
  const root = await Deno.makeTempDir({ prefix: "blob-gc-observe-" });
  try {
    await seedBlob(root, A, AGED);
    await seedBlob(root, B, AGED);
    const removed: string[] = [];
    const observation = await observeBlobGc(
      depsOf(root, {
        removeBlob: async (hash) => {
          await Promise.resolve();
          removed.push(hash);
          return ok(undefined);
        },
        graceMs: BLOB_UNREFERENCED_GRACE_MS,
      }),
    );
    assert(observation.ok);
    if (observation.ok) {
      assertEquals(observation.value.installed, 2);
      assertEquals(observation.value.unreferenced, 2);
      assertEquals(observation.value.deletable, 2);
      assertEquals(observation.value.backupPending, 0);
    }
    assertEquals(removed.length, 0);
    assert(await blobExists(root, A));
    assert(await blobExists(root, B));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/blob-store#R10: 관측은 유예기간 안의 수와 backup 중 표시를 센다", async () => {
  const root = await Deno.makeTempDir({ prefix: "blob-gc-observe-fresh-" });
  try {
    await seedBlob(root, A, NOW - 1000);
    await Deno.mkdir(`${root}/backups/20260101T000000000Z`, {
      recursive: true,
    });
    await Deno.writeTextFile(
      `${root}/backups/20260101T000000000Z/backup.pending`,
      "\n",
    );
    const observation = await observeBlobGc(depsOf(root));
    assert(observation.ok);
    if (observation.ok) {
      assertEquals(observation.value.deletable, 0);
      assertEquals(observation.value.backupPending, 1);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// R8 + R11: 실제 GC는 고정 참조와 대조해 참조된 blob을 blocked에 세고 지우지
// 않는다. 유예기간이 지난 미참조 blob만 지운다.
Deno.test("platform/blob-store#R8: GC는 참조된 blob을 blocked에 세고 남는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "blob-gc-refs-" });
  try {
    await seedBlob(root, A, AGED); // 참조됨
    await seedBlob(root, B, AGED); // 참조 없음
    const outcome = await collectGarbage(
      depsOf(root, {}, [{ hash: A }]),
    );
    assert(outcome.ok);
    if (outcome.ok) {
      assertEquals(outcome.value.blocked, [A]);
      assertEquals(outcome.value.deleted, [B]);
    }
    assert(await blobExists(root, A));
    assert(!(await blobExists(root, B)));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/blob-store#R8: 참조만으로는 준비 중 blob도 지우지 않는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "blob-gc-prepare-" });
  try {
    // 준비 중(prefraless, 아직 참조 없음) blob 파일은 유예기간 안에 있다.
    const fresh = NOW - 1000;
    await seedBlob(root, A, fresh);
    const outcome = await collectGarbage(depsOf(root));
    assert(outcome.ok);
    if (outcome.ok) {
      assertEquals(outcome.value.deleted, []);
      assertEquals(outcome.value.blocked, []);
    }
    assert(await blobExists(root, A));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// R11: backup.pending이 남아 있으면 GC를 거절한다(backup 중 GC 불가, T41).
Deno.test("platform/blob-store#R11: backup 중이면 GC를 거절하고 파일을 남는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "blob-gc-backup-" });
  try {
    await seedBlob(root, A, AGED);
    await Deno.mkdir(`${root}/backups/20260101T000000000Z`, {
      recursive: true,
    });
    await Deno.writeTextFile(
      `${root}/backups/20260101T000000000Z/backup.pending`,
      "\n",
    );
    const outcome = await collectGarbage(depsOf(root));
    assertEquals(outcome.ok, false);
    if (!outcome.ok) assertEquals(outcome.error.code, "conflict");
    assert(await blobExists(root, A));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/blob-store#R11: OS 삭제와 실패를 구별해 답한다", async () => {
  const root = await Deno.makeTempDir({ prefix: "blob-gc-fail-" });
  try {
    await seedBlob(root, A, AGED);
    await seedBlob(root, B, AGED);
    const outcome = await collectGarbage(
      depsOf(root, {
        removeBlob: async (hash) =>
          hash === A
            // OS 실패: 지우지 못한 hash는 failed에 산다.
            ? { ok: false, error: { code: "internal", message: "없어졌다" } }
            : (await Deno.remove(blobPath(root, hash)), ok(undefined)),
      }),
    );
    assert(outcome.ok);
    if (outcome.ok) {
      assertEquals(outcome.value.deleted, [B]);
      assertEquals(outcome.value.failed, [
        { hash: A, code: "internal" },
      ]);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/blob-store#R11: backup 사본은 GC 답에 삭제로 세지 않는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "blob-gc-copies-" });
  try {
    await seedBlob(root, A, AGED);
    const outcome = await collectGarbage(depsOf(root));
    assert(outcome.ok);
    if (outcome.ok) {
      // 올림 copy는 GC 결과가 아니다. backup 폴더의 사본은 잔존이다(R11).
      assertEquals(outcome.value.copiesRemain, false);
      assertEquals(outcome.value.deleted, [A]);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// R9: 진행 중 아님을 확인한(마지막 쓰기가 유예기간 밖인) tmp만 정리한다.
Deno.test("platform/blob-store#R9: 오래된 tmp만 정리하고 살아 있는 tmp는 남는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "blob-gc-tmp-" });
  try {
    await Deno.mkdir(`${root}/blobs/tmp`, { recursive: true });
    const live = `${root}/blobs/tmp/live`;
    const stale = `${root}/blobs/tmp/stale`;
    await Deno.writeTextFile(live, "live");
    // Deno.utime는 초를 받는다(ms 아님).
    const liveSec = Math.floor((NOW - 1000) / 1000);
    await Deno.utime(live, liveSec, liveSec);
    await Deno.writeTextFile(stale, "stale");
    const staleSec = Math.floor(AGED / 1000);
    await Deno.utime(stale, staleSec, staleSec);
    const cleared = await clearTemporary(depsOf(root));
    assert(cleared.ok);
    if (cleared.ok) assertEquals(cleared.value, ["stale"]);
    let liveLeft = false;
    try {
      await Deno.stat(live);
      liveLeft = true;
    } catch {
      liveLeft = false;
    }
    assert(liveLeft);
    let staleLeft = true;
    try {
      await Deno.stat(stale);
    } catch {
      staleLeft = false;
    }
    assert(!staleLeft);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// R13: 종류별 상한을 넘으면 오래된 capacity blob부터 정리한다. permanent는
// 남는다. 정리된 blob의 읽기 unavailable은 pruned 이유다.
Deno.test("platform/blob-store#R13: trim은 오래된 capacity blob만 지운다", async () => {
  const root = await Deno.makeTempDir({ prefix: "blob-gc-trim-" });
  try {
    // 크기를 상한을 넘게 만든다: trace_body 몫(256MiB)을 2개로 넘긴다.
    const big = 240 * 1024 * 1024;
    await seedBlob(root, A, AGED);
    await seedBlob(root, B, AGED);
    // 파일 크기는 관측 값이라 실제 240MiB를 쓰지 않고 크기만 겹쳐 넣는다.
    const outcome = await trimCapacity(
      depsOf(root, {
        listInstalled: async () => {
          await Promise.resolve();
          return ok([
            {
              hash: A,
              observedAtMs: AGED,
              sizeBytes: big,
              registeredAtMs: AGED,
            },
            {
              hash: B,
              observedAtMs: AGED,
              sizeBytes: big,
              registeredAtMs: AGED + 1000,
            },
          ]);
        },
      }),
      new Map([
        [A, { category: "trace_body", permanent: false }],
        [B, { category: "trace_body", permanent: false }],
      ]),
    );
    assert(outcome.ok);
    if (outcome.ok) {
      // 초과분(480MiB - 256MiB = 224MiB)에서 오래된 A 하나만 정리된다.
      assertEquals(outcome.value.deleted, [A]);
    }
    assert(!(await blobExists(root, A)));
    assert(await blobExists(root, B));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/blob-store#R13: trim은 permanent field의 blob을 남긴다", async () => {
  const root = await Deno.makeTempDir({ prefix: "blob-gc-trim-perm-" });
  try {
    const big = 240 * 1024 * 1024;
    await seedBlob(root, A, AGED);
    const outcome = await trimCapacity(
      depsOf(root, {
        listInstalled: async () => {
          await Promise.resolve();
          return ok([{
            hash: A,
            observedAtMs: AGED,
            sizeBytes: big,
            registeredAtMs: AGED,
          }]);
        },
      }),
      new Map([[A, { category: "trace_body", permanent: true }]]),
    );
    assert(outcome.ok);
    if (outcome.ok) assertEquals(outcome.value.deleted, []);
    assert(await blobExists(root, A));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/blob-store#R13: trim은 backup 중에 거절한다", async () => {
  const root = await Deno.makeTempDir({ prefix: "blob-gc-trim-backup-" });
  try {
    await seedBlob(root, A, AGED);
    await Deno.mkdir(`${root}/backups/20260101T000000000Z`, {
      recursive: true,
    });
    await Deno.writeTextFile(
      `${root}/backups/20260101T000000000Z/backup.pending`,
      "\n",
    );
    const outcome = await trimCapacity(
      depsOf(root),
      new Map([[A, { category: "trace_body", permanent: false }]]),
    );
    assertEquals(outcome.ok, false);
    if (!outcome.ok) assertEquals(outcome.error.code, "conflict");
    assert(await blobExists(root, A));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/blob-store#R13: 정리된 blob의 읽기 unavailable은 pruned 이유다", () => {
  // trim 결과의 hash는 이후 읽기에서 BLOB_UNAVAILABLE_REASONS의 pruned로 답한다.
  assert(BLOB_UNAVAILABLE_REASONS.includes("pruned"));
  const answer = unavailableAnswer({ hash: A, size_bytes: 4 }, "pruned");
  assertEquals(answer.result.status, "unavailable");
  if (answer.result.status === "unavailable") {
    assertEquals(answer.result.reason, "pruned");
    // 바이트 없음(R13: 정리한 blob을 안다고 반환하지 않는다).
    assertEquals(answer.bytes, undefined);
  }
});
