// platform/ledger#R15, platform/api#R5, documents/file-tracking#R3: 제품 reader 등록이 팀 event 정의와
// 공개 정책을 모아 events/list에 싣는다(documents plan Q17). 실제 core를 임시 data root로 띄우고
// 사람·agent·app credential과 core 안 구독자를 같은 events/list 경로로 본다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { EventEnvelope } from "../../packages/protocol/platform/mod.ts";
import { directoryScanner } from "../../packages/documents/projects/scan.ts";
import { previewTracking } from "../../packages/documents/projects/work.ts";
import { type Core, startCore } from "./core.ts";
import { createLedgerRegistration } from "./documents.ts";
import { DOCUMENTS_FEED_PRINCIPAL } from "./documents-events.ts";
import { userOperations } from "./parent.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

const PROJECT = "prj_01kq12a1pha000000000000000";
const AGENT = "agent:asg_01arz3ndektsv4rrffq69g5fav";
const APP = "app:app_01arz3ndektsv4rrffq69g5fav";

type Json = Record<string, unknown>;
type Who = "user" | "agent" | "app" | "intruder" | "other-machine";

const TOKENS: Record<Who, string> = {
  user: "u".repeat(43),
  agent: "a".repeat(43),
  app: "p".repeat(43),
  // actor가 machine이 아니면서 feed principal 이름을 쓰는 자격.
  intruder: "i".repeat(43),
  "other-machine": "m".repeat(43),
};

const EVENT_OPERATIONS = [
  "ListEvents",
  "ProjectCreated",
  "ProjectTrackingChanged",
];

function context(who: Who) {
  const scope = (operations: string[]) => ({ operations, targets: {} });
  switch (who) {
    case "user":
      return {
        principal: "user",
        actor: "user" as const,
        credential_ref: "cred_events_user",
        scope: scope([
          "project.create",
          "project.set_tracking",
          ...EVENT_OPERATIONS,
        ]),
        conditions: {},
      };
    case "agent":
      return {
        principal: "agent-one",
        actor: AGENT,
        credential_ref: "cred_events_agent",
        scope: scope(EVENT_OPERATIONS),
        conditions: {},
      };
    case "app":
      return {
        principal: "app-one",
        actor: APP,
        credential_ref: "cred_events_app",
        scope: scope(EVENT_OPERATIONS),
        conditions: {},
      };
    case "intruder":
      return {
        principal: DOCUMENTS_FEED_PRINCIPAL,
        actor: AGENT,
        credential_ref: "cred_events_intruder",
        scope: scope(EVENT_OPERATIONS),
        conditions: {},
      };
    case "other-machine":
      return {
        principal: "machine:other",
        actor: "machine" as const,
        credential_ref: "cred_events_other_machine",
        scope: scope(EVENT_OPERATIONS),
        conditions: {},
      };
  }
}

async function startAt(home: string): Promise<Core> {
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createLedgerRegistration }],
    teamModules: [new URL("./documents.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(21),
    testCredentials: true,
    superviseIo: false,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
  });
  const core = started.value;
  assert(core.acceptTestCredential);
  for (const who of Object.keys(TOKENS) as Who[]) {
    const accepted = await core.acceptTestCredential(
      context(who),
      TOKENS[who],
    );
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    const recorded = await core.record(context(who));
    assert(recorded.ok, recorded.ok ? "" : recorded.error.message);
  }
  guard.keep();
  return core;
}

async function post(
  core: Core,
  who: Who,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Json }> {
  const response = await fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKENS[who]}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Json };
}

// 프로젝트를 만들고 tracking을 켠다(ProjectCreated, ProjectTrackingChanged).
async function createAndTrack(core: Core, folder: string): Promise<void> {
  const folders = [{ path: folder, description: "a" }];
  const created = await post(core, "user", "projects/create", {
    input: {
      id: PROJECT,
      name: "alpha",
      title: "Alpha",
      purpose: "",
      folders,
      tracking: { enabled: false, patterns: [], use_gitignore: false },
    },
    idempotency_key: "create-alpha",
    compare: {},
    prepared: [],
  });
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const revision = String(created.body["revision"]);
  const tracking = {
    enabled: true,
    patterns: [{ effect: "include" as const, glob: "**/*.md" }],
    use_gitignore: false,
  };
  const preview = previewTracking(directoryScanner(), {
    project: PROJECT,
    baseRevision: revision,
    folders,
    tracking,
    observedAt: "2026-10-06T00:00:00.000Z",
  });
  assert(preview.ok);
  const applied = await post(core, "user", "projects/set_tracking", {
    input: { project: PROJECT, folders, tracking, preview: preview.value },
    idempotency_key: "track-alpha",
    compare: { base_revision: revision },
    prepared: [],
  });
  assertEquals(applied.status, 200, JSON.stringify(applied.body));
}

async function listed(
  core: Core,
  who: Who,
  types?: string[],
): Promise<{ status: number; body: Json }> {
  return await post(core, who, "events/list", {
    after_seq: "0",
    ...(types ? { types } : {}),
  });
}

function typesOf(body: Json): string[] {
  return (body["events"] as { type: string }[]).map((event) => event.type);
}

async function withCore(
  run: (core: Core, folder: string) => Promise<void>,
): Promise<void> {
  const home = await Deno.makeTempDir({ prefix: "lophn-events-reg-" });
  const folder = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-events-reg-folder-" }),
  );
  const core = await startAt(home);
  try {
    await run(core, folder);
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
    await Deno.remove(folder, { recursive: true });
  }
}

Deno.test("platform/ledger#R15: 사람은 documents Project event를 events/list에서 본다", async () => {
  await withCore(async (core, folder) => {
    await createAndTrack(core, folder);
    const all = await listed(core, "user");
    assertEquals(all.status, 200, JSON.stringify(all.body));
    // owner 정책이 사람에게 연 Project event만 보인다. 규칙 변경(ProjectTrackingChanged)과
    // 문서 연결 event는 core 안 구독자에게만 열려 있다.
    assertEquals(typesOf(all.body), ["ProjectCreated"]);
    const created = (all.body["events"] as EventEnvelope[])[0];
    assertEquals(created.subject, PROJECT);
    // 등록된 type 필터도 같은 결과다.
    const filtered = await listed(core, "user", ["ProjectCreated"]);
    assertEquals(typesOf(filtered.body), ["ProjectCreated"]);
    const hidden = await listed(core, "user", ["ProjectTrackingChanged"]);
    assertEquals(hidden.status, 200);
    assertEquals(typesOf(hidden.body), []);
  });
});

Deno.test("platform/ledger#R15 platform/identity#R8: agent와 app은 범위 밖 event를 없는 event와 같은 답으로 받는다", async () => {
  await withCore(async (core, folder) => {
    await createAndTrack(core, folder);
    for (const who of ["agent", "app", "intruder", "other-machine"] as const) {
      // event 이름을 scope에 적었어도 owner 정책이 사람 전용이라 agent·app·다른 machine에는 닫혀 있다.
      const present = await listed(core, who, ["ProjectCreated"]);
      // 일어난 적 없는 등록 event. 범위 밖 event와 같은 모양이어야 한다.
      const absent = await listed(core, who, ["ProjectArchived"]);
      assertEquals(present.status, 200, who);
      assertEquals(present.body, absent.body, who);
      assertEquals(typesOf(present.body), [], who);
      const everything = await listed(core, who);
      assertEquals(everything.status, 200, who);
      assertEquals(typesOf(everything.body), [], who);
      // 규칙 변경 event도 feed가 아니면 같은 답이다.
      const tracking = await listed(core, who, ["ProjectTrackingChanged"]);
      assertEquals(tracking.body, absent.body, who);
    }
  });
});

Deno.test("platform/api#R5 documents/file-tracking#R3: core 안 구독자가 documents 규칙 변경 event를 받는다", async () => {
  await withCore(async (core, folder) => {
    const feed = core.documentsFeed;
    assert(feed);
    const received: EventEnvelope[] = [];
    feed.listen((events) => received.push(...events));
    // 구독이 열린 뒤에 일어난 event만 온다. 열리기 전 변화는 (다시) 구독 때의 snapshot 읽기가 본다.
    for (let waited = 0; waited < 100 && !feed.open; waited++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(feed.open, "core 안 구독이 열리지 않았다");
    await createAndTrack(core, folder);
    for (let waited = 0; waited < 100 && received.length < 2; waited++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assertEquals(received.map((event) => event.type), [
      "ProjectCreated",
      "ProjectTrackingChanged",
    ]);
    const changed = received[1];
    assertEquals(changed.subject, PROJECT);
    assert(BigInt(changed.seq) > BigInt(received[0].seq));
  });
});

Deno.test("platform/ledger#R15: 사람 token 상한에 팀이 정책을 낸 event 이름이 들어간다", () => {
  const names = userOperations([], ["ProjectCreated"]);
  assert(names.includes("ProjectCreated"));
  assert(!userOperations([]).includes("ProjectCreated"));
});
