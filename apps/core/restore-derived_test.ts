// platform/backup-and-migration#R14 platform/ledger#R19 documents/outline-and-search#R13: 복원한
// ledger 위에서 documents의 derived index가 옛 ledger의 cursor를 버리고 복원 ledger 기준으로 다시
// 만들어진다. core·documents worker·I/O worker·format runner는 실제 자식 프로세스고 데이터 root는
// temp dir다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/server/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import {
  saveFromPaths,
  uploadPrepareBytes,
} from "../../packages/coding-agent/connection/mod.ts";
import {
  backupStamp,
  createBackup,
  planRestore,
  RESTORE_DECISION,
  restoreBinding,
} from "../../packages/core/storage/migration/mod.ts";
import { type Core, startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";
import { lophnAgentDefinitions } from "./lophn-agent.ts";

const teams: TeamModule[] = [
  { lophnAgentDefinitions },
  { createLedgerRegistration },
];
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const AGENT_TOKEN = "a".repeat(43);
const USER_TOKEN = "c".repeat(43);
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const NOW = Date.UTC(2024, 0, 1);

const AGENT_OPERATIONS = [
  "document.upload",
  "document.prepare",
  "document.save",
  "document.list",
];
const USER_OPERATIONS = [
  "project.create",
  "search.query",
  "search.status",
  "platform/status",
];

type Opened = { core: Core; home: string; work: string };

async function open(
  home: string,
  work: string,
  generation: number,
): Promise<Opened> {
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./documents.ts", import.meta.url).href,
    ],
    clock: manualClock(NOW),
    // 시작마다 다른 seed다. 같은 seed는 같은 epoch·credential ref를 만든다.
    random: seededRandom(50 + generation),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
  });
  const core = started.value;
  const contexts: [AuthenticatedContext, string][] = [
    [{
      principal: `coding_agent:${CAC}`,
      actor: `coding_agent:${CAC}`,
      scope: { operations: AGENT_OPERATIONS, targets: {} },
      conditions: {},
      credential_ref: `cred-agent-${generation}`,
    }, AGENT_TOKEN],
    [{
      principal: "user",
      actor: "user",
      scope: { operations: USER_OPERATIONS, targets: {} },
      conditions: {},
      credential_ref: `cred-user-${generation}`,
    }, USER_TOKEN],
  ];
  for (const [context, token] of contexts) {
    const accepted = await core.acceptTestCredential?.(context, token);
    assert(accepted?.ok);
    assert((await core.record(context)).ok);
  }
  guard.keep();
  return { core, home, work };
}

type Json = Record<string, unknown>;

async function post(core: Core, path: string, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${USER_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})) as Json,
  };
}

function saver(opened: Opened) {
  const client = createCoreClient({
    baseUrl: `http://127.0.0.1:${opened.core.port}`,
    connection: CAC,
    provider: () =>
      Promise.resolve({ ok: true, value: { token: AGENT_TOKEN } }),
  });
  const deps = {
    client,
    scope: { root: opened.work, forbidden: [opened.home] },
    prepareBytes: uploadPrepareBytes(client),
  };
  return async (path: string, slug: string) => {
    const saved = await saveFromPaths(deps, {
      paths: [path],
      place: { kind: "project" as const, id: PROJECT },
      slug,
    });
    assert(saved.ok, saved.ok ? "" : JSON.stringify(saved.error));
    return saved.value.saved as { document: string; version: string };
  };
}

type Hit = { document: string; version: string };

async function search(core: Core, query: string): Promise<Hit[]> {
  const found = await post(core, "search/query", { query });
  assertEquals(found.status, 200, JSON.stringify(found.body));
  return found.body["results"] as Hit[];
}

// index가 따라올 때까지 기다린다. consumer는 event 구독을 따라 비동기로 반영한다.
async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  what: string,
): Promise<T> {
  const deadline = Date.now() + 60_000;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await read();
    if (done(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${what}: ${JSON.stringify(last)}`);
}

function note(title: string, body: string): string {
  return `# ${title}\n\n${body}\n`;
}

// derived store를 읽기 전용으로 본다. coordinator가 유일한 writer다.
function derived(home: string): DatabaseSync {
  return new DatabaseSync(`${home}/derived/documents.sqlite`, {
    readOnly: true,
  });
}

function cursorOf(home: string): string {
  const db = derived(home);
  try {
    const row = db.prepare(
      "select processed_seq from derived_cursors where consumer = 'search'",
    ).get() as { processed_seq: string } | undefined;
    return row === undefined ? "0" : row.processed_seq;
  } finally {
    db.close();
  }
}

function recordedLedger(home: string): string | undefined {
  const db = derived(home);
  try {
    const row = db.prepare(
      "select value from derived_basis where key = 'ledger_id'",
    ).get() as { value: string } | undefined;
    return row?.value;
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

async function ledgerIdOf(core: Core): Promise<string> {
  const status = await post(core, "platform/status", {});
  assertEquals(status.status, 200, JSON.stringify(status.body));
  return String(status.body["ledger_id"]);
}

Deno.test("platform/backup-and-migration#R14 platform/ledger#R19 documents/outline-and-search#R13: 복원한 ledger의 derived는 옛 cursor를 버리고 복원 ledger 기준으로 index를 다시 만든다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-restore-derived-" });
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-restore-derived-work-" }),
  );
  let current: Opened | undefined;
  try {
    current = await open(home, work, 1);
    const created = await post(current.core, "projects/create", {
      input: {
        id: PROJECT,
        name: "mahas",
        title: "Notes",
        purpose: "",
        folders: [{ path: `${work}/project-folder`, description: "" }],
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      },
      idempotency_key: "project-1",
      compare: {},
      prepared: [],
    });
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const save = saver(current);
    await Deno.writeTextFile(
      `${work}/kept.md`,
      note("가을 계획", "가을 출시 일정을 정한다."),
    );
    const kept = await save("kept.md", "kept");
    await until(
      () => search(current!.core, "가을 출시"),
      (hits) => hits.length === 1,
      "처음 판이 index에 오르지 않았다",
    );
    const keptCursor = cursorOf(home);
    const idBefore = await ledgerIdOf(current.core);
    assertEquals(recordedLedger(home), idBefore);

    // 이 시점의 backup. 운영 중 core의 ledger에서 만든다.
    const ledgerDb = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
    const version = Number(
      (ledgerDb.prepare(
        "select max(version) as v from schema_migrations",
      ).get() as { v: number | bigint }).v,
    );
    ledgerDb.close();
    const stamp = backupStamp("2024-01-02T03:04:05.000Z");
    assert(stamp.ok);
    const backup = await createBackup(`${home}/lophn.db`, {
      root: home,
      schemaVersion: version,
      stamp: stamp.value,
      now: () => "2024-01-02T03:04:05.000Z",
    });
    assert(backup.ok, backup.ok ? "" : backup.error.message);

    // backup 뒤의 기록. 복원하면 이 문서는 ledger에 없다. derived에는 옛 cursor가 쌓인다.
    await Deno.writeTextFile(
      `${work}/lost.md`,
      note("겨울 계획", "겨울 점검 일정은 잃는다."),
    );
    await save("lost.md", "lost");
    await until(
      () => search(current!.core, "겨울 점검"),
      (hits) => hits.length === 1,
      "backup 뒤 판이 index에 오르지 않았다",
    );
    const staleCursor = cursorOf(home);
    assert(BigInt(staleCursor) > BigInt(keptCursor));
    // 요약 cache는 model 판단이라 같은 출력으로 다시 만들 수 있다고 보지 않는다. 복원 때
    // 옛 ledger의 요약을 옮기지 않는다.
    const cache = new DatabaseSync(`${home}/derived/documents.sqlite`);
    cache.exec("pragma busy_timeout=5000");
    cache.prepare(
      "insert into summary_cache (version, section_key, input_hash, text) values (?, NULL, 'h', 'model summary')",
    ).run(kept.version);
    cache.close();

    const planned = await planRestore(
      home,
      `${home}/lophn.db`,
      backup.value.created_at,
      version,
    );
    assert(planned.ok, planned.ok ? "" : planned.error.message);
    const binding = await restoreBinding(planned.value);
    const issued = await current.core.confirmation?.({
      action: "issue",
      request: {
        type: "confirmation_handle_register",
        window_id: "win-restore",
        target_ref: binding.target,
        content_hash: binding.content,
        allowed_decisions: [RESTORE_DECISION],
        expires_at: new Date(NOW + 120_000).toISOString(),
      },
    });
    assert(issued?.ok);
    const restored = await current.core.restore({
      created_at: backup.value.created_at,
      confirmation: (issued.value as { confirmation: string }).confirmation,
    });
    assert(restored.ok, restored.ok ? "" : restored.error.message);
    current = undefined;

    // 같은 data root를 새 core로 띄운다. derived 파일은 옛 ledger의 cursor를 그대로 쥐고 있다.
    assertEquals(cursorOf(home), staleCursor);
    current = await open(home, work, 2);
    const idAfter = await ledgerIdOf(current.core);
    assertNotEquals(idAfter, idBefore);
    // 복원 ledger 기준으로 다시 만들어졌다: 식별이 새 값이고, 잃은 문서의 index가 없다.
    await until(
      () => Promise.resolve(recordedLedger(home)),
      (value) => value === idAfter,
      "derived가 새 ledger 식별로 맞춰지지 않았다",
    );
    const hits = await until(
      () => search(current!.core, "가을 출시"),
      (found) => found.length === 1,
      "복원 ledger의 문서가 다시 index에 오르지 않았다",
    );
    assertEquals(hits[0].document, kept.document);
    assertEquals(await search(current.core, "겨울 점검"), []);
    const db = derived(home);
    assertEquals(
      db.prepare("select count(*) as n from summary_cache").get()?.n,
      0,
    );
    db.close();

    // 복원 ledger의 새 기록은 옛 cursor보다 작은 seq를 받는다. 옛 cursor를 이었다면 건너뛰어
    // index에 오르지 않는다.
    await Deno.writeTextFile(
      `${work}/after.md`,
      note("여름 계획", "여름 휴가 일정을 정한다."),
    );
    const after = await saver(current)("after.md", "after");
    const found = await until(
      () => search(current!.core, "여름 휴가"),
      (hits2) => hits2.length === 1,
      "복원 뒤 새 판이 index에 오르지 않았다(옛 cursor를 이었다)",
    );
    assertEquals(found[0].document, after.document);
  } finally {
    await current?.core.shutdown();
    await Deno.remove(home, { recursive: true });
    await Deno.remove(work, { recursive: true });
  }
});
