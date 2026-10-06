// platform/backup-and-migration#R13, R14, platform/ledger#R19: 실제 core를 임시 data root로 띄워
// 사람이 잃을 범위를 확인한 backup 복원을 본다. backup은 운영 중 core의 ledger에서 만들고, 복원
// 뒤 같은 data root를 새 core로 다시 띄워 새 epoch·새 ledger_id·derived 재생성을 본다. 사람
// 데이터 root는 열지 않는다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { EventEnvelope } from "../../packages/contracts/platform/mod.ts";
import {
  backupStamp,
  createBackup,
  planRestore,
  RESTORE_DECISION,
  restoreBinding,
} from "../../packages/platform/backup-and-migration/mod.ts";
import { type Core, startCore } from "./core.ts";
import { createLedgerRegistration } from "./documents.ts";

const NOW = Date.UTC(2024, 0, 1);
const USER_TOKEN = "u".repeat(43);
const OPERATIONS = [
  "ListEvents",
  "ProjectCreated",
  "project.create",
  "project.list",
  "platform/status",
];
const PROJECTS = [1, 2, 3, 4].map((n) => `prj_01kq12a1pha00000000000000${n}`);

type Json = Record<string, unknown>;

function context(generation: number) {
  return {
    principal: "user",
    actor: "user" as const,
    credential_ref: `cred_restore_${generation}`,
    scope: { operations: OPERATIONS, targets: {} },
    conditions: {},
  };
}

async function startAt(home: string, generation: number): Promise<Core> {
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createLedgerRegistration }],
    teamModules: [new URL("./documents.ts", import.meta.url).href],
    clock: manualClock(NOW),
    // 시작마다 다른 seed다. 같은 seed는 같은 epoch·credential ref를 만든다.
    random: seededRandom(40 + generation),
    testCredentials: true,
    superviseIo: false,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  const accepted = await core.acceptTestCredential?.(
    context(generation),
    USER_TOKEN,
  );
  assert(accepted?.ok);
  assert((await core.record(context(generation))).ok);
  return core;
}

async function post(
  core: Core,
  path: string,
  body: unknown,
  token = USER_TOKEN,
) {
  const response = await fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Json };
}

async function createProject(core: Core, id: string, name: string) {
  const created = await post(core, "projects/create", {
    input: {
      id,
      name,
      title: name,
      purpose: "",
      folders: [],
      tracking: { enabled: false, patterns: [], use_gitignore: false },
    },
    idempotency_key: `create-${name}`,
    compare: {},
    prepared: [],
  });
  assertEquals(created.status, 200, JSON.stringify(created.body));
}

async function statusOf(core: Core): Promise<{ ledger_id: string }> {
  const status = await post(core, "platform/status", {});
  assertEquals(status.status, 200, JSON.stringify(status.body));
  return status.body as unknown as { ledger_id: string };
}

// 이름 있는 구독을 열고 받은 event를 모은 뒤 ack를 보낸다. ack는 derived 전송 위치다.
async function subscribeAndAck(
  core: Core,
  ackThrough: string | undefined,
): Promise<EventEnvelope[]> {
  const socket = new WebSocket(
    `ws://127.0.0.1:${core.port}/v1/events/subscribe`,
    { headers: { authorization: `Bearer ${USER_TOKEN}` } },
  );
  const events: EventEnvelope[] = [];
  let frames = 0;
  socket.onmessage = (message) => {
    const frame = JSON.parse(String(message.data)) as Json;
    frames++;
    if (frame["type"] === "events") {
      events.push(...frame["events"] as EventEnvelope[]);
    }
  };
  const opened = await new Promise<boolean>((resolve) => {
    socket.onopen = () => resolve(true);
    socket.onerror = () => resolve(false);
  });
  assert(opened, "WebSocket이 열리지 않았다");
  socket.send(JSON.stringify({
    type: "subscribe",
    subscriber: "display",
    types: [],
    subjects: [],
  }));
  for (let waited = 0; frames === 0 && waited < 200; waited++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert(frames > 0, "첫 frame이 오지 않았다");
  if (ackThrough !== undefined) {
    socket.send(JSON.stringify({
      type: "ack",
      subscriber: "display",
      through_seq: ackThrough,
    }));
    // ack는 비동기로 저장된다. 저장 위치가 올라올 때까지 기다린다.
    for (let waited = 0; waited < 200; waited++) {
      const stored = ackPositions(core.dataRoot);
      if (stored.includes(ackThrough)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  socket.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  return events;
}

// derived api-subscriptions 저장소의 위치를 읽기 전용으로 본다.
function ackPositions(root: string): string[] {
  try {
    const db = new DatabaseSync(
      `${root}/derived/api-subscriptions/subscriptions.db`,
      { readOnly: true },
    );
    try {
      return db.prepare("select through_seq from positions").all().map((
        row,
      ) => String(row["through_seq"]));
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

function eventSeqs(path: string): number[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare("select seq from events order by seq").all().map((row) =>
      Number(row["seq"])
    );
  } finally {
    db.close();
  }
}

async function issueRestoreHandle(
  core: Core,
  binding: { target: string; content: string },
  decision: string = RESTORE_DECISION,
): Promise<string> {
  const issued = await core.confirmation?.({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: "win-restore",
      target_ref: binding.target,
      content_hash: binding.content,
      allowed_decisions: [decision],
      expires_at: new Date(NOW + 120_000).toISOString(),
    },
  });
  assert(issued?.ok);
  return (issued.value as { confirmation: string }).confirmation;
}

// 운영 중 ledger에서 backup을 만든다. I/O worker의 하루 backup과 같은 createBackup이다.
async function backupNow(core: Core, at: string) {
  const stamp = backupStamp(at);
  assert(stamp.ok);
  const db = new DatabaseSync(`${core.dataRoot}/lophn.db`, { readOnly: true });
  const version = Number(
    (db.prepare("select max(version) as v from schema_migrations").get() as {
      v: number | bigint;
    }).v,
  );
  db.close();
  const created = await createBackup(`${core.dataRoot}/lophn.db`, {
    root: core.dataRoot,
    schemaVersion: version,
    stamp: stamp.value,
    now: () => at,
  });
  assert(created.ok, created.ok ? "" : created.error.message);
  return created.value;
}

// 사람이 본 범위(백업 뒤 기록)를 계획으로 읽는다.
async function planOf(core: Core, createdAt: string) {
  const db = new DatabaseSync(`${core.dataRoot}/lophn.db`, { readOnly: true });
  const version = Number(
    (db.prepare("select max(version) as v from schema_migrations").get() as {
      v: number | bigint;
    }).v,
  );
  db.close();
  const planned = await planRestore(
    core.dataRoot,
    `${core.dataRoot}/lophn.db`,
    createdAt,
    version,
  );
  assert(planned.ok, planned.ok ? "" : planned.error.message);
  return planned.value;
}

Deno.test("platform/backup-and-migration#R13 #R14 platform/ledger#R19: 확인한 복원은 현재 자료를 보존하고 새 epoch·ledger_id로 복원 ledger 기준 derived를 다시 만든다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-restore-core-" });
  let first: Core | undefined;
  let second: Core | undefined;
  try {
    first = await startAt(home, 1);
    await createProject(first, PROJECTS[0], "alpha");
    await createProject(first, PROJECTS[1], "bravo");
    // 사람의 화면이 이름 있는 구독으로 seq 2까지 받았다고 전송 위치를 남긴다.
    assertEquals((await subscribeAndAck(first, "2")).length, 2);
    assertEquals(ackPositions(first.dataRoot), ["2"]);
    const backup = await backupNow(first, "2024-01-02T03:04:05.000Z");
    assertEquals(backup.through_seq, "2");
    // backup 뒤에 쓴 기록 둘. 복원하면 잃는다.
    await createProject(first, PROJECTS[2], "charlie");
    await createProject(first, PROJECTS[3], "delta");
    // 이어 받는 구독은 저장 위치(2) 다음부터 온다.
    assertEquals(
      (await subscribeAndAck(first, "4")).map((event) => event.seq),
      ["3", "4"],
    );
    assertEquals(ackPositions(first.dataRoot), ["4"]);
    const oldLedgerId = (await statusOf(first)).ledger_id;
    const oldEpoch = first.epoch;

    const plan = await planOf(first, backup.created_at);
    assertEquals(plan.lost, { from_seq: "3", through_seq: "4", events: 2 });
    const binding = await restoreBinding(plan);

    // 확인이 없거나 다른 결정·다른 내용이면 아무것도 멈추지 않는다(R13).
    const noHandle = await first.restore({
      created_at: backup.created_at,
      confirmation: "x".repeat(43),
    });
    assert(!noHandle.ok);
    const wrongDecision = await first.restore({
      created_at: backup.created_at,
      confirmation: await issueRestoreHandle(first, binding, "delete_file"),
    });
    assert(!wrongDecision.ok);
    const staleHandle = await first.restore({
      created_at: backup.created_at,
      confirmation: await issueRestoreHandle(first, {
        target: binding.target,
        content: "0".repeat(64),
      }),
    });
    assert(!staleHandle.ok);
    // 아직 서비스 중이다: 같은 core가 그대로 답하고 ledger는 그대로다.
    assertEquals((await statusOf(first)).ledger_id, oldLedgerId);
    assertEquals(eventSeqs(`${home}/lophn.db`), [1, 2, 3, 4]);

    // 사람이 범위를 확인한 handle로 복원한다.
    const restored = await first.restore({
      created_at: backup.created_at,
      confirmation: await issueRestoreHandle(first, binding),
    });
    assert(restored.ok, restored.ok ? "" : restored.error.message);
    first = undefined;
    assertEquals(restored.value.restored_through_seq, "2");
    assertEquals(restored.value.previous_through_seq, "4");
    // 이전 현재 자료(seq 4까지)와 복원본(seq 2까지)이 각각 남는다.
    assertEquals(
      eventSeqs(`${restored.value.previous_directory}/ledger.db`),
      [1, 2, 3, 4],
    );
    assertEquals(eventSeqs(`${home}/lophn.db`), [1, 2]);

    // 같은 data root를 새 core로 띄운다. 새 epoch·새 ledger_id다.
    second = await startAt(home, 2);
    assertNotEquals(second.epoch, oldEpoch);
    const newLedgerId = (await statusOf(second)).ledger_id;
    assertNotEquals(newLedgerId, oldLedgerId);
    assertEquals(newLedgerId, restored.value.ledger_id);
    // 예전 credential은 이 core의 메모리 registry에 없다. 재발급 없이는 닿지 못한다.
    const stale = await post(second, "platform/status", {}, "z".repeat(43));
    assertEquals(stale.status, 401);
    // 전송 위치는 복원 ledger 기준으로 다시 만들어졌다. 옛 ledger의 seq 4를 이어 받지 않는다.
    assertEquals(ackPositions(second.dataRoot), []);
    const replayed = await subscribeAndAck(second, undefined);
    assertEquals(replayed.map((event) => event.seq), ["1", "2"]);
    // 복원 ledger에 없는 프로젝트는 읽히지 않고 있는 프로젝트는 읽힌다.
    const listed = await post(second, "projects/list", { status: "active" });
    assertEquals(listed.status, 200, JSON.stringify(listed.body));
    const names = ((listed.body as { projects?: { name: string }[] })
      .projects ?? []).map((project) => project.name).sort();
    assertEquals(names, ["alpha", "bravo"]);
  } finally {
    await first?.shutdown();
    await second?.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("platform/backup-and-migration#R13: 검증하지 못한 묶음의 복원은 현재 자료를 바꾸지 않고 core를 멈춘 채 오류를 돌려준다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-restore-core-bad-" });
  let first: Core | undefined;
  let second: Core | undefined;
  try {
    first = await startAt(home, 1);
    await createProject(first, PROJECTS[0], "alpha");
    const backup = await backupNow(first, "2024-01-02T03:04:05.000Z");
    await createProject(first, PROJECTS[1], "bravo");
    const ledgerId = (await statusOf(first)).ledger_id;
    // 묶음을 만든 뒤 backup ledger가 변조됐다.
    const folder = `${home}/backups/${
      (await Array.fromAsync(Deno.readDir(`${home}/backups`))).find((entry) =>
        /^[0-9]{8}T/.test(entry.name)
      )!.name
    }`;
    const bytes = await Deno.readFile(`${folder}/ledger.db`);
    bytes[bytes.length - 1] ^= 0xff;
    await Deno.writeFile(`${folder}/ledger.db`, bytes);
    const binding = await restoreBinding(
      await planOf(first, backup.created_at),
    );
    const failed = await first.restore({
      created_at: backup.created_at,
      confirmation: await issueRestoreHandle(first, binding),
    });
    assert(!failed.ok);
    first = undefined;
    // 현재 ledger·식별·보존할 이전 자료는 그대로다. 다시 띄우면 이전 상태로 열린다.
    assertEquals(eventSeqs(`${home}/lophn.db`), [1, 2]);
    second = await startAt(home, 2);
    assertEquals((await statusOf(second)).ledger_id, ledgerId);
    const listed = await post(second, "projects/list", { status: "active" });
    assertEquals(
      ((listed.body as { projects?: unknown[] }).projects ?? []).length,
      2,
    );
  } finally {
    await first?.shutdown();
    await second?.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("platform/backup-and-migration#R14: ledger를 새로 만들 때와 복원할 때만 ledger_id가 바뀌고 다시 시작해서는 그대로다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-ledger-id-" });
  let core: Core | undefined;
  try {
    core = await startAt(home, 1);
    const created = (await statusOf(core)).ledger_id;
    assert(/^ldg_[0-9a-f]{32}$/.test(created));
    // 쓰기가 늘어도 ledger 식별은 같다(예전 값은 파일 크기라 쓸 때마다 달랐다).
    await createProject(core, PROJECTS[0], "alpha");
    assertEquals((await statusOf(core)).ledger_id, created);
    await core.shutdown();
    core = await startAt(home, 2);
    assertEquals((await statusOf(core)).ledger_id, created);
  } finally {
    await core?.shutdown();
    await Deno.remove(home, { recursive: true });
  }
  // 다른 data root의 새 ledger는 다른 식별이다.
  const other = await Deno.makeTempDir({ prefix: "lophn-ledger-id-other-" });
  let otherCore: Core | undefined;
  try {
    otherCore = await startAt(other, 1);
    const id = (await statusOf(otherCore)).ledger_id;
    assert(/^ldg_[0-9a-f]{32}$/.test(id));
  } finally {
    await otherCore?.shutdown();
    await Deno.remove(other, { recursive: true });
  }
});
