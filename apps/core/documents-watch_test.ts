// documents/contexts#R7·R9·R10·R11·R12: 제품 core가 documents coordinator의 watch consumer를 붙여
// 문서 저장이 context watch 변화 event로 이어진다(documents#T24). core·documents worker·I/O
// worker·format runner는 모두 실제 자식 프로세스고 데이터 root는 temp dir다. 사람 데이터 root는
// 열지 않는다. 확정은 coordinator가 machine credential의 context.record_watch_change로 한다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import {
  saveFromPaths,
  uploadPrepareBytes,
} from "../../packages/coding-agent/connection/mod.ts";
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
const CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fav";

const AGENT_OPERATIONS = [
  "document.upload",
  "document.prepare",
  "document.save",
  "document.list",
];
const USER_OPERATIONS = [
  "project.create",
  "context.create",
  "context.archive",
  "context.get",
  "document.get",
];

type Opened = {
  core: Core;
  home: string;
  work: string;
  dispose(): Promise<void>;
};

async function open(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-doc-watch-" });
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-doc-watch-work-" }),
  );
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./documents.ts", import.meta.url).href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(41),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
    await Deno.remove(home, { recursive: true });
    await Deno.remove(work, { recursive: true });
  });
  const core = started.value;
  const contexts: [AuthenticatedContext, string][] = [
    [{
      principal: `coding_agent:${CAC}`,
      actor: `coding_agent:${CAC}`,
      scope: { operations: AGENT_OPERATIONS, targets: {} },
      conditions: {},
      credential_ref: "cred-agent",
    }, AGENT_TOKEN],
    [{
      principal: "user",
      actor: "user",
      scope: { operations: USER_OPERATIONS, targets: {} },
      conditions: {},
      credential_ref: "cred-user",
    }, USER_TOKEN],
  ];
  for (const [context, token] of contexts) {
    const accepted = await core.acceptTestCredential?.(context, token);
    assert(accepted?.ok);
    const recorded = await core.record(context);
    assert(recorded.ok);
  }
  guard.keep();
  return {
    core,
    home,
    work,
    async dispose() {
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
      await Deno.remove(work, { recursive: true });
    },
  };
}

type Json = Record<string, unknown>;

async function post(
  core: Core,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Json }> {
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

async function until<T>(
  read: () => T | Promise<T>,
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

type Change = {
  seq: string;
  context: string;
  section: string | null;
  kind: string;
  before: string | null;
  after: string;
};

// ledger를 읽기 전용으로 본다(temp data root). 확인된 변화 event 전부다.
function changes(home: string): Change[] {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    return (db.prepare(
      `select cast(seq as text) as seq, subject, payload from events
       where type = 'ContextWatchedItemChanged' order by events.seq`,
    ).all() as { seq: string; subject: string; payload: string }[]).map(
      (row) => {
        const payload = JSON.parse(row.payload);
        return {
          seq: row.seq,
          context: row.subject,
          section: payload.target.section,
          kind: payload.change_kind,
          before: payload.before_version,
          after: payload.after_version,
        };
      },
    );
  } finally {
    db.close();
  }
}

function lastSaved(home: string): string {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    const row = db.prepare(
      `select cast(max(seq) as text) as seq from events where type = 'DocumentSaved'`,
    ).get() as { seq: string | null };
    return row.seq ?? "0";
  } finally {
    db.close();
  }
}

// watch cursor가 이 seq까지 갔는지. derived store의 cursor는 coordinator가 쓴다.
function watchCursor(home: string): string {
  try {
    const db = new DatabaseSync(`${home}/derived/documents.sqlite`, {
      readOnly: true,
    });
    try {
      const row = db.prepare(
        "select processed_seq from derived_cursors where consumer = 'watch'",
      ).get() as { processed_seq: string } | undefined;
      return row === undefined ? "0" : row.processed_seq;
    } finally {
      db.close();
    }
  } catch {
    return "0";
  }
}

async function caughtUp(home: string): Promise<void> {
  const target = lastSaved(home);
  await until(
    () => watchCursor(home),
    (cursor) => BigInt(cursor) >= BigInt(target),
    "watch cursor가 저장 event까지 오지 않았다",
  );
}

async function createProject(core: Core): Promise<void> {
  const created = await post(core, "projects/create", {
    input: {
      id: PROJECT,
      name: "mahas",
      title: "Notes",
      purpose: "",
      folders: [{ path: "/tmp/lophn-test-doc-watch", description: "" }],
      tracking: { enabled: false, patterns: [], use_gitignore: false },
    },
    idempotency_key: "project-1",
    compare: {},
    prepared: [],
  });
  assertEquals(created.status, 200, JSON.stringify(created.body));
}

const PLAN = [
  "# 계획",
  "",
  "가을 출시 일정을 정한다.",
  "",
  "## 위험",
  "",
  "배포 승인이 늦어질 수 있다.",
  "",
].join("\n");

Deno.test("documents/contexts#R9·R10·R12: 저장한 문서의 변화를 coordinator가 확인해 한 번씩만 기록하고 소실은 항목을 그대로 둔다", async () => {
  const opened = await open();
  try {
    await createProject(opened.core);
    const save = saver(opened);
    await Deno.writeTextFile(`${opened.work}/plan.md`, PLAN);
    const first = await save("plan.md", "plan");
    await caughtUp(opened.home);
    // 문서 전체, 바뀔 section, 바뀌지 않을 section을 watch로 둔다.
    const created = await post(opened.core, "contexts/create", {
      input: {
        id: CONTEXT,
        title: "릴리스",
        purpose: "릴리스 위험을 본다",
        items: [
          {
            target: {
              kind: "document",
              document: first.document,
              section: null,
            },
            perspective: "watch",
            reason: "문서가 바뀌면 안다",
          },
          {
            target: {
              kind: "document",
              document: first.document,
              section: "위험",
            },
            perspective: "watch",
            reason: "위험 절을 본다",
          },
          {
            target: {
              kind: "document",
              document: first.document,
              section: "_preamble",
            },
            perspective: "watch",
            reason: "서문은 그대로여야 한다",
          },
        ],
      },
      idempotency_key: "context-1",
      compare: {},
      prepared: [],
    });
    assertEquals(created.status, 200, JSON.stringify(created.body));
    // 처음 저장한 판은 항목을 만들기 전의 사실이라 기록하지 않았다.
    assertEquals(changes(opened.home), []);

    // 위험 절의 본문만 바꿔 다시 저장한다.
    await Deno.writeTextFile(
      `${opened.work}/plan.md`,
      PLAN.replace("늦어질 수 있다", "반드시 늦어진다"),
    );
    const second = await save("plan.md", "plan");
    assertEquals(second.document, first.document);
    const afterEdit = await until(
      () => changes(opened.home),
      (found) => found.length === 2,
      "내용 변화 event가 두 개 생기지 않았다",
    );
    await caughtUp(opened.home);
    // 문서 전체와 위험 절만이다. 서문은 같은 본문이라 변화가 아니다.
    assertEquals(
      afterEdit.map((change) => [change.section, change.kind]).sort(),
      [[null, "content_changed"], ["위험", "content_changed"]],
    );
    for (const change of afterEdit) {
      assertEquals(change.context, CONTEXT);
      assertEquals(change.before, first.version);
      assertEquals(change.after, second.version);
    }
    // 시간이 지나도 같은 판의 변화는 다시 기록하지 않는다.
    await new Promise((resolve) => setTimeout(resolve, 500));
    assertEquals(changes(opened.home).length, 2);

    // 위험 절 이름을 바꾸면 옛 key는 소실이다. 비슷한 절로 항목을 옮기지 않는다.
    await Deno.writeTextFile(
      `${opened.work}/plan.md`,
      PLAN.replace("늦어질 수 있다", "반드시 늦어진다").replace(
        "## 위험",
        "## 리스크",
      ),
    );
    const third = await save("plan.md", "plan");
    const afterRename = await until(
      () => changes(opened.home),
      (found) => found.length === 4,
      "소실 event가 생기지 않았다",
    );
    await caughtUp(opened.home);
    const added = afterRename.slice(2);
    assertEquals(
      added.map((change) => [change.section, change.kind]).sort(),
      [[null, "content_changed"], ["위험", "section_missing"]],
    );
    for (const change of added) assertEquals(change.after, third.version);
    // 항목은 그대로 '위험'이고 '리스크'로 바뀌지 않았다.
    const got = await post(opened.core, "contexts/get", { context: CONTEXT });
    assertEquals(got.status, 200, JSON.stringify(got.body));
    const items = (got.body["context"] as {
      items: { target: { section: string | null } }[];
    }).items;
    assertEquals(
      items.map((item) => item.target.section),
      [null, "위험", "_preamble"],
    );
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/contexts#R7·R12: 보관한 context의 watch 검사는 멈추고 보관 전의 저장은 기록하지 않는다", async () => {
  const opened = await open();
  try {
    await createProject(opened.core);
    const save = saver(opened);
    await Deno.writeTextFile(`${opened.work}/plan.md`, PLAN);
    const first = await save("plan.md", "plan");
    await caughtUp(opened.home);
    const created = await post(opened.core, "contexts/create", {
      input: {
        id: CONTEXT,
        title: "릴리스",
        purpose: "릴리스 위험을 본다",
        items: [{
          target: { kind: "document", document: first.document, section: null },
          perspective: "watch",
          reason: "문서가 바뀌면 안다",
        }],
      },
      idempotency_key: "context-1",
      compare: {},
      prepared: [],
    });
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const revision = created.body["revision"] as string;
    const archived = await post(opened.core, "contexts/archive", {
      input: { context: CONTEXT },
      idempotency_key: "archive-1",
      compare: { base_revision: revision },
      prepared: [],
    });
    assertEquals(archived.status, 200, JSON.stringify(archived.body));
    // 보관 중에 저장한다.
    await Deno.writeTextFile(
      `${opened.work}/plan.md`,
      PLAN.replace("가을", "겨울"),
    );
    await save("plan.md", "plan");
    await caughtUp(opened.home);
    assertEquals(changes(opened.home), []);
  } finally {
    await opened.dispose();
  }
});
