// core 종료가 세 정지 조건을 실제 관측으로 채워 정지 유지보수를 부르는지
// 확인한다(platform/blob-store#R8, R9, R10, R11, T44). 실제 core와 temp
// LOPHN_HOME에서 본다. 유예기간이 지난 미참조 blob만 회수되고, 참조된 blob과
// 유예기간 안 blob은 남는다. backup.pending이 있으면 아무것도 지우지 않고,
// blob_refs 관측이 막히면 유지보수를 건너뛴다.

import { assert, assertEquals, assertRejects } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import { BLOB_UNREFERENCED_GRACE_MS } from "../../packages/protocol/server/mod.ts";
import { startCore } from "./core.ts";
import { createCoreRegistration } from "./testing/blob-registration.ts";
import { acquireInstanceLock } from "../../packages/core/install-and-update/mod.ts";

const BODY = new TextEncoder().encode("blob body");
const NOW = Date.UTC(2024, 0, 1);
const AGED = NOW - BLOB_UNREFERENCED_GRACE_MS - 60_000;

Deno.test("platform/blob-store#R8 #R9 #R10: 종료는 유예기간이 지난 미참조 blob만 회수하고 참조·최근 blob은 남긴다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-shutdown-gc-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createCoreRegistration }],
    teamModules: [
      new URL("./testing/blob-registration.ts", import.meta.url).href,
    ],
    clock: manualClock(NOW),
    random: seededRandom(1),
    testCredentials: true,
  });
  assert(started.ok);
  const core = started.value;
  const prepared: { hash: string }[] = [];
  try {
    const token = "a".repeat(43);
    const context = {
      principal: "user-1",
      actor: "user" as const,
      credential_ref: "cred_shutdowngc1",
      scope: {
        operations: ["blobref.attach", "blobs/read"],
        targets: {},
      },
      conditions: {},
    };
    assert(core.acceptTestCredential);
    assert((await core.acceptTestCredential(context, token)).ok);
    assert((await core.record(context)).ok);

    // 참조로 등록할 blob. 유예기간과 무관하게 남는다(R8).
    const referenced = await prepare(core, "document_file");
    assert(referenced.ok);
    prepared.push(referenced.value);
    const attached = await post(core.port, "/v1/blobref/attach", {
      input: { owner_key: "ver:1", prepared: referenced.value },
      idempotency_key: "attach-1",
      compare: {},
      prepared: [],
    }, token);
    assertEquals(attached.status, 200, JSON.stringify(attached.body));

    // 유예기간이 지난 미참조 blob. 목적 기록은 준비가 남겼고, 미참조 확인
    // 기록만 유예기간보다 앞으로 당긴다(R9).
    const orphan = await prepare(core, "operational_log");
    assert(orphan.ok);
    prepared.push(orphan.value);
    await ageUnreferenced(core.dataRoot, orphan.value.hash);

    // 유예기간 안의 미참조 blob. 확인 기록이 없으므로 이번에 지우지 않는다(R9).
    const recent = await prepare(
      core,
      "operational_log",
      new TextEncoder().encode("recent blob"),
    );
    assert(recent.ok);
    prepared.push(recent.value);
  } finally {
    await core.shutdown();
  }
  try {
    const kept = await hashesOf(home);
    assertEquals(
      kept.sort(),
      [prepared[0].hash, prepared[2].hash].sort(),
      kept.join(","),
    );
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("platform/blob-store#R11: backup.pending이 있으면 종료 유지보수는 아무것도 지우지 않는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-shutdown-pending-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createCoreRegistration }],
    teamModules: [
      new URL("./testing/blob-registration.ts", import.meta.url).href,
    ],
    clock: manualClock(NOW),
    random: seededRandom(2),
    testCredentials: true,
  });
  assert(started.ok);
  const core = started.value;
  let orphanHash = "";
  try {
    const prepared = await prepare(core, "operational_log");
    assert(prepared.ok);
    orphanHash = prepared.value.hash;
    await ageUnreferenced(core.dataRoot, orphanHash);
    await Deno.mkdir(`${core.dataRoot}/backups/2024-01-01`, {
      recursive: true,
    });
    await Deno.writeTextFile(
      `${core.dataRoot}/backups/2024-01-01/backup.pending`,
      "",
    );
  } finally {
    await core.shutdown();
  }
  try {
    assert(await blobExists(home, orphanHash));
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("platform/blob-store#R8: blob_refs 관측이 막히면 종료 유지보수를 건너뛰고 종료는 끝난다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-shutdown-blocked-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createCoreRegistration }],
    teamModules: [
      new URL("./testing/blob-registration.ts", import.meta.url).href,
    ],
    clock: manualClock(NOW),
    random: seededRandom(3),
    testCredentials: true,
  });
  assert(started.ok);
  const core = started.value;
  let orphanHash = "";
  try {
    const prepared = await prepare(core, "operational_log");
    assert(prepared.ok);
    orphanHash = prepared.value.hash;
    await ageUnreferenced(core.dataRoot, orphanHash);
  } finally {
    // writer를 닫은 뒤의 read-only 열기를 막는다. 같은 경로를 디렉터리로
    // 바꾸면 reader 연결이 거절되고, 관측 실패는 fail-closed다. 종료 자체는
    // 그대로 끝난다.
    const ledger = `${core.dataRoot}/lophn.db`;
    const saved = await Deno.readFile(ledger);
    await Deno.remove(ledger);
    await Deno.mkdir(ledger);
    try {
      await core.shutdown();
    } finally {
      await Deno.remove(ledger);
      await Deno.writeFile(ledger, saved);
    }
  }
  try {
    // 관측을 못 했으므로 유예기간이 지난 미참조 blob도 남는다.
    assert(await blobExists(home, orphanHash));
    const log = await Deno.readTextFile(`${home}/logs/maintenance.jsonl`);
    assert(log.includes("maintenance_gc"));
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("platform/blob-store#R8: 500행이 넘는 blob_refs도 뒤 페이지의 참조가 blob을 지킨다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-shutdown-pages-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createCoreRegistration }],
    teamModules: [
      new URL("./testing/blob-registration.ts", import.meta.url).href,
    ],
    clock: manualClock(NOW),
    random: seededRandom(4),
    testCredentials: true,
  });
  assert(started.ok);
  const core = started.value;
  const ROWS = 1_200;
  // 뒤 페이지(501행 이후)에만 참조가 있는 blob. 페이지를 놓치면 지워진다.
  const late = await prepare(
    core,
    "document_file",
    new TextEncoder().encode("late page"),
  );
  assert(late.ok);
  // 어느 페이지에도 참조가 없는 유예기간 지난 blob. 페이지와 무관하게 지워진다.
  const orphan = await prepare(
    core,
    "operational_log",
    new TextEncoder().encode("paged orphan"),
  );
  assert(orphan.ok);
  await ageUnreferenced(core.dataRoot, orphan.value.hash);
  seedRefs(core.dataRoot, ROWS, late.value.hash);
  await core.shutdown();
  try {
    assert(
      await blobExists(home, late.value.hash),
      "뒤 페이지 참조 blob이 지워졌다",
    );
    assert(!await blobExists(home, orphan.value.hash), "미참조 blob이 남았다");
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

// blob_refs를 한 페이지(500행)보다 많이 심는다. 마지막 행만 lateHash를 참조하고
// 나머지는 파일이 없는 hash라, 뒤 페이지를 읽어야 lateHash가 보호된다.
function seedRefs(dataRoot: string, rows: number, lateHash: string): void {
  const db = new DatabaseSync(`${dataRoot}/lophn.db`);
  try {
    const event = db.prepare(
      `insert into events (type, subject, actor, payload, at)
       values ('BlobAttached', 'ver_1', 'user', '{}', '2026-01-01T00:00:00.000Z')`,
    );
    const seqOf = db.prepare(`select last_insert_rowid() as seq`);
    const ref = db.prepare(
      `insert into blob_refs (owner_kind, owner_key, field, hash, size_bytes, registered_seq)
       values ('document_version', ?, 'file', ?, 1, ?)`,
    );
    db.exec("begin");
    for (let i = 0; i < rows; i++) {
      event.run();
      const seq = (seqOf.get() as { seq: number }).seq;
      const hash = i === rows - 1 ? lateHash : syntheticHash(i);
      ref.run(`owner-${String(i).padStart(5, "0")}`, hash, seq);
    }
    db.exec("commit");
  } finally {
    db.close();
  }
}

function syntheticHash(index: number): string {
  return index.toString(16).padStart(64, "0");
}

Deno.test("platform/blob-store#R8: 유지보수가 시간 제한을 넘기면 그 프로세스만 끝내고 lock을 푼다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-shutdown-timeout-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createCoreRegistration }],
    clock: manualClock(NOW),
    random: seededRandom(5),
    superviseIo: false,
    maintenanceTimeoutMs: 200,
    // 시간 제한보다 길게 멈춰 있는 유지보수. 종료는 이걸 기다리지 않는다.
    maintenance: () => new Promise(() => {}),
  });
  assert(started.ok);
  const core = started.value;
  const began = Date.now();
  await core.shutdown();
  // 시간 제한 직후에 돌아와야 한다. 무한 대기가 아니어야 한다.
  assert(Date.now() - began < 5_000);
  try {
    const log = await Deno.readTextFile(`${home}/logs/maintenance.jsonl`);
    assert(log.includes("maintenance_gc timeout"));
    await assertLockFree(`${home}/run`);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("platform/blob-store#R8: 종료의 앞 단계가 예외를 던져도 lock을 풀고 유지보수는 건너뛴다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-shutdown-throw-" });
  let maintenanceRan = false;
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createCoreRegistration }],
    clock: manualClock(NOW),
    random: seededRandom(6),
    superviseIo: false,
    // API 정지가 끝난 직후 예외. writer 정지가 관측되기 전이라 유지보수는
    // 조건이 다 모이지 않아 불리지 않는다.
    failShutdown: () => Promise.reject(new Error("shutdown step failed")),
    maintenance: () => {
      maintenanceRan = true;
      return Promise.resolve();
    },
  });
  assert(started.ok);
  const core = started.value;
  // 예외는 호출자에게 그대로 올라간다. finally가 lock을 푼 뒤의 일이다.
  await assertRejects(() => core.shutdown(), Error, "shutdown step failed");
  try {
    assertEquals(maintenanceRan, false);
    await assertLockFree(`${home}/run`);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

// lock이 풀렸으면 같은 파일을 다시 잠글 수 있다. 풀리지 않았으면 conflict다.
async function assertLockFree(runDir: string): Promise<void> {
  await Deno.mkdir(runDir, { recursive: true });
  const locked = await acquireInstanceLock(runDir);
  assert(locked.ok, locked.ok ? "" : locked.error.message);
  await locked.value.release();
}

async function prepare(
  core: {
    prepareBlob(call: {
      principal: string;
      purpose: string;
      bytes: ReadableStream<Uint8Array>;
    }): Promise<
      { ok: true; value: { hash: string } } | {
        ok: false;
        error?: { message: string };
      }
    >;
  },
  purpose: string,
  body: Uint8Array = BODY,
): Promise<
  { ok: true; value: { hash: string } } | {
    ok: false;
    error?: { message: string };
  }
> {
  return await core.prepareBlob({
    principal: "user-1",
    purpose,
    bytes: new ReadableStream({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    }),
  });
}

// 미참조 확인 기록을 유예기간보다 앞으로 당긴다(R9). 파일 mtime이 아니라 이
// 기록이 삭제 자격을 정한다.
async function ageUnreferenced(root: string, hash: string): Promise<void> {
  const path = `${root}/blobs/unreferenced/${hash.slice(0, 2)}/${
    hash.slice(2)
  }.json`;
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(
    path,
    `${JSON.stringify({ unreferenced_at_ms: AGED })}\n`,
  );
}

async function hashesOf(root: string): Promise<string[]> {
  const found: string[] = [];
  for await (const prefix of Deno.readDir(`${root}/blobs/sha256`)) {
    if (!prefix.isDirectory) continue;
    for await (
      const name of Deno.readDir(`${root}/blobs/sha256/${prefix.name}`)
    ) {
      if (name.isFile) found.push(`${prefix.name}${name.name}`);
    }
  }
  return found;
}

async function blobExists(root: string, hash: string): Promise<boolean> {
  try {
    await Deno.stat(
      `${root}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`,
    );
    return true;
  } catch {
    return false;
  }
}

async function post(
  port: number,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
