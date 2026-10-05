// platform/api#R5, platform/ledger#R15, platform/identity#R8: 실제 core를 임시 data root로 띄우고
// WebSocket `/v1/events/subscribe` 연결이 구독 뒤에 확정된 event를 순서대로 받는지, 닫힌 연결이
// session을 남기지 않는지, 범위 밖 event가 agent·app 구독자에 닿지 않는지, `subjects` 필터가
// 볼 수 있는 subject는 걸러 주고 볼 수 없는 subject는 event 없는 subject와 같은 답을 주는지 본다.
// 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { EventEnvelope } from "../../packages/contracts/platform/mod.ts";
import { type Core, startCore } from "./core.ts";
import { createLedgerRegistration } from "./documents.ts";

const PROJECT = "prj_01kq12a1pha000000000000000";
const OTHER_PROJECT = "prj_01kq12a1pha000000000000001";
const AGENT = "agent:asg_01arz3ndektsv4rrffq69g5fav";
const APP = "app:app_01arz3ndektsv4rrffq69g5fav";

type Json = Record<string, unknown>;
type Who = "user" | "agent" | "app";

const TOKENS: Record<Who, string> = {
  user: "u".repeat(43),
  agent: "a".repeat(43),
  app: "p".repeat(43),
};

const EVENT_OPERATIONS = [
  "ListEvents",
  "ProjectCreated",
  "ProjectUpdated",
  "ProjectArchived",
  "ProjectUnarchived",
];

function context(who: Who) {
  const scope = (operations: string[]) => ({ operations, targets: {} });
  switch (who) {
    case "user":
      return {
        principal: "user",
        actor: "user" as const,
        credential_ref: "cred_sub_user",
        scope: scope([
          "project.create",
          "project.archive",
          "project.unarchive",
          ...EVENT_OPERATIONS,
        ]),
        conditions: {},
      };
    case "agent":
      return {
        principal: "agent-one",
        actor: AGENT,
        credential_ref: "cred_sub_agent",
        scope: scope(EVENT_OPERATIONS),
        conditions: {},
      };
    case "app":
      return {
        principal: "app-one",
        actor: APP,
        credential_ref: "cred_sub_app",
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
    random: seededRandom(22),
    testCredentials: true,
    superviseIo: false,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
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

async function command(
  core: Core,
  path: string,
  key: string,
  input: unknown,
  compare: unknown,
): Promise<Json> {
  const result = await post(core, "user", path, {
    input,
    idempotency_key: key,
    compare,
    prepared: [],
  });
  assertEquals(result.status, 200, JSON.stringify(result.body));
  return result.body;
}

async function createProject(core: Core, id: string, name: string) {
  const created = await command(core, "projects/create", `create-${name}`, {
    id,
    name,
    title: name,
    purpose: "",
    folders: [],
    tracking: { enabled: false, patterns: [], use_gitignore: false },
  }, {});
  return String(created["revision"]);
}

type Client = {
  // 받은 events frame의 event 전부(도착 순서).
  events: EventEnvelope[];
  frames: Json[];
  closed: Promise<number>;
  close(): void;
};

async function connect(
  core: Core,
  who: Who,
  subscribe: { types?: string[]; subjects?: string[] } = {},
): Promise<Client> {
  const socket = new WebSocket(
    `ws://127.0.0.1:${core.port}/v1/events/subscribe`,
    { headers: { authorization: `Bearer ${TOKENS[who]}` } },
  );
  const client: Client = {
    events: [],
    frames: [],
    closed: new Promise((resolve) => {
      socket.onclose = (event) => resolve(event.code);
    }),
    close: () => socket.close(),
  };
  socket.onmessage = (message) => {
    const frame = JSON.parse(String(message.data)) as Json;
    client.frames.push(frame);
    if (frame["type"] === "events") {
      client.events.push(...frame["events"] as EventEnvelope[]);
    }
  };
  const opened = await new Promise<boolean>((resolve) => {
    socket.onopen = () => resolve(true);
    socket.onerror = () => resolve(false);
  });
  assert(opened, "WebSocket이 열리지 않았다");
  socket.send(JSON.stringify({
    type: "subscribe",
    from_seq: "0",
    types: subscribe.types ?? [],
    subjects: subscribe.subjects ?? [],
  }));
  // 첫 replay frame이 오면 구독이 열린 것이다.
  await until(() => client.frames.length > 0, "첫 frame이 오지 않았다");
  return client;
}

async function until(test: () => boolean, message: string) {
  for (let waited = 0; waited < 200; waited++) {
    if (test()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

async function settle(ms = 600) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withCore(run: (core: Core) => Promise<void>): Promise<void> {
  const home = await Deno.makeTempDir({ prefix: "lophn-events-sub-" });
  const core = await startAt(home);
  try {
    await run(core);
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
}

function typesOf(events: readonly EventEnvelope[]): string[] {
  return events.map((event) => event.type);
}

Deno.test("platform/api#R5 platform/ledger#R15: WebSocket 구독자는 구독 뒤에 확정된 event를 순서대로 받는다", async () => {
  await withCore(async (core) => {
    const user = await connect(core, "user");
    assertEquals(user.events, []);
    const revision = await createProject(core, PROJECT, "alpha");
    await until(
      () => user.events.length >= 1,
      "구독 뒤 event가 오지 않았다",
    );
    assertEquals(typesOf(user.events), ["ProjectCreated"]);
    assertEquals(user.events[0].subject, PROJECT);
    // 두 번째 event도 같은 연결로 온다. 순번은 늘어난다.
    await command(core, "projects/archive", "archive-alpha", {
      project: PROJECT,
    }, { base_revision: revision });
    await until(
      () => user.events.length >= 2,
      "두 번째 event가 오지 않았다",
    );
    assertEquals(typesOf(user.events), ["ProjectCreated", "ProjectArchived"]);
    assert(BigInt(user.events[1].seq) > BigInt(user.events[0].seq));
    user.close();
    await user.closed;
  });
});

Deno.test("platform/api#R5: 닫힌 WebSocket 연결은 event를 더 받지 않고 session을 남기지 않는다", async () => {
  await withCore(async (core) => {
    assert(core.eventSessions && core.documentsFeed);
    await until(() => core.documentsFeed!.open, "core 안 구독이 열리지 않았다");
    const baseline = core.eventSessions();
    const first = await connect(core, "user");
    const second = await connect(core, "user");
    assertEquals(core.eventSessions(), baseline + 2);
    await createProject(core, PROJECT, "alpha");
    await until(() => first.events.length >= 1, "event가 오지 않았다");
    await until(() => second.events.length >= 1, "event가 오지 않았다");
    // 하나를 닫으면 그 session만 빠진다.
    first.close();
    await first.closed;
    await until(
      () => core.eventSessions!() === baseline + 1,
      "닫힌 연결의 session이 남았다",
    );
    const seen = first.events.length;
    const revision = await createProject(core, OTHER_PROJECT, "beta");
    await command(core, "projects/archive", "archive-beta", {
      project: OTHER_PROJECT,
    }, { base_revision: revision });
    await until(() => second.events.length >= 3, "남은 연결이 받지 못했다");
    assertEquals(first.events.length, seen);
    second.close();
    await second.closed;
    await until(
      () => core.eventSessions!() === baseline,
      "모든 연결을 닫았는데 session이 남았다",
    );
  });
});

Deno.test("platform/api#R5: WebSocket 연결 한도는 닫힌 연결의 자리를 돌려받는다", async () => {
  await withCore(async (core) => {
    const open: Client[] = [];
    for (let index = 0; index < 4; index++) {
      open.push(await connect(core, "user"));
    }
    // principal당 4개를 넘는 연결은 upgrade 전에 거절된다.
    const rejected = new WebSocket(
      `ws://127.0.0.1:${core.port}/v1/events/subscribe`,
      { headers: { authorization: `Bearer ${TOKENS.user}` } },
    );
    const opened = await new Promise<boolean>((resolve) => {
      rejected.onopen = () => resolve(true);
      rejected.onerror = () => resolve(false);
    });
    assertEquals(opened, false);
    open[0].close();
    await open[0].closed;
    // 자리가 돌아왔다. 닫힘 처리가 끝나기를 잠깐 기다린다.
    let again: Client | undefined;
    for (let attempt = 0; attempt < 40 && !again; attempt++) {
      try {
        again = await connect(core, "user");
      } catch {
        await settle(50);
      }
    }
    assert(again, "닫은 자리가 돌아오지 않았다");
    again.close();
    for (const client of open.slice(1)) client.close();
  });
});

Deno.test("platform/api#R5 platform/identity#R8: 범위 밖 event는 agent·app 구독자에 닿지 않는다", async () => {
  await withCore(async (core) => {
    const user = await connect(core, "user");
    const agent = await connect(core, "agent");
    const app = await connect(core, "app");
    const revision = await createProject(core, PROJECT, "alpha");
    await command(core, "projects/archive", "archive-alpha", {
      project: PROJECT,
    }, { base_revision: revision });
    await until(() => user.events.length >= 2, "사람 구독자가 받지 못했다");
    // 사람 전용 정책이라 agent·app에는 열리지 않는다. 연결은 살아 있고 event만 없다.
    await settle();
    assertEquals(agent.events, []);
    assertEquals(app.events, []);
    for (const frame of [...agent.frames, ...app.frames]) {
      assertEquals(frame["type"], "events");
      assertEquals(frame["events"], []);
    }
    for (const client of [user, agent, app]) client.close();
  });
});

Deno.test("platform/api#R5 platform/identity#R8: 볼 수 있는 subject는 걸러 주고 볼 수 없는 subject는 event 없는 subject와 같은 답이다", async () => {
  await withCore(async (core) => {
    await createProject(core, PROJECT, "alpha");
    const listed = (who: Who, subject: string) =>
      post(core, who, "events/list", { after_seq: "0", subjects: [subject] });
    // 사람은 자기가 볼 수 있는 subject의 event를 필터로 받는다.
    const seen = await listed("user", PROJECT);
    assertEquals(seen.status, 200, JSON.stringify(seen.body));
    assertEquals(typesOf(seen.body["events"] as EventEnvelope[]), [
      "ProjectCreated",
    ]);
    // event가 없는 subject는 빈 batch다.
    const none = await listed("user", OTHER_PROJECT);
    assertEquals(none.status, 200);
    assertEquals(none.body["events"], []);
    // agent·app은 같은 subject를 볼 수 없다. event가 있는 subject도 없는 subject와 같은 답이다.
    for (const who of ["agent", "app"] as const) {
      const hidden = await listed(who, PROJECT);
      const absent = await listed(who, OTHER_PROJECT);
      assertEquals(hidden.status, 200, who);
      assertEquals(hidden.body, absent.body, who);
      assertEquals(hidden.body["events"], [], who);
      assertEquals(hidden.status, none.status, who);
      assertEquals(hidden.body, none.body, who);
    }
    // 둘을 섞어도 볼 수 있는 쪽만 나온다. 존재를 가르는 거절은 없다.
    const mixed = await post(core, "user", "events/list", {
      after_seq: "0",
      subjects: [PROJECT, OTHER_PROJECT],
    });
    assertEquals(mixed.status, 200);
    assertEquals(typesOf(mixed.body["events"] as EventEnvelope[]), [
      "ProjectCreated",
    ]);
  });
});

Deno.test("platform/api#R5 platform/identity#R8: WebSocket subjects 필터는 같은 규칙으로 걸러 새 event만 받는다", async () => {
  await withCore(async (core) => {
    const user = await connect(core, "user", { subjects: [PROJECT] });
    const agent = await connect(core, "agent", { subjects: [PROJECT] });
    await createProject(core, OTHER_PROJECT, "beta");
    await createProject(core, PROJECT, "alpha");
    await until(
      () => user.events.length >= 1,
      "필터에 맞는 event가 오지 않았다",
    );
    await settle();
    // 다른 subject의 event는 오지 않고, 걸러낸 것도 진행 위치로는 지나간다.
    assertEquals(user.events.map((event) => event.subject), [PROJECT]);
    assertEquals(agent.events, []);
    const last = user.frames[user.frames.length - 1];
    assertEquals(last["scanned_through_seq"], user.events[0].seq);
    user.close();
    agent.close();
  });
});
