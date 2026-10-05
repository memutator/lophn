// 정지 유지보수 조립의 요구 테스트(platform/blob-store#R8, R9, R11, T44).
// 세 정지 조건이 모두 관측될 때만 회수하고, 유예기간 지난 미참조분만 지우며,
// backup.pending 표시가 남아 있으면 건너뛴다. temp dir의 실제 파일로 본다.

import { assertEquals } from "@std/assert";
import { ok } from "../../../packages/base/mod.ts";
import { BLOB_UNREFERENCED_GRACE_MS } from "../../../packages/contracts/platform/mod.ts";
import {
  assignmentOf,
  purposesPathFor,
} from "../../../packages/platform/blob-store/mod.ts";
import { fullyStopped, runMaintenanceGc } from "./maintenance.ts";

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
    // 준비 경계가 남긴 목적 기록(T44). 유예기간 안의 미참조 blob도 종류를
    // 알아야 하므로 operational_log 목적으로 남겨 둔다(규칙 밖 목적은
    // permanent로 뺀다: 지우지 않는다).
    const purposePath = purposesPathFor(root, AGED_HASH);
    await Deno.mkdir(purposePath.slice(0, purposePath.lastIndexOf("/")), {
      recursive: true,
    });
    await Deno.writeTextFile(
      purposePath,
      `${JSON.stringify({ purpose: "operational_log" })}\n`,
    );
    const freshPath = purposesPathFor(root, FRESH_HASH);
    await Deno.mkdir(freshPath.slice(0, freshPath.lastIndexOf("/")), {
      recursive: true,
    });
    await Deno.writeTextFile(
      freshPath,
      `${JSON.stringify({ purpose: "operational_log" })}\n`,
    );
    const referencedPath = purposesPathFor(root, REFERENCED_HASH);
    await Deno.mkdir(
      referencedPath.slice(0, referencedPath.lastIndexOf("/")),
      { recursive: true },
    );
    await Deno.writeTextFile(
      referencedPath,
      `${JSON.stringify({ purpose: "report_text" })}\n`,
    );
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
  // three conditions: reference rows win over purpose records (R4 field rule).
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
