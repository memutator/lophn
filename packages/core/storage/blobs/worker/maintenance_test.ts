// 정지 유지보수 조립의 요구 테스트(platform/blob-store#R8, R9, R11, T44).
// 세 정지 조건이 모두 관측될 때만 회수하고, 유예기간 지난 미참조분만 지우며,
// backup.pending 표시가 남아 있으면 건너뛴다. temp dir의 실제 파일로 본다.

import { assertEquals } from "@std/assert";
import { ok } from "../../../../base/mod.ts";
import { BLOB_UNREFERENCED_GRACE_MS } from "../../../../protocol/server/mod.ts";
import { assignmentOf, purposesPathFor } from "../mod.ts";
import {
  listBackupPending,
  listInstalledBlobs,
} from "../../../main/worker/io.ts";
import {
  fullyStopped,
  readUnreferencedRecords,
  recordUnreferenced,
  runMaintenanceGc,
} from "./maintenance.ts";
import { observeBlobGc } from "./gc.ts";

const AGED_HASH = "a".repeat(64);
const FRESH_HASH = "b".repeat(64);
const REFERENCED_HASH = "c".repeat(64);
const NOW = Date.parse("2026-10-01T00:00:00.000Z");
const AGED = NOW - BLOB_UNREFERENCED_GRACE_MS - 1000;
const FRESH = NOW - 1000;

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

function recordPath(root: string, hash: string): string {
  return `${root}/blobs/unreferenced/${hash.slice(0, 2)}/${hash.slice(2)}.json`;
}

async function recordExists(root: string, hash: string): Promise<boolean> {
  try {
    await Deno.stat(recordPath(root, hash));
    return true;
  } catch {
    return false;
  }
}

async function seedPurpose(root: string, hash: string, purpose: string) {
  const path = purposesPathFor(root, hash);
  if (!path.ok) throw new Error("seedPurpose: bad hash");
  await Deno.mkdir(path.value.slice(0, path.value.lastIndexOf("/")), {
    recursive: true,
  });
  await Deno.writeTextFile(
    path.value,
    `${JSON.stringify({ purpose })}\n`,
  );
}

// 정지 유지보수 준비. 참조는 ledger 행 관측으로, 목적 기록은 준비 경계가
// 남긴 실제 파일로 넣는다(T44).
function depsOf(
  root: string,
  rows: readonly { hash: string; owner_kind: string; field: string }[],
  over: Partial<Parameters<typeof runMaintenanceGc>[0]> = {},
): Parameters<typeof runMaintenanceGc>[0] {
  return {
    root,
    conditions: () =>
      Promise.resolve({
        preparationsBlocked: true,
        commandsBlocked: true,
        writerStopped: true,
      }),
    fields: () => // 참조 field의 보존 규칙. report_text는 영구 참조다(R13: 지우지 않는다).
    [
      {
        owner_kind: "report",
        field: "report_text",
        retention: { kind: "permanent" },
      } as const,
    ],
    listReferenceRows: () => Promise.resolve(ok(rows)),
    nowMs: () => NOW,
    ...over,
  };
}

Deno.test("platform/blob-store#R8 정지 유지보수는 유예기간 지난 미참조 blob만 하나도 남김 없이 회수한다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-maint-" });
  try {
    await seedBlob(root, AGED_HASH, AGED);
    // 유예기간 안의 미참조 blob은 남는다.
    await seedBlob(root, FRESH_HASH, FRESH);
    // 참조된 blob은 참조 시각과 무관하게 남는다(R8).
    await seedBlob(root, REFERENCED_HASH, AGED);
    // 준비 경계가 남긴 목적 기록(T44). trim 대상 판정의 근거다.
    await seedPurpose(root, AGED_HASH, "operational_log");
    await seedPurpose(root, FRESH_HASH, "operational_log");
    await seedPurpose(root, REFERENCED_HASH, "report_text");
    // 미참조 확인 기록(R9). 유예기간은 이 기록의 시각부터 센다: 오래된
    // mtime과 무관하게, 기록의 처음 확인 시각이 유예기간을 지나야 지운다.
    await recordUnreferenced(root, AGED_HASH, AGED);
    const outcome = await runMaintenanceGc(
      depsOf(root, [
        { hash: REFERENCED_HASH, owner_kind: "report", field: "report_text" },
      ]),
    );
    if (!outcome.ok) {
      throw new Error(
        `유지보수가 실패했다: ${outcome.error.code} ${outcome.error.message}`,
      );
    }
    assertEquals(outcome.value.deleted, [AGED_HASH]);
    assertEquals(outcome.value.blocked, [REFERENCED_HASH]);
    assertEquals(outcome.value.copiesRemain, false);
    // 유예기간 안의 미참조 blob과 참조된 blob은 파일로 남는다.
    assertEquals(await blobExists(root, FRESH_HASH), true);
    assertEquals(await blobExists(root, REFERENCED_HASH), true);
    assertEquals(await blobExists(root, AGED_HASH), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/blob-store#R8 정지 조건이 하나라도 빠지면 유지보수는 파일을 하나도 지우지 않는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-maint-" });
  try {
    await seedBlob(root, AGED_HASH, AGED);
    const stopped: readonly [boolean, boolean, boolean][] = [
      [false, true, true],
      [true, false, true],
      [true, true, false],
    ];
    for (
      const [preparationsBlocked, commandsBlocked, writerStopped] of stopped
    ) {
      const outcome = await runMaintenanceGc(
        depsOf(root, [], {
          conditions: () =>
            Promise.resolve({
              preparationsBlocked,
              commandsBlocked,
              writerStopped,
            }),
        }),
      );
      assertEquals(outcome.ok, false);
      if (!outcome.ok) assertEquals(outcome.error.code, "conflict");
      // 파일은 그대로 남는다.
      assertEquals(await blobExists(root, AGED_HASH), true);
    }
    assertEquals(
      fullyStopped({
        preparationsBlocked: true,
        commandsBlocked: true,
        writerStopped: true,
      }),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/blob-store#R11 backup.pending 표시가 남아 있으면 정지 유지보수는 회수를 건너뛴다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-maint-" });
  try {
    await seedBlob(root, AGED_HASH, AGED);
    // backup.pending 표시가 남은 폴더(T41).
    await Deno.mkdir(`${root}/backups/20260930`, { recursive: true });
    await Deno.writeTextFile(`${root}/backups/20260930/backup.pending`, "");
    const outcome = await runMaintenanceGc(
      depsOf(root, [
        { hash: FRESH_HASH, owner_kind: "report", field: "report_text" },
      ]),
    );
    assertEquals(outcome.ok, false);
    if (!outcome.ok) {
      assertEquals(outcome.error.code, "conflict");
      assertEquals(outcome.error.message.includes("backup"), true);
    }
    // 유예기간이 지난 미참조 blob도 건드리지 않는다.
    assertEquals(await blobExists(root, AGED_HASH), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/blob-store#R8 참조 행과 목적 기록이 trimCapacity의 종류 할당을 정한다", () => {
  // 참조 행이 목적 기록보다 우선한다(R4 field rule).
  const rules = [
    {
      owner_kind: "model_call",
      field: "input",
      retention: {
        kind: "capacity" as const,
        category: "model_call_body" as const,
      },
    },
  ];
  const rows = [
    { hash: AGED_HASH, owner_kind: "model_call", field: "input" },
  ];
  const purposes = new Map([[FRESH_HASH, "operational_log"]]);
  const assignment = assignmentOf(rules, rows, purposes);
  assertEquals(assignment.get(AGED_HASH), {
    category: "model_call_body",
    permanent: false,
  });
  assertEquals(assignment.get(FRESH_HASH)?.permanent, true);
});

// R9: 유예기간은 파일 mtime이 아니라 미참조 확인 기록부터 센다. 오래된
// mtime의 blob이 방금 미참조가 됐으면(기록이 없으면) 지우지 않는다 — 기록의
// 처음 확인 시각이 유예기간을 지났을 때만 지운다.
Deno.test("platform/blob-store#R9 오래된 mtime의 방금 미참조 blob은 기록이 없어 지우지 않는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-maint-rec-" });
  try {
    // mtime은 오래됐지만(오랜 준비 뒤 참조 상실) 미참조 확인 기록은 없다.
    await seedBlob(root, AGED_HASH, AGED);
    await seedPurpose(root, AGED_HASH, "operational_log");
    const outcome = await runMaintenanceGc(depsOf(root, []));
    if (!outcome.ok) {
      throw new Error(
        `유지보수가 실패했다: ${outcome.error.code} ${outcome.error.message}`,
      );
    }
    // 기록 없는 hash는 지금 처음 미참조를 본 것이라 이번에 지우지 않는다.
    assertEquals(outcome.value.deleted, []);
    assertEquals(await blobExists(root, AGED_HASH), true);
    // 관측이 처음 확인 시각을 남겼다(R9). 유예기간의 근원이다.
    assertEquals(await recordExists(root, AGED_HASH), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// R9: 기록의 처음 확인 시각에서 7일이 지났을 때만 지운다. mtime과 무관하다.
Deno.test("platform/blob-store#R9 기록의 처음 확인 시각에서 유예기간이 지났을 때만 지운다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-maint-aged-" });
  try {
    // mtime은 유예기간 안(방금 설치)이지만 기록은 오래됐다: 기록이 근원이다.
    await seedBlob(root, AGED_HASH, FRESH);
    await seedPurpose(root, AGED_HASH, "operational_log");
    await recordUnreferenced(root, AGED_HASH, AGED);
    const outcome = await runMaintenanceGc(depsOf(root, []));
    if (!outcome.ok) {
      throw new Error(
        `유지보수가 실패했다: ${outcome.error.code} ${outcome.error.message}`,
      );
    }
    assertEquals(outcome.value.deleted, [AGED_HASH]);
    assertEquals(await blobExists(root, AGED_HASH), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// R9: 다시 참조된 hash의 기록은 지운다(유예기간이 새로 섞인다).
Deno.test("platform/blob-store#R9 다시 참조된 blob의 미참조 기록은 지운다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-maint-reset-" });
  try {
    await seedBlob(root, REFERENCED_HASH, AGED);
    await seedPurpose(root, REFERENCED_HASH, "report_text");
    await recordUnreferenced(root, REFERENCED_HASH, AGED);
    const outcome = await runMaintenanceGc(
      depsOf(root, [
        { hash: REFERENCED_HASH, owner_kind: "report", field: "report_text" },
      ]),
    );
    if (!outcome.ok) {
      throw new Error(
        `유지보수가 실패했다: ${outcome.error.code} ${outcome.error.message}`,
      );
    }
    // 참조된 blob은 남는다(R8). 기록도 지워진다: 다음 미참조 확인부터
    // 유예기간이 새로 섞인다(R9).
    assertEquals(await blobExists(root, REFERENCED_HASH), true);
    assertEquals(await recordExists(root, REFERENCED_HASH), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// R9: 참조를 모르는 매일 관측은 기록을 하나도 만들거나 지우지 않는다
// (unknown ≠ unreferenced). 참조된 blob은 기록을 얻지 않는다: 정지 유지보수가
// 남긴 기록이 유예기간의 근원이고, 실제 미참조가 된 뒤 7일이 지났을 때만
// 지운다.
Deno.test("platform/blob-store#R9 참조를 모르는 관측은 기록을 만들지 않는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-maint-noref-" });
  try {
    // 참조된 blob과 미참조 blob 하나씩.
    await seedBlob(root, REFERENCED_HASH, AGED);
    await seedBlob(root, AGED_HASH, AGED);
    await seedPurpose(root, REFERENCED_HASH, "report_text");
    await seedPurpose(root, AGED_HASH, "operational_log");
    // 참조를 모르는 매일 관측(observeBlobGc with no listReferences).
    const observation = await observeBlobGc({
      root,
      listInstalled: () => listInstalledBlobs(root),
      listUnreferenced: () => readUnreferencedRecords(root),
      listBackupPending: () => listBackupPending(root),
      removeBlob: () => Promise.resolve(ok(undefined)),
      listTmp: () => Promise.resolve(ok([])),
      removeTmp: () => Promise.resolve(ok(undefined)),
      nowMs: () => NOW,
    });
    if (!observation.ok) {
      throw new Error(
        `관측이 실패했다: ${observation.error.code} ${observation.error.message}`,
      );
    }
    // 참조를 모르는 관측은 수만 센다(R10). 삭제 자격 수는 모른다.
    assertEquals(observation.value.installed, 2);
    assertEquals(observation.value.deletable, 0);
    // 참조된 blob도 미참조 blob도 기록이 없다: 관측이 만들지 않았다.
    assertEquals(await recordExists(root, REFERENCED_HASH), false);
    assertEquals(await recordExists(root, AGED_HASH), false);
    // 관측 뒤 정지 유지보수가 실제 참조 행으로 기록을 남긴다(R9): 미참조인
    // AGED_HASH만 남기고, 참조된 REFERENCED_HASH는 얻지 않는다.
    const outcome = await runMaintenanceGc(
      depsOf(root, [
        { hash: REFERENCED_HASH, owner_kind: "report", field: "report_text" },
      ]),
    );
    if (!outcome.ok) {
      throw new Error(
        `유지보수가 실패했다: ${outcome.error.code} ${outcome.error.message}`,
      );
    }
    // 기록 없는 hash는 지금 처음 미참조를 본 것이라 이번에 지우지 않는다.
    assertEquals(outcome.value.deleted, []);
    assertEquals(await blobExists(root, AGED_HASH), true);
    // 미참조인 hash만 기록을 얻는다: 참조된 blob은 얻지 않는다.
    assertEquals(await recordExists(root, AGED_HASH), true);
    assertEquals(await recordExists(root, REFERENCED_HASH), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
