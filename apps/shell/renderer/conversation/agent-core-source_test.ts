// agent-I33b: Agent view의 core source. contractCore는 source가 보낸 입력·비교 기준이 route의 schema에 맞는지,
// fake의 응답이 실제 core가 낼 모양인지 검사한다. 실제 core 위의 흐름은 agent-core-source-real-core_test가 본다.
import { assert, assertEquals } from "@std/assert";

import { tableBlock } from "../../../../packages/contracts/lophn-agent/message-fixtures.ts";
import type { ThreadView } from "./agent-source.ts";
import {
  type AgentCoreDeps,
  coreAgentViewSourceFactory,
} from "./agent-core-source.ts";
import {
  APP,
  approval,
  assignment,
  at,
  HAIKU,
  id,
  listed,
  LOPHN,
  message,
  OPERATOR,
  PROJECT,
  PROVIDER,
  questionGroup,
  questionText,
  run,
  SESSION,
  session,
  SESSION_OTHER,
  SONNET,
  toolCall,
  WORK_PLACE,
} from "../testdata/agent-core-fixtures.ts";
import {
  type ContractCore,
  contractCore,
  fail,
  type Handlers,
  META,
  ok,
} from "../testdata/contract-core.ts";

const CHECKED = [
  "read:assignments/read",
  "read:agents/list",
  "read:sessions/list",
  "read:sessions/read",
  "read:messages/list",
  "read:messages/body",
  "read:runs/list",
  "read:runs/read",
  "read:questions/list",
  "read:questions/read",
  "read:questions/text",
  "read:approvals/get",
  "read:approvals/text",
  "command:sessions/open",
  "command:sessions/rename",
  "command:sessions/archive",
  "command:sessions/unarchive",
  "command:sessions/delete",
  "command:sessions/fork",
  "command:sessions/request-compact",
  "command:sessions/change-model",
  "command:messages/receive",
  "command:runs/stop",
  "command:questions/answer",
  "command:questions/defer",
  "command:model-favorites/change",
];

const AGENT_ROW = {
  assignment: LOPHN,
  role: "lophn",
  kind: "built_in",
  name: "lophn",
  profile: { kind: "icon", icon: "search" },
  model: null,
  state: "enabled",
  issues: [],
  counts: { contexts: null, skills: 0, mcp: 0 },
};

const SOURCED = { layer: "default", place: null };

function agentRead(tools: string[] = ["document.list"]) {
  return {
    assignment: LOPHN,
    role: "lophn",
    kind: "built_in",
    place: WORK_PLACE,
    definition: null,
    hash: null,
    effective: {
      name: { value: "lophn", source: SOURCED },
      profile: { value: { kind: "icon", icon: "search" }, source: SOURCED },
      model: { value: SONNET, source: { layer: "workspace", place: null } },
      permissions: { value: { tools }, source: SOURCED },
    },
    issues: [],
    ...META,
  };
}

const CATALOG = {
  state: {
    auto_update: true,
    etag: null,
    last_checked_at: null,
    last_received_at: null,
    last_failure: null,
    snapshot_hash: "a".repeat(64),
  },
  entries: [
    {
      provider_definition: "anthropic",
      model_name: "Sonnet 5.5",
      options: [{
        id: "effort",
        label: "Effort",
        values: [
          { value: "low", label: "Low", wire: null },
          { value: "medium", label: "Medium", wire: null },
          { value: "high", label: "High", wire: null },
        ],
        default_value: "medium",
        budget: null,
      }],
    },
    {
      provider_definition: "anthropic",
      model_name: "Haiku 5.5",
      options: [],
    },
  ],
  ...META,
};

const PROVIDERS = {
  providers: [{
    id: PROVIDER,
    name: "Anthropic",
    definition: { key: "anthropic" },
    credential: { state: "available" },
  }],
  ...META,
};

/** 한 프로젝트의 lophn 하나, 세션 둘. test가 필요한 route만 덮어쓴다. */
function world(over: Handlers = {}): Handlers {
  return {
    "read:assignments/read": () => ok({ assignment: assignment(), ...META }),
    "read:agents/list": () => ok({ agents: [AGENT_ROW], ...META }),
    "read:agents/read": () => ok(agentRead()),
    "read:projects/get": () =>
      ok({
        project: { id: PROJECT, name: "weekly", title: "Weekly" },
        ...META,
      }),
    "read:sessions/list": () =>
      ok(listed("sessions", [session(1), session(2, { archived: true })])),
    "read:sessions/read": (body) =>
      ok({
        session: session(body.session === SESSION ? 1 : 2),
        ...META,
      }),
    "read:runs/list": () => ok(listed("runs", [])),
    "read:events/list": () =>
      ok({ events: [], scanned_through_seq: "100", head_seq: "100", ...META }),
    ...over,
  };
}

const DEPS: AgentCoreDeps = {
  now: () => Date.parse("2026-10-06T09:00:00.000Z"),
  wait: () => Promise.resolve(),
  openConfirmation: undefined,
  confirmWithoutWindow: undefined,
};

const live: ContractCore[] = [];

/** 각 test가 끝나면 그 안에서 만든 fake core의 입력·응답이 contract에 맞았는지 확인한다. */
function test(name: string, run: () => void | Promise<void>): void {
  Deno.test(name, async () => {
    live.length = 0;
    await run();
    for (const harness of live) harness.verify();
  });
}

function sourceOf(
  handlers: Handlers,
  place: { kind: "global" | "project" | "app"; id: string } = {
    kind: "project",
    id: PROJECT,
  },
  deps: AgentCoreDeps = DEPS,
  assignmentId: string = LOPHN,
) {
  const harness = contractCore(handlers, CHECKED);
  live.push(harness);
  const source = coreAgentViewSourceFactory(harness.core, deps)({
    assignment: assignmentId,
    place,
  });
  return { ...harness, source };
}

const routesOf = (
  calls: readonly { kind: string; resource: string; method: string }[],
) => calls.map((call) => `${call.kind}:${call.resource}/${call.method}`);

function eventsFor(
  rows: readonly { subject: string; seq: string; at: string }[],
) {
  return (body: { after_seq: string; subjects?: string[] }) =>
    ok({
      events: rows.filter((row) =>
        BigInt(row.seq) > BigInt(body.after_seq) &&
        (body.subjects === undefined || body.subjects.includes(row.subject))
      ).map((row) => ({
        seq: row.seq,
        type: "MessageReceived",
        subject: row.subject,
        actor: "user",
        run: null,
        payload: {},
        at: row.at,
      })),
      scanned_through_seq: "100",
      head_seq: "100",
      ...META,
    });
}

// ---------------------------------------------------------------- agent

test("shell/desktop#R38 shell/desktop#R43 [agent-I33b]: agent는 담당·정의 목록·자리·권한 규칙을 읽어 이름·얼굴·자리 이름·권한 요약으로 옮긴다", async () => {
  const w = sourceOf(world());
  const face = await w.source.agent();
  assertEquals(face, {
    ok: true,
    value: {
      assignment: LOPHN,
      name: "lophn",
      profile: { kind: "icon", icon: "search" },
      role: "lophn",
      state: "enabled",
      place: { kind: "project", name: "Weekly" },
      permissionSummary: "Ask first, 1 tool allowed",
    },
  });
  const agents = w.calls.find((call) => call.resource === "agents")!;
  assertEquals(agents.body, { place: WORK_PLACE });
  w.verify();
});

test("shell/desktop#R43 [agent-I33b]: 허락한 tool이 없으면 요약은 Ask first뿐이고 앱 자리는 app을 읽어 앱 이름을 쓴다", async () => {
  const w = sourceOf(
    world({
      "read:agents/read": () => ok(agentRead([])),
      "read:apps/get": () =>
        ok({ app: { id: APP, name: "Expenses" }, ...META }),
    }),
    { kind: "app", id: APP },
  );
  const face = await w.source.agent();
  assert(face.ok);
  assertEquals(face.value.permissionSummary, "Ask first");
  assertEquals(face.value.place, { kind: "app", name: "Expenses" });
  const place = { kind: "app", id: APP };
  assertEquals(
    w.calls.find((call) =>
      call.resource === "agents" && call.method === "list"
    )!
      .body,
    { place },
  );
  w.verify();
});

test("lophn-agent/assignments#R5 shell/desktop#R38 [agent-I33b]: 회수된 담당은 withdrawn으로, 없는 담당은 not_found로 알리고 이미지 profile은 이름 이니셜로 그린다", async () => {
  const withdrawn = sourceOf(world({
    "read:assignments/read": () =>
      ok({ assignment: assignment({ state: "withdrawn" }), ...META }),
    "read:agents/list": () =>
      ok({
        agents: [{
          ...AGENT_ROW,
          profile: { kind: "image", image: "avatar.png" },
        }],
        ...META,
      }),
  }));
  const face = await withdrawn.source.agent();
  assert(face.ok);
  assertEquals(face.value.state, "withdrawn");
  assertEquals(face.value.profile, { kind: "initial", text: "l" });

  const gone = sourceOf(world({
    "read:assignments/read": () => fail("not_found"),
  }));
  assertEquals(await gone.source.agent(), { ok: false, code: "not_found" });
});

test("shell/desktop#R38 [agent-I33b]: 전역 자리에서는 정의 목록을 자리 없이 읽지 않고 built-in 이름을 쓰며 자리 이름은 비어 있다", async () => {
  const w = sourceOf(
    world(),
    { kind: "global", id: "" },
  );
  const face = await w.source.agent();
  assert(face.ok);
  assertEquals(face.value.name, "lophn");
  assertEquals(face.value.place, { kind: "project", name: "" });
  assertEquals(routesOf(w.calls), ["read:assignments/read"]);
});

test("shell/desktop#R38 [agent-I33b]: Operator는 정의 목록의 이름과 얼굴을 쓴다", async () => {
  const w = sourceOf(
    world({
      "read:assignments/read": () =>
        ok({
          assignment: assignment({
            id: OPERATOR,
            role: "operator",
            scope: { kind: "project", id: PROJECT },
          }),
          ...META,
        }),
      "read:agents/list": () =>
        ok({
          agents: [{
            ...AGENT_ROW,
            assignment: OPERATOR,
            role: "operator",
            kind: "operator",
            name: "Release notes",
            profile: { kind: "icon", icon: "edit" },
            counts: { contexts: 1, skills: 0, mcp: 0 },
          }],
          ...META,
        }),
    }),
    undefined,
    undefined,
    OPERATOR,
  );
  const face = await w.source.agent();
  assert(face.ok);
  assertEquals(
    [face.value.name, face.value.role, face.value.profile],
    ["Release notes", "operator", { kind: "icon", icon: "edit" }],
  );
});

// ---------------------------------------------------------------- sessions

test("lophn-agent/conversation#R21 shell/desktop#R39 [agent-I33b]: session 목록은 그 담당·자리의 archived까지 읽고 마지막 run의 상태와 시각을 줄에 싣는다", async () => {
  const w = sourceOf(world({
    "read:runs/list": () =>
      ok(listed("runs", [
        run(1, {
          state: "finished",
          session: SESSION_OTHER,
          finished_at: at(-3600),
        }),
        run(2, {
          state: "waiting_user",
          waiting_on: id("qgr", 1),
          started_at: at(-60),
          accepted_seq: "60",
          state_seq: "62",
        }),
      ])),
    "read:events/list": eventsFor([
      { subject: SESSION_OTHER, seq: "20", at: at(-7200) },
    ]),
  }));
  // run 2는 SESSION에 붙어 있다. run 1은 다른 session이다.
  const listedSessions = await w.source.sessions();
  assertEquals(listedSessions, {
    ok: true,
    value: [
      {
        id: SESSION,
        assignment: LOPHN,
        title: null,
        status: "waiting",
        activeAt: at(-60),
        archived: false,
        closed: false,
      },
      {
        id: SESSION_OTHER,
        assignment: LOPHN,
        title: null,
        status: "idle",
        activeAt: at(-3600),
        archived: true,
        closed: false,
      },
    ],
  });
  const list = w.calls.find((call) => call.resource === "sessions")!;
  assertEquals(list.body, {
    assignment: LOPHN,
    work_place: WORK_PLACE,
    archived: "include",
  });
  w.verify();
});

test("lophn-agent/conversation#R21 [agent-I33b]: run이 없는 session의 시각은 그 session의 마지막 변경 event 시각이고 닫힌 session은 closed다", async () => {
  const w = sourceOf(world({
    "read:sessions/list": () =>
      ok(listed("sessions", [
        session(1, {
          title: "Week 41",
          state: "closed",
          closed_reason: "assignment_withdrawn",
          closed_at: at(-100),
          state_seq: "12",
        }),
      ])),
    "read:events/list": eventsFor([
      { subject: SESSION, seq: "12", at: at(-100) },
    ]),
  }));
  const listedSessions = await w.source.sessions();
  assert(listedSessions.ok);
  assertEquals(listedSessions.value[0]!.title, "Week 41");
  assertEquals(listedSessions.value[0]!.closed, true);
  assertEquals(listedSessions.value[0]!.activeAt, at(-100));
  w.verify();
});

test("lophn-agent/conversation#R16 [agent-I33b]: 전역 자리에는 session이 없어 core에 묻지 않고, 열기도 거절한다", async () => {
  const w = sourceOf(world(), { kind: "global", id: "" });
  assertEquals(await w.source.sessions(), { ok: true, value: [] });
  assertEquals(
    await w.source.openSession({ id: id("ses", 9), contexts: [] }),
    { ok: false, code: "invalid_input" },
  );
  assertEquals(w.calls.length, 0);
});

test("lophn-agent/conversation#R1 lophn-agent/conversation#R16 [agent-I33b]: session 열기는 그 담당의 revision과 상태, 이 자리를 싣고 같은 id면 같은 key다", async () => {
  const opened = session(9, { state_seq: "90" });
  const w = sourceOf(world({
    "command:sessions/open": () =>
      ok({
        id: opened.id,
        state: "open",
        work_place: WORK_PLACE,
        state_seq: "90",
      }),
  }));
  const result = await w.source.openSession({
    id: opened.id as string,
    contexts: [],
  });
  assertEquals(result, { ok: true, value: undefined });
  const call = w.calls.find((c) => c.method === "open")!;
  const body = call.body as Record<string, unknown>;
  assertEquals(body.input, {
    id: opened.id,
    assignment: LOPHN,
    work_place: WORK_PLACE,
    opening_context: null,
  });
  assertEquals(body.compare, {
    assignment_revision: 3,
    assignment_state: "enabled",
  });
  assertEquals(body.idempotency_key, `sessions-open-${opened.id}`);
  w.verify();
});

test("lophn-agent/conversation#R8 [agent-I33b]: 멈춘 담당은 새 session도 새 입력도 받지 않아 core의 비교 기준(enabled)을 어기는 command를 보내지 않고 conflict로 거절한다", async () => {
  const w = sourceOf(world({
    "read:assignments/read": () =>
      ok({
        assignment: assignment({
          state: "paused",
          pause_reason: {
            kind: "scope_archived",
            detail: "archived",
            target: PROJECT,
          },
        }),
        ...META,
      }),
  }));
  assertEquals(
    await w.source.openSession({ id: id("ses", 9), contexts: [] }),
    { ok: false, code: "conflict" },
  );
  assertEquals(
    await w.source.send({
      session: SESSION,
      id: id("msg", 6),
      key: "k",
      text: "x",
      mode: "request",
      run: null,
    }),
    { ok: false, code: "conflict" },
  );
  assertEquals(w.calls.filter((call) => call.kind === "command").length, 0);
});

test("lophn-agent/conversation#R18 lophn-agent/conversation#R20 [agent-I33b]: rename·archive·unarchive·delete는 읽은 state_seq를 비교 기준으로 보낸다", async () => {
  const w = sourceOf(world({
    "command:sessions/rename": () =>
      ok({ id: SESSION, title: "Week 41", state_seq: "11" }),
    "command:sessions/archive": () =>
      ok({ id: SESSION, archived: true, state_seq: "12" }),
    "command:sessions/unarchive": () =>
      ok({ id: SESSION, archived: false, state_seq: "13" }),
    "command:sessions/delete": () => ok({ id: SESSION, deleted_at: at(0) }),
  }));
  const ok1 = { ok: true, value: undefined } as const;
  assertEquals(await w.source.renameSession(SESSION, "Week 41"), ok1);
  assertEquals(await w.source.archiveSession(SESSION), ok1);
  assertEquals(await w.source.unarchiveSession(SESSION), ok1);
  assertEquals(await w.source.deleteSession(SESSION), ok1);
  const commands = w.calls.filter((call) => call.kind === "command");
  assertEquals(
    commands.map((call) => [
      call.method,
      (call.body as Record<string, unknown>).input,
      (call.body as Record<string, unknown>).compare,
    ]),
    [
      ["rename", { session: SESSION, title: "Week 41" }, { state_seq: "10" }],
      ["archive", { session: SESSION }, { state_seq: "10" }],
      ["unarchive", { session: SESSION }, { state_seq: "10" }],
      ["delete", { session: SESSION }, { state_seq: "10" }],
    ],
  );
  w.verify();
});

test("lophn-agent/conversation#R20 [agent-I33b]: 진행 중 run이 있는 session 지우기는 conflict로, 없는 session은 not_found로 알린다", async () => {
  const conflict = sourceOf(world({
    "command:sessions/delete": () => fail("conflict"),
  }));
  assertEquals(await conflict.source.deleteSession(SESSION), {
    ok: false,
    code: "conflict",
  });
  const missing = sourceOf(world({
    "read:sessions/read": () => fail("not_found"),
  }));
  assertEquals(await missing.source.archiveSession(SESSION), {
    ok: false,
    code: "not_found",
  });
  assertEquals(
    missing.calls.filter((call) => call.kind === "command").length,
    0,
  );
});

test("lophn-agent/conversation#R9 [agent-I33b]: Fork는 고른 메시지의 seq까지, 지점이 없으면 마지막 확정 메시지까지 복사하도록 새 id로 보낸다", async () => {
  const messages = [
    message(1, {}, 21),
    message(2, { actor: `agent:${LOPHN}` }, 23),
    message(3, {}, 30),
  ];
  const newSession = session(9);
  const w = sourceOf(world({
    "read:messages/list": () => ok({ messages, ...META }),
    "command:sessions/fork": (body) =>
      ok({
        id: body.id,
        state: "open",
        forked_from: { session: SESSION, through_seq: body.through_seq },
        copied_messages: 2,
        state_seq: "95",
      }),
  }));
  assertEquals(
    await w.source.forkSession({
      id: newSession.id as string,
      session: SESSION,
      through: id("msg", 2),
    }),
    { ok: true, value: undefined },
  );
  assertEquals(
    await w.source.forkSession({
      id: id("ses", 10),
      session: SESSION,
      through: null,
    }),
    { ok: true, value: undefined },
  );
  const forks = w.calls.filter((call) => call.method === "fork").map((call) =>
    (call.body as { input: unknown }).input
  );
  assertEquals(forks, [
    { id: newSession.id, source: SESSION, through_seq: "23" },
    { id: id("ses", 10), source: SESSION, through_seq: "30" },
  ]);
  w.verify();
});

test("lophn-agent/conversation#R9 [agent-I33b]: 복사할 메시지가 없거나 지점이 이 session에 없으면 core를 부르지 않고 invalid_input이다", async () => {
  const w = sourceOf(world({
    "read:messages/list": () => ok({ messages: [], ...META }),
  }));
  assertEquals(
    await w.source.forkSession({
      id: id("ses", 9),
      session: SESSION,
      through: null,
    }),
    { ok: false, code: "invalid_input" },
  );
  assertEquals(
    await w.source.forkSession({
      id: id("ses", 9),
      session: SESSION,
      through: id("msg", 1),
    }),
    { ok: false, code: "invalid_input" },
  );
  assertEquals(w.calls.filter((call) => call.kind === "command").length, 0);
});

test("lophn-agent/conversation#R10 [agent-I33b]: Compact는 열린 session의 state_seq로 요약을 요청한다", async () => {
  const w = sourceOf(world({
    "command:sessions/request-compact": () =>
      ok({ id: SESSION, request_seq: "101" }),
  }));
  assertEquals(await w.source.compactSession(SESSION), {
    ok: true,
    value: undefined,
  });
  const body = w.calls.find((call) => call.method === "request-compact")!
    .body as Record<string, unknown>;
  assertEquals(body.input, { session: SESSION });
  assertEquals(body.compare, { state: "open", state_seq: "10" });
  w.verify();
});

// ---------------------------------------------------------------- send and stop

test("lophn-agent/conversation#R2 lophn-agent/conversation#R3 [agent-I33b]: 보내기는 글을 본문 값으로, 읽은 session·담당 상태를 비교 기준으로 싣고 호출자의 key를 그대로 쓴다", async () => {
  const sent = message(5, {}, 61);
  const w = sourceOf(world({
    "command:messages/receive": () => ok(sent),
  }));
  const result = await w.source.send({
    session: SESSION,
    id: id("msg", 5),
    key: "messages-receive-msg5",
    text: "Plan the week\n회의 정리 😀",
    mode: "request",
    run: null,
  });
  assertEquals(result, { ok: true, value: undefined });
  const body = w.calls.find((call) => call.method === "receive")!
    .body as Record<string, unknown>;
  assertEquals(body.input, {
    id: id("msg", 5),
    session: SESSION,
    content: {
      schema_version: 1,
      parts: [{ kind: "text", text: "Plan the week\n회의 정리 😀" }],
    },
    mode: "request",
  });
  assertEquals(body.compare, {
    session_state: "open",
    session_state_seq: "10",
    assignment_revision: 3,
    assignment_state: "enabled",
  });
  assertEquals(body.idempotency_key, "messages-receive-msg5");
  w.verify();
});

test("lophn-agent/conversation#R3 [agent-I33b]: 진행 중 수정은 목표 run을 싣고, 거절 code(conflict)와 읽지 못한 session의 code는 그대로 돌려준다", async () => {
  const w = sourceOf(world({
    "command:messages/receive": () => fail("conflict"),
  }));
  const refused = await w.source.send({
    session: SESSION,
    id: id("msg", 6),
    key: "k",
    text: "Use Q3 numbers",
    mode: "correction",
    run: id("run", 1),
  });
  assertEquals(refused, { ok: false, code: "conflict" });
  const input = (w.calls.find((call) => call.method === "receive")!
    .body as { input: Record<string, unknown> }).input;
  assertEquals([input.mode, input.run], ["correction", id("run", 1)]);

  const down = sourceOf(world({
    "read:sessions/read": () => fail("unavailable"),
  }));
  assertEquals(
    await down.source.send({
      session: SESSION,
      id: id("msg", 6),
      key: "k",
      text: "x",
      mode: "request",
      run: null,
    }),
    { ok: false, code: "unavailable" },
  );
  assertEquals(
    down.calls.filter((call) => call.kind === "command").length,
    0,
  );
});

test("lophn-agent/conversation#R3 [agent-I33b]: core 통로가 끊겨 던지면 결과를 모르는 unavailable로 알린다", async () => {
  const source = coreAgentViewSourceFactory({
    subscribe: () => () => {},
    call: () => Promise.reject(new Error("socket closed")),
  }, DEPS)({ assignment: LOPHN, place: { kind: "project", id: PROJECT } });
  assertEquals(
    await source.send({
      session: SESSION,
      id: id("msg", 6),
      key: "k",
      text: "x",
      mode: "request",
      run: null,
    }),
    { ok: false, code: "unavailable" },
  );
});

test("lophn-agent/harness/run-loop shell/desktop#R42 [agent-I33b]: Stop은 run의 state_seq를 비교 기준으로 user_stopped로 멈춘다", async () => {
  const w = sourceOf(world({
    "read:runs/read": () => ok({ run: run(1, { state_seq: "44" }), ...META }),
    "command:runs/stop": () =>
      ok({
        id: id("run", 1),
        state: "finished",
        state_seq: "45",
        outcome: { kind: "stopped", reason: "user_stopped" },
        result: "c".repeat(64),
        finished_at: at(5),
        replayed: false,
      }),
  }));
  assertEquals(await w.source.stop(id("run", 1), "stop-1"), {
    ok: true,
    value: undefined,
  });
  const body = w.calls.find((call) => call.method === "stop")!
    .body as Record<string, unknown>;
  assertEquals(body.input, {
    run: id("run", 1),
    request_key: "stop-1",
    reason: "user_stopped",
  });
  assertEquals(body.compare, { state_seq: "44" });
  assertEquals(body.idempotency_key, "stop-1");
  w.verify();
});

// ---------------------------------------------------------------- body and titles

test("lophn-agent/conversation#R4 shell/workspace#R12 [agent-I33b]: 본문은 글 part와 시각 block을 그대로 옮기고 문서 제목은 document.get의 제목이다", async () => {
  const block = tableBlock;
  const w = sourceOf(world({
    "read:messages/body": () =>
      ok({
        message: id("msg", 2),
        session: SESSION,
        body: "a".repeat(64),
        size_bytes: 10,
        content: {
          schema_version: 1,
          parts: [{ kind: "text", text: "Done" }, { kind: "visual", block }],
        },
        ...META,
      }),
    "read:documents/get": () =>
      ok({ document: { id: id("doc", 1), title: "Weekly report" }, ...META }),
  }));
  assertEquals(await w.source.body(id("msg", 2)), {
    ok: true,
    value: [{ kind: "text", text: "Done" }, { kind: "visual", block }],
  });
  assertEquals(await w.source.documentTitle(id("doc", 1)), {
    ok: true,
    value: "Weekly report",
  });
  const missing = sourceOf(world({
    "read:messages/body": () => fail("not_found"),
  }));
  assertEquals(await missing.source.body(id("msg", 2)), {
    ok: false,
    code: "not_found",
  });
});

// ---------------------------------------------------------------- thread

const DOC = id("doc", 1);
const VER1 = id("ver", 1);
const VER2 = id("ver", 2);

function finishedThreadWorld(): Handlers {
  const user = message(1, { applied_at_call: id("mcl", 1) }, 21);
  const agent = message(2, {
    actor: `agent:${LOPHN}`,
    links: [
      { kind: "version", document: DOC, version: VER2 },
      { kind: "tool_call", call: id("tcl", 1) },
    ],
  }, 23);
  return world({
    "read:messages/list": () => ok({ messages: [user, agent], ...META }),
    "read:runs/list": () =>
      ok(listed("runs", [
        run(1, {
          state: "finished",
          accepted_seq: "21",
          state_seq: "25",
          elapsed: { active_ms: 18000, stall_ms: 0, checkpoint_at: at(18) },
        }),
      ])),
    "read:questions/list": () => ok(listed("groups", [])),
    "read:tool-calls/list": () =>
      ok({
        tool_calls: [
          toolCall(1, "document.read_version"),
          toolCall(2, "document.read_section"),
          toolCall(3, "web.search", {
            outcome: { kind: "failure", code: "unavailable" },
            output: null,
          }),
          toolCall(4, "web.search", { attempt: 1, retry_of: id("tcl", 3) }),
        ],
        ...META,
      }),
    "read:events/list": eventsFor([
      { subject: id("msg", 1), seq: "21", at: at(0) },
      { subject: id("msg", 2), seq: "23", at: at(17) },
    ]),
    "read:documents/get": () =>
      ok({
        document: {
          id: DOC,
          title: "Weekly report",
          name: "weekly-report",
          place: null,
          latest_version: VER2,
        },
        version: { id: VER2, document: DOC, number: 2 },
        ...META,
      }),
    "read:documents/history": () =>
      ok({
        document: DOC,
        versions: [
          { id: VER1, document: DOC, number: 1 },
          { id: VER2, document: DOC, number: 2 },
        ],
        complete: true,
        ...META,
      }),
    "worker:documents/diff": () =>
      ok({
        document: DOC,
        additions: [
          { range: { start_line: 1, end_line: 2 }, text: "a\nb" },
          { range: { start_line: 7, end_line: 7 }, text: "c" },
        ],
        deletions: [{ range: { start_line: 5, end_line: 5 }, text: "d" }],
        omissions: [],
        complete: true,
        ...META,
      }),
  });
}

test("shell/desktop#R40 shell/desktop#R41 [agent-I33b]: thread는 메시지·tool 줄·편집 카드·Worked for를 seq 순서로 잇고 재시도한 호출은 마지막 시도 하나만 보인다", async () => {
  const w = sourceOf(finishedThreadWorld());
  const read = await w.source.thread(SESSION);
  assert(read.ok);
  const thread: ThreadView = read.value;
  assertEquals(thread.entries, [
    {
      kind: "message",
      id: id("msg", 1),
      at: at(0),
      actor: "user",
      run: { id: id("run", 1), ended: true },
      mode: "request",
      applied: true,
      results: [],
    },
    {
      kind: "tools",
      id: id("tcl", 1),
      at: at(1),
      tool: {
        id: id("tcl", 1),
        label: "Read 2 documents",
        lines: ["document.read_version", "document.read_section"],
      },
    },
    {
      kind: "tools",
      id: id("tcl", 4),
      at: at(4),
      tool: {
        id: id("tcl", 4),
        label: "Used web.search",
        lines: ["web.search"],
      },
    },
    {
      kind: "message",
      id: id("msg", 2),
      at: at(17),
      actor: "agent",
      run: { id: id("run", 1), ended: true },
      mode: null,
      applied: false,
      results: [{ kind: "version", document: DOC, version: VER2 }],
    },
    {
      kind: "edit",
      id: VER2,
      at: at(17),
      edit: {
        id: VER2,
        document: DOC,
        path: "weekly-report",
        added: 3,
        removed: 1,
      },
      undone: false,
      canRedo: false,
    },
    {
      kind: "run-end",
      id: `end-${id("run", 1)}`,
      at: at(18),
      outcome: "completed",
      durationMs: 18000,
    },
  ]);
  assertEquals(thread.run, { id: id("run", 1), phase: "ended" });
  assertEquals(thread.tasks, []);
  assertEquals(thread.approval, null);
  // 편집 카드의 줄 수는 앞 판과 뒤 판을 비교한 diff다.
  const diff = w.calls.find((call) =>
    call.resource === "documents" && call.method === "diff"
  )!;
  assertEquals(diff.body, {
    document: DOC,
    before: VER1,
    after: VER2,
    section: null,
  });
  w.verify();
});

test("shell/desktop#R41 [agent-I33b]: 끝난 run의 tool·편집 줄은 다시 읽지 않고 다음 poll에서 기억한 값을 쓴다", async () => {
  const w = sourceOf(finishedThreadWorld());
  await w.source.thread(SESSION);
  const first =
    w.calls.filter((call) =>
      call.resource === "tool-calls" || call.method === "diff"
    ).length;
  assertEquals(first, 2);
  const again = await w.source.thread(SESSION);
  assert(again.ok);
  assertEquals(again.value.entries.length, 6);
  const total =
    w.calls.filter((call) =>
      call.resource === "tool-calls" || call.method === "diff"
    ).length;
  assertEquals(total, 2);
});

test("shell/desktop#R41 [agent-I33b]: 처음 만든 문서의 편집 카드는 본문 줄 수를 더한 줄로 세고 멈춘 run은 stopped로 끝난다", async () => {
  const user = message(1, {}, 21);
  const agent = message(2, {
    actor: `agent:${LOPHN}`,
    links: [{ kind: "version", document: DOC, version: VER1 }],
  }, 23);
  const w = sourceOf(world({
    "read:messages/list": () => ok({ messages: [user, agent], ...META }),
    "read:runs/list": () =>
      ok(listed("runs", [run(1, {
        state: "finished",
        outcome: { kind: "stopped", reason: "user_stopped" },
        accepted_seq: "21",
        state_seq: "25",
        elapsed: { active_ms: 4000, stall_ms: 0, checkpoint_at: at(4) },
      })])),
    "read:questions/list": () => ok(listed("groups", [])),
    "read:tool-calls/list": () => ok({ tool_calls: [], ...META }),
    "read:events/list": eventsFor([
      { subject: id("msg", 1), seq: "21", at: at(0) },
      { subject: id("msg", 2), seq: "23", at: at(3) },
    ]),
    "read:documents/get": () =>
      ok({
        document: { id: DOC, title: "Notes", name: null, place: null },
        version: { id: VER1, document: DOC, number: 1 },
        ...META,
      }),
    "worker:documents/read": () =>
      ok({ text: "one\ntwo\nthree\n", complete: true, next_cursor: null }),
  }));
  const read = await w.source.thread(SESSION);
  assert(read.ok);
  const kinds = read.value.entries.map((entry) => entry.kind);
  assertEquals(kinds, ["message", "message", "edit", "run-end"]);
  const edit = read.value.entries[2]!;
  assert(edit.kind === "edit");
  assertEquals(
    [edit.edit.path, edit.edit.added, edit.edit.removed],
    ["Notes", 3, 0],
  );
  const end = read.value.entries[3]!;
  assert(end.kind === "run-end");
  assertEquals([end.outcome, end.durationMs], ["stopped", 4000]);
  assertEquals(
    w.calls.find((call) =>
      call.resource === "documents" && call.method === "read"
    )!
      .body,
    { reference: { document: DOC, version: VER1, section: null } },
  );
});

test("shell/desktop#R41 [agent-I33b]: 편집 내용을 읽지 못하면 그 카드만 그리지 않는다(trace에 없는 줄은 없다)", async () => {
  const handlers = finishedThreadWorld();
  const w = sourceOf({
    ...handlers,
    "worker:documents/diff": () => fail("unavailable"),
  });
  const read = await w.source.thread(SESSION);
  assert(read.ok);
  assertEquals(
    read.value.entries.map((entry) => entry.kind),
    ["message", "tools", "tools", "message", "run-end"],
  );
});

test("lophn-agent/conversation#R3 shell/desktop#R42 [agent-I33b]: 일하는 중인 run은 working이고 가장 늦게 접수된 run이 지금 일이며 Worked for는 끝난 run에만 붙는다", async () => {
  const user = message(1, {}, 21);
  const w = sourceOf(world({
    "read:messages/list": () => ok({ messages: [user], ...META }),
    "read:runs/list": () =>
      ok(listed("runs", [
        run(1, { state: "finished", accepted_seq: "21", state_seq: "25" }),
        run(2, { state: "running", accepted_seq: "40", state_seq: "41" }),
      ])),
    "read:questions/list": () => ok(listed("groups", [])),
    "read:tool-calls/list": () => ok({ tool_calls: [], ...META }),
    "read:events/list": eventsFor([
      { subject: id("msg", 1), seq: "21", at: at(0) },
    ]),
  }));
  const read = await w.source.thread(SESSION);
  assert(read.ok);
  assertEquals(read.value.run, { id: id("run", 2), phase: "working" });
  assertEquals(
    read.value.entries.filter((entry) => entry.kind === "run-end").length,
    1,
  );
  const message1 = read.value.entries[0]!;
  assert(message1.kind === "message");
  assertEquals(message1.run, { id: id("run", 1), ended: true });
});

test("lophn-agent/questions#R17 shell/desktop#R46 [agent-I33b]: 질문 묶음은 글을 읽어 카드 값으로 옮기고 답을 기다리는 카드는 answered가 null이다", async () => {
  const user = message(1, {}, 21);
  const w = sourceOf(world({
    "read:messages/list": () => ok({ messages: [user], ...META }),
    "read:runs/list": () =>
      ok(listed("runs", [run(1, {
        state: "waiting_user",
        waiting_on: id("qgr", 1),
        accepted_seq: "21",
        state_seq: "45",
      })])),
    "read:questions/list": () =>
      ok(listed("groups", [questionGroup(1, { expires_at: at(3600) })])),
    "read:questions/text": () => ok(questionText(1)),
    "read:tool-calls/list": () => ok({ tool_calls: [], ...META }),
    "read:events/list": eventsFor([
      { subject: id("msg", 1), seq: "21", at: at(0) },
      { subject: id("qgr", 1), seq: "41", at: at(10) },
    ]),
  }));
  const read = await w.source.thread(SESSION);
  assert(read.ok);
  assertEquals(read.value.run, { id: id("run", 1), phase: "waiting" });
  assertEquals(read.value.approval, null);
  assertEquals(read.value.entries[1], {
    kind: "questions",
    id: id("qgr", 1),
    at: at(10),
    group: {
      id: id("qgr", 1),
      agentName: "lophn",
      expires_at: at(3600),
      questions: [{
        id: id("qst", 1),
        prompt: "How often should the report run?",
        reason: "The schedule decides when it is written.",
        options: [
          { key: "weekly", label: "Weekly", description: "Every Monday" },
          { key: "daily", label: "Daily", description: "Every morning" },
        ],
        recommendation: {
          option_key: "weekly",
          explanation: "Matches the team.",
        },
      }],
    },
    answered: null,
  });
  w.verify();
});

test("lophn-agent/questions#R10 shell/desktop#R46 [agent-I33b]: 답한 묶음은 질문별 답을, 미룬 묶음은 skipped를, 기한이 지난 묶음은 expired를, 적용된 고정 action은 applied를 요약으로 남긴다", async () => {
  const answeredGroup = questionGroup(1, {
    status: "answered",
    closed_seq: "50",
  }, {
    answer: { kind: "option", option_key: "weekly", text_blob: null },
  });
  const textGroup = questionGroup(2, {
    status: "answered",
    closed_seq: "51",
  }, {
    answer: { kind: "text", option_key: null, text_blob: "9".repeat(64) },
  });
  const deferred = questionGroup(3, {
    status: "cancelled",
    closed_reason: "deferred",
    closed_seq: "52",
  });
  const expired = questionGroup(4, {
    status: "expired",
    closed_reason: "expired",
    closed_seq: "53",
  });
  const cancelled = questionGroup(5, {
    status: "cancelled",
    closed_reason: "cancelled",
    closed_reason_blob: "9".repeat(64),
    closed_seq: "54",
  });
  const applied = questionGroup(6, {
    status: "answered",
    closed_seq: "55",
  }, {
    options: [{
      key: "create",
      label: "Create",
      evidence: [],
      adoption: null,
      action: {
        concern: "apps",
        command: "app.create",
        targets: [APP],
        input: { kind: "inline", value: {} },
        input_hash: "6".repeat(64),
        comparison: {},
        binding_hash: "7".repeat(64),
      },
      description_blob: "1".repeat(64),
    }],
    recommendation: null,
    answer: { kind: "option", option_key: "create", text_blob: null },
    applied: true,
  });
  const groups = [
    answeredGroup,
    textGroup,
    deferred,
    expired,
    cancelled,
    applied,
  ];
  const w = sourceOf(world({
    "read:messages/list": () => ok({ messages: [], ...META }),
    "read:questions/list": () => ok(listed("groups", groups)),
    "read:questions/text": (body) => {
      const n = Number(String(body.group).slice(-1));
      return ok(questionText(n, n === 2 ? "Every other week" : null));
    },
    "read:tool-calls/list": () => ok({ tool_calls: [], ...META }),
    "read:events/list": eventsFor([]),
  }));
  const read = await w.source.thread(SESSION);
  assert(read.ok);
  const summaries = read.value.entries.map((entry) => {
    assert(entry.kind === "questions");
    return entry.answered;
  });
  assertEquals(summaries, [
    {
      status: "answered",
      answers: [{
        question: id("qst", 1),
        answer: { kind: "option", option_key: "weekly" },
      }],
    },
    {
      status: "answered",
      answers: [{
        question: id("qst", 2),
        answer: { kind: "text", text: "Every other week" },
      }],
    },
    { status: "skipped", answers: [] },
    { status: "expired", answers: [] },
    { status: "cancelled", answers: [] },
    {
      status: "applied",
      answers: [{
        question: id("qst", 6),
        answer: { kind: "option", option_key: "create" },
      }],
    },
  ]);
});

test("platform/approvals#R18 platform/approvals#R20 shell/desktop#R47 [agent-I33b]: run이 승인을 기다리면 approval을 읽어 카드 값으로 옮기고 session 허락 가능 여부를 싣는다", async () => {
  const user = message(1, {}, 21);
  const w = sourceOf(world({
    "read:messages/list": () => ok({ messages: [user], ...META }),
    "read:runs/list": () =>
      ok(listed("runs", [run(1, {
        state: "waiting_user",
        waiting_on: id("apr", 1),
        accepted_seq: "21",
        state_seq: "45",
      })])),
    "read:questions/list": () => ok(listed("groups", [])),
    "read:tool-calls/list": () => ok({ tool_calls: [], ...META }),
    "read:events/list": eventsFor([
      { subject: id("msg", 1), seq: "21", at: at(0) },
    ]),
    "read:approvals/get": () =>
      ok({ request: approval(1), use: null, ...META }),
    "read:approvals/text": () =>
      ok({
        approval: id("apr", 1),
        reason: "lophn wants to replace last week's report.",
        changes: "Rewrite docs/reports/2026-w40.md\n+3 -1",
        external: null,
        reversibility: "Undo restores the earlier version.",
        closed_reason: null,
        ...META,
      }),
  }));
  const read = await w.source.thread(SESSION);
  assert(read.ok);
  assertEquals(read.value.approval, {
    id: id("apr", 1),
    title: "Rewrite docs/reports/2026-w40.md",
    reason: "lophn wants to replace last week's report.",
    preview: null,
    allowSession: true,
  });
  w.verify();

  // 앱 command의 confirm처럼 session 허락이 없는 request는 allowSession이 false다.
  const confirm = sourceOf(world({
    "read:messages/list": () => ok({ messages: [user], ...META }),
    "read:runs/list": () =>
      ok(listed("runs", [run(1, {
        state: "waiting_user",
        waiting_on: id("apr", 2),
        accepted_seq: "21",
        state_seq: "45",
      })])),
    "read:questions/list": () => ok(listed("groups", [])),
    "read:tool-calls/list": () => ok({ tool_calls: [], ...META }),
    "read:events/list": eventsFor([]),
    "read:approvals/get": () =>
      ok({
        request: approval(2, { session_grantable: false }),
        use: null,
        ...META,
      }),
    "read:approvals/text": () =>
      ok({
        approval: id("apr", 2),
        reason: "The app asks to delete entries.",
        changes: "Delete 3 entries in Expenses",
        external: null,
        reversibility: "Cannot be undone.",
        closed_reason: null,
        ...META,
      }),
  }));
  const second = await confirm.source.thread(SESSION);
  assert(second.ok);
  assertEquals(second.value.approval?.allowSession, false);
});

test("shell/desktop#R38 [agent-I33b]: 없는 session의 thread는 not_found이고 읽기가 실패하면 그 code를 돌려준다", async () => {
  const missing = sourceOf(world({
    "read:sessions/read": () => fail("not_found"),
  }));
  assertEquals(await missing.source.thread(SESSION), {
    ok: false,
    code: "not_found",
  });
  const down = sourceOf(finishedThreadWorld());
  const broken = sourceOf({
    ...finishedThreadWorld(),
    "read:messages/list": () => fail("unavailable"),
  });
  assert((await down.source.thread(SESSION)).ok);
  assertEquals(await broken.source.thread(SESSION), {
    ok: false,
    code: "unavailable",
  });
});

// ---------------------------------------------------------------- notices

test("shell/desktop#R7 [agent-I33b]: 쓸 수 있는 provider가 하나도 없으면 provider-lost를 알리고 읽지 못하면 안내를 읽지 못한 것으로 둔다", async () => {
  const lost = sourceOf(world({
    "read:providers/list": () =>
      ok({
        providers: [{
          id: PROVIDER,
          name: "Anthropic",
          definition: { key: "anthropic" },
          credential: { state: "rejected" },
        }],
        ...META,
      }),
  }));
  assertEquals(await lost.source.notices(null), {
    ok: true,
    value: [{ kind: "provider-lost" }],
  });
  const none = sourceOf(world({
    "read:providers/list": () => ok({ providers: [], ...META }),
  }));
  assertEquals(await none.source.notices(null), {
    ok: true,
    value: [{ kind: "provider-lost" }],
  });
  const usable = sourceOf(world({
    "read:providers/list": () => ok(PROVIDERS),
  }));
  assertEquals(await usable.source.notices(null), { ok: true, value: [] });
  const down = sourceOf(world({
    "read:providers/list": () => fail("unavailable"),
  }));
  assertEquals(await down.source.notices(null), {
    ok: false,
    code: "unavailable",
  });
});

test("shell/desktop#R7 lophn-agent/harness/model [agent-I33b]: 마지막 run의 외부 연결 호출이 일시 실패면 연결 이름과 확정된 다음 시도 시각을 알린다", async () => {
  const call = (over: Record<string, unknown>) => ({
    id: id("mcl", 1),
    run: id("run", 2),
    state: "finished",
    started_at: at(0),
    attempt_order: 1,
    attempt_kind: "initial",
    model: { provider: PROVIDER, name: "Sonnet 5.5" },
    outcome: { kind: "failed", code: "temporary", retry_at: at(300) },
    ...over,
  });
  const handlers = (calls: unknown[]): Handlers =>
    world({
      "read:providers/list": () => ok(PROVIDERS),
      "read:runs/list": () =>
        ok(listed("runs", [
          run(1, { state: "finished", accepted_seq: "21", state_seq: "25" }),
          run(2, { state: "running", accepted_seq: "40", state_seq: "41" }),
        ])),
      "read:model-calls/list": () => ok({ calls, ...META }),
    });
  const failed = sourceOf(handlers([call({})]));
  assertEquals(await failed.source.notices(SESSION), {
    ok: true,
    value: [{
      kind: "external",
      state: "connection-failed",
      connection: "Anthropic",
      action: "reconnect",
      retryAt: at(300),
    }],
  });
  assertEquals(
    failed.calls.find((c) => c.resource === "model-calls")!.body,
    { run: id("run", 2) },
  );

  const waiting = sourceOf(
    handlers([call({ state: "started", outcome: null })]),
  );
  assertEquals(await waiting.source.notices(SESSION), {
    ok: true,
    value: [{
      kind: "external",
      state: "waiting",
      connection: "Anthropic",
      action: null,
      retryAt: null,
    }],
  });
  const unknown = sourceOf(
    handlers([
      call({ outcome: { kind: "uncertain", code: null, retry_at: null } }),
    ]),
  );
  const notices = await unknown.source.notices(SESSION);
  assert(notices.ok);
  assertEquals(notices.value.map((n) => n.kind === "external" && n.state), [
    "unknown",
  ]);
  // 자동 retry는 사람에게 보이지 않는다.
  const retry = sourceOf(
    handlers([call({
      state: "started",
      outcome: null,
      attempt_kind: "retry",
    })]),
  );
  assertEquals(await retry.source.notices(SESSION), { ok: true, value: [] });
});

// ---------------------------------------------------------------- model

function modelWorld(over: Handlers = {}): Handlers {
  return world({
    "read:providers/list": () => ok(PROVIDERS),
    "read:agent-model-catalog/read": () => ok(CATALOG),
    "read:model-favorites/read": () =>
      ok({
        favorites: {
          items: [{ provider: PROVIDER, model_name: "Haiku 5.5" }],
          settings_seq: "5",
        },
        ...META,
      }),
    ...over,
  });
}

test("shell/desktop#R44 lophn-agent/conversation#R23 [agent-I33b]: model 보기는 session이 고른 값이 없으면 agent 기본값을 현재로 하고 Favorites·provider 묶음·option 축을 catalog에서 만든다", async () => {
  const w = sourceOf(modelWorld());
  const view = await w.source.model(SESSION, "");
  assertEquals(view, {
    ok: true,
    value: {
      current: { provider: PROVIDER, modelName: "Sonnet 5.5" },
      currentLabel: "Sonnet 5.5 · Medium",
      axes: [{
        id: "effort",
        label: "Effort",
        values: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ],
      }],
      optionValues: { effort: "medium" },
      layout: {
        favorites: [{
          provider: PROVIDER,
          providerLabel: "Anthropic",
          modelName: "Haiku 5.5",
          starred: true,
        }],
        providers: [{
          provider: PROVIDER,
          label: "Anthropic",
          models: [
            {
              provider: PROVIDER,
              providerLabel: "Anthropic",
              modelName: "Sonnet 5.5",
              starred: false,
            },
            {
              provider: PROVIDER,
              providerLabel: "Anthropic",
              modelName: "Haiku 5.5",
              starred: true,
            },
          ],
        }],
      },
      notices: [],
    },
  });
  w.verify();

  // 검색어는 model 이름 부분 일치로 두 묶음을 모두 거른다.
  const found = await w.source.model(SESSION, "hai");
  assert(found.ok);
  assertEquals(
    found.value.layout.providers[0]!.models.map((m) => m.modelName),
    [
      "Haiku 5.5",
    ],
  );

  // session이 고른 model이 있으면 그것이 현재다.
  const chosen = sourceOf(modelWorld({
    "read:sessions/read": () =>
      ok({ session: session(1, { model_selection: HAIKU }), ...META }),
  }));
  const haiku = await chosen.source.model(SESSION, "");
  assert(haiku.ok);
  assertEquals(haiku.value.currentLabel, "Haiku 5.5");
  assertEquals(haiku.value.axes, []);
});

test("shell/desktop#R44 [agent-I33b]: catalog를 읽지 못해도 model 보기는 현재 model의 이름을 보이고 고를 목록만 비운다", async () => {
  const w = sourceOf(modelWorld({
    "read:agent-model-catalog/read": () => fail("unavailable"),
  }));
  const view = await w.source.model(SESSION, "");
  assert(view.ok);
  assertEquals(view.value.currentLabel, "Sonnet 5.5");
  assertEquals(view.value.layout.providers, []);
});

test("shell/desktop#R44 lophn-agent/harness/model#R25 [agent-I33b]: model을 고르면 이 session에만 저장하고 지원하지 않는 option 값은 가까운 약한 값으로 맞춰 알린다", async () => {
  const high = { ...SONNET, option_values: { effort: "high" } };
  const catalog = {
    ...CATALOG,
    entries: [
      CATALOG.entries[0]!,
      {
        provider_definition: "anthropic",
        model_name: "Opus 5.5",
        options: [{
          id: "effort",
          label: "Effort",
          values: [
            { value: "low", label: "Low", wire: null },
            { value: "medium", label: "Medium", wire: null },
          ],
          default_value: "medium",
          budget: null,
        }],
      },
      CATALOG.entries[1]!,
    ],
  };
  const w = sourceOf(modelWorld({
    "read:agent-model-catalog/read": () => ok(catalog),
    "read:sessions/read": () =>
      ok({ session: session(1, { model_selection: high }), ...META }),
    "command:sessions/change-model": (body) =>
      ok({ id: SESSION, model_selection: body.model, state_seq: "11" }),
  }));
  const view = await w.source.chooseModel(
    SESSION,
    { provider: PROVIDER, modelName: "Opus 5.5" },
    "",
  );
  assert(view.ok);
  assertEquals(view.value.current, {
    provider: PROVIDER,
    modelName: "Opus 5.5",
  });
  assertEquals(view.value.optionValues, { effort: "medium" });
  assertEquals(view.value.notices, [
    { axisLabel: "Effort", fromLabel: "High", toLabel: "Medium" },
  ]);
  const body = w.calls.find((call) => call.method === "change-model")!
    .body as Record<string, unknown>;
  assertEquals(body.input, {
    session: SESSION,
    model: {
      provider: PROVIDER,
      model_name: "Opus 5.5",
      option_values: { effort: "medium" },
    },
  });
  assertEquals(body.compare, { state: "open", state_seq: "10" });
  w.verify();
});

test("shell/desktop#R44 [agent-I33b]: option 값을 고르면 같은 model의 값만 바꿔 저장한다", async () => {
  const w = sourceOf(modelWorld({
    "command:sessions/change-model": (body) =>
      ok({ id: SESSION, model_selection: body.model, state_seq: "11" }),
  }));
  const view = await w.source.setModelOption(SESSION, "effort", "high", "");
  assert(view.ok);
  assertEquals(view.value.optionValues, { effort: "high" });
  assertEquals(view.value.currentLabel, "Sonnet 5.5 · High");
  const input = (w.calls.find((call) => call.method === "change-model")!
    .body as { input: unknown }).input;
  assertEquals(input, {
    session: SESSION,
    model: { ...SONNET, option_values: { effort: "high" } },
  });
});

test("shell/desktop#R44 lophn-agent/harness/model#R26 [agent-I33b]: 즐겨찾기는 session이 아니라 사람의 것이라 별표를 찍으면 맨 끝에 붙고 읽은 settings_seq를 비교 기준으로 쓴다", async () => {
  const w = sourceOf(modelWorld({
    "command:model-favorites/change": (body) =>
      ok({ favorites: { items: body.items, settings_seq: "6" } }),
  }));
  const view = await w.source.toggleFavorite(
    SESSION,
    { provider: PROVIDER, modelName: "Sonnet 5.5" },
    "",
  );
  assert(view.ok);
  assertEquals(
    view.value.layout.favorites.map((row) => row.modelName),
    ["Haiku 5.5", "Sonnet 5.5"],
  );
  const body = w.calls.find((call) =>
    call.resource === "model-favorites" &&
    call.method === "change"
  )!.body as Record<string, unknown>;
  assertEquals(body.input, {
    items: [
      { provider: PROVIDER, model_name: "Haiku 5.5" },
      { provider: PROVIDER, model_name: "Sonnet 5.5" },
    ],
  });
  assertEquals(body.compare, { settings_seq: "5" });
  assertEquals(
    w.calls.filter((call) => call.method === "change-model").length,
    0,
  );
  w.verify();
});

test("lophn-agent/conversation#R23 [agent-I33b]: 아직 session이 없을 때 고른 model은 source가 쥐고 있다가 session을 열 때 그 session에 저장한다", async () => {
  const opened = id("ses", 9);
  const w = sourceOf(modelWorld({
    "command:sessions/open": () =>
      ok({
        id: opened,
        state: "open",
        work_place: WORK_PLACE,
        state_seq: "90",
      }),
    "command:sessions/change-model": (body) =>
      ok({ id: opened, model_selection: body.model, state_seq: "91" }),
  }));
  const view = await w.source.chooseModel(
    null,
    { provider: PROVIDER, modelName: "Haiku 5.5" },
    "",
  );
  assert(view.ok);
  assertEquals(view.value.currentLabel, "Haiku 5.5");
  // 쓰지 않았으니 core에는 아무 command도 가지 않았다.
  assertEquals(w.calls.filter((call) => call.kind === "command").length, 0);
  const again = await w.source.model(null, "");
  assert(again.ok);
  assertEquals(again.value.currentLabel, "Haiku 5.5");

  assertEquals(await w.source.openSession({ id: opened, contexts: [] }), {
    ok: true,
    value: undefined,
  });
  const changed = w.calls.find((call) => call.method === "change-model")!
    .body as Record<string, unknown>;
  assertEquals(changed.input, {
    session: opened,
    model: { ...HAIKU },
  });
  assertEquals(changed.compare, { state: "open", state_seq: "90" });
  w.verify();
});

// ---------------------------------------------------------------- commands

const BUILTINS = [
  ["new", "New session", "Start a new session with this agent", "run"],
  ["rename", "Rename", "Rename this session", "run"],
  ["compact", "Compact", "Summarize this session to free up context", "queue"],
  ["fork", "Fork", "Copy this session into a new one", "blocked"],
] as const;

function registry() {
  const builtins = BUILTINS.map(([name, title, description, whileRunning]) => ({
    name,
    title,
    description,
    source: "builtin",
    skill_origin: null,
    while_running: whileRunning,
    action: { kind: "builtin", id: name },
  }));
  return {
    commands: [
      ...builtins,
      {
        name: "new-app",
        title: "New app",
        description: "Plan a new app",
        source: "role",
        skill_origin: null,
        while_running: "queue",
        action: { kind: "prompt", template: "Help me plan a new app." },
      },
      {
        name: "stop-here",
        title: "Stop here",
        description: "Run a tool",
        source: "role",
        skill_origin: null,
        while_running: "run",
        action: { kind: "tool", tool: "session.note" },
      },
      {
        name: "eval-metrics",
        title: null,
        description: "Evaluate metrics",
        source: "skill",
        skill_origin: "place",
        while_running: "queue",
        action: { kind: "skill", skill_name: "eval-metrics" },
      },
    ],
    notices: [],
    ...META,
  };
}

test("lophn-agent/commands#R1 shell/desktop#R45 [agent-I33b]: `/` 목록은 그 session의 registry를 Commands·<agent 이름>·Skills 묶음으로 나누고 query로 거른다", async () => {
  const w = sourceOf(world({
    "read:commands/list": () => ok(registry()),
  }));
  const all = await w.source.commands(SESSION, "");
  assert(all.ok);
  assertEquals(all.value.map((group) => [group.source, group.title]), [
    ["builtin", "Commands"],
    ["role", "lophn"],
    ["skill", "Skills"],
  ]);
  assertEquals(all.value[0]!.entries[0], {
    name: "new",
    title: "New session",
    description: "Start a new session with this agent",
    source: "builtin",
    skillOrigin: null,
    whileRunning: "run",
  });
  assertEquals(all.value[2]!.entries[0], {
    name: "eval-metrics",
    title: null,
    description: "Evaluate metrics",
    source: "skill",
    skillOrigin: "place",
    whileRunning: "queue",
  });
  assertEquals(
    w.calls.find((call) => call.resource === "commands")!.body,
    { session: SESSION },
  );
  const filtered = await w.source.commands(SESSION, "co");
  assert(filtered.ok);
  // 이름이 co로 시작하거나(compact) 설명의 단어가 co로 시작하는(fork: Copy) 명령만 남는다.
  assertEquals(
    filtered.value.map((group) => group.entries.map((e) => e.name)),
    [
      ["compact", "fork"],
    ],
  );
});

test("lophn-agent/commands#R1 [agent-I33b]: session이 없으면 같은 agent의 가장 최근 session의 registry에서 session이 있어야 하는 명령을 뺀다", async () => {
  const w = sourceOf(world({
    "read:commands/list": () => ok(registry()),
  }));
  const groups = await w.source.commands(null, "");
  assert(groups.ok);
  assertEquals(
    groups.value.flatMap((group) => group.entries.map((e) => e.name)),
    ["new", "new-app", "stop-here", "eval-metrics"],
  );
  // 목록의 첫 session(가장 최근)으로 묻는다.
  assertEquals(
    w.calls.find((call) => call.resource === "commands")!.body,
    { session: SESSION },
  );
});

test("lophn-agent/commands#R1 [agent-I33b]: session이 하나도 없으면 session 없이 쓸 수 있는 전역 명령만 보인다", async () => {
  const w = sourceOf(world({
    "read:sessions/list": () => ok(listed("sessions", [])),
  }));
  const groups = await w.source.commands(null, "");
  assert(groups.ok);
  assertEquals(
    groups.value.flatMap((group) => group.entries.map((e) => e.name)),
    ["new", "mcp", "skills", "permissions"],
  );
  assertEquals(groups.value.map((group) => group.title), ["Commands"]);
});

function commandWorld(over: Handlers = {}): Handlers {
  return world({
    "read:commands/list": () => ok(registry()),
    "read:runs/list": () => ok(listed("runs", [])),
    "command:messages/receive": () => ok(message(7, {}, 70)),
    ...over,
  });
}

test("lophn-agent/commands#R9 [agent-I33b]: role의 prompt 명령은 정한 prompt를, skill 명령은 그 skill 이름이 든 말을 사람이 보낸 메시지로 접수한다", async () => {
  const w = sourceOf(commandWorld());
  const entries = await w.source.commands(SESSION, "");
  assert(entries.ok);
  const byName = (name: string) =>
    entries.value.flatMap((group) => group.entries).find((e) =>
      e.name === name
    )!;
  assertEquals(await w.source.runCommand(SESSION, byName("new-app"), "cmd-1"), {
    ok: true,
    value: undefined,
  });
  assertEquals(
    await w.source.runCommand(SESSION, byName("eval-metrics"), "cmd-2"),
    { ok: true, value: undefined },
  );
  const sent = w.calls.filter((call) => call.method === "receive").map(
    (call) => {
      const body = call.body as {
        input: { content: { parts: { text: string }[] }; mode: string };
        idempotency_key: string;
      };
      return [
        body.input.content.parts[0]!.text,
        body.input.mode,
        body.idempotency_key,
      ];
    },
  );
  assertEquals(sent, [
    ["Help me plan a new app.", "request", "commands-run-cmd-1"],
    [
      'Use the "eval-metrics" skill for this request.',
      "request",
      "commands-run-cmd-2",
    ],
  ]);
  w.verify();
});

test("lophn-agent/commands#R9 [agent-I33b]: tool을 실행하는 명령은 renderer가 실행할 길이 없어 unavailable이고 built-in은 source가 아니라 화면이 한다", async () => {
  const w = sourceOf(commandWorld());
  const entries = await w.source.commands(SESSION, "");
  assert(entries.ok);
  const all = entries.value.flatMap((group) => group.entries);
  assertEquals(
    await w.source.runCommand(
      SESSION,
      all.find((e) => e.name === "stop-here")!,
      "cmd-3",
    ),
    { ok: false, code: "unavailable" },
  );
  assertEquals(
    await w.source.runCommand(
      SESSION,
      all.find((e) => e.name === "new")!,
      "cmd-4",
    ),
    { ok: false, code: "invalid_input" },
  );
  assertEquals(w.calls.filter((call) => call.method === "receive").length, 0);
});

test("lophn-agent/commands#R8 [agent-I33b]: 일하는 중이면 queue 명령은 이번 일이 끝난 뒤 접수하고, blocked 명령은 바로 conflict다", async () => {
  let reads = 0;
  const waits: number[] = [];
  const w = sourceOf(
    commandWorld({
      "read:runs/list": () => {
        reads += 1;
        // 처음 두 번은 일하는 중이고 세 번째에 끝난다.
        return ok(listed("runs", [run(1, {
          state: reads < 3 ? "running" : "finished",
          accepted_seq: "21",
        })]));
      },
    }),
    undefined,
    {
      ...DEPS,
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    },
  );
  const entries = await w.source.commands(SESSION, "");
  assert(entries.ok);
  const all = entries.value.flatMap((group) => group.entries);
  const queued = await w.source.runCommand(
    SESSION,
    all.find((e) => e.name === "new-app")!,
    "cmd-5",
  );
  assertEquals(queued, { ok: true, value: undefined });
  assertEquals(waits.length, 2);
  assertEquals(w.calls.filter((call) => call.method === "receive").length, 1);

  const busy = sourceOf(commandWorld({
    "read:runs/list": () =>
      ok(listed("runs", [run(1, { state: "running", accepted_seq: "21" })])),
  }));
  const blocked = await busy.source.runCommand(
    SESSION,
    { ...all.find((e) => e.name === "new-app")!, whileRunning: "blocked" },
    "cmd-6",
  );
  assertEquals(blocked, { ok: false, code: "conflict" });
  assertEquals(
    busy.calls.filter((call) => call.method === "receive").length,
    0,
  );
});

test("lophn-agent/commands#R8 [agent-I33b]: 끝나기를 끝없이 기다리지 않고 한도를 넘으면 conflict로 알린다", async () => {
  const w = sourceOf(
    commandWorld({
      "read:runs/list": () =>
        ok(listed("runs", [run(1, { state: "running", accepted_seq: "21" })])),
    }),
    undefined,
    { ...DEPS, wait: () => Promise.resolve() },
  );
  const entries = await w.source.commands(SESSION, "");
  assert(entries.ok);
  const target = entries.value.flatMap((group) => group.entries)
    .find((e) => e.name === "new-app")!;
  assertEquals(await w.source.runCommand(SESSION, target, "cmd-7"), {
    ok: false,
    code: "conflict",
  });
});

// ---------------------------------------------------------------- questions and approvals

test("lophn-agent/questions#R6 shell/desktop#R46 [agent-I33b]: 묶음 답은 읽은 created_seq를 비교 기준으로 질문별 답을 한 번에 보내고 같은 답은 같은 key다", async () => {
  const group = questionGroup(1);
  const answers = [{
    question: id("qst", 1),
    answer: { kind: "option" as const, option_key: "weekly" },
  }];
  const w = sourceOf(world({
    "read:questions/read": () => ok({ group, ...META }),
    "command:questions/answer": () =>
      ok({
        id: id("qgr", 1),
        status: "answered",
        closed_seq: "60",
        replayed: false,
      }),
  }));
  assertEquals(
    await w.source.answerQuestions({ group: id("qgr", 1), answers }),
    { ok: true, value: undefined },
  );
  await w.source.answerQuestions({ group: id("qgr", 1), answers });
  const sent = w.calls.filter((call) => call.method === "answer").map((call) =>
    call.body as Record<string, unknown>
  );
  assertEquals(sent[0]!.input, {
    group: id("qgr", 1),
    created_seq: "41",
    answers,
  });
  assertEquals(sent[0]!.compare, { created_seq: "41" });
  assertEquals(sent[0]!.idempotency_key, sent[1]!.idempotency_key);
  assert(
    String(sent[0]!.idempotency_key).startsWith(
      `questions-answer-${id("qgr", 1)}-`,
    ),
  );
  // 자유 답은 글을 값으로 싣는다.
  await w.source.answerQuestions({
    group: id("qgr", 1),
    answers: [{
      question: id("qst", 1),
      answer: { kind: "text", text: "Every other Monday" },
    }],
  });
  const last = w.calls.filter((call) => call.method === "answer").at(-1)!
    .body as { input: { answers: unknown[] }; idempotency_key: string };
  assertEquals(last.input.answers, [{
    question: id("qst", 1),
    answer: { kind: "text", text: "Every other Monday" },
  }]);
  assert(last.idempotency_key !== sent[0]!.idempotency_key);
  w.verify();
});

test("lophn-agent/questions#R6 [agent-I33b]: Skip은 묶음 전체를 답 없이 미루고 이미 닫힌 묶음의 code는 그대로 돌려준다", async () => {
  const w = sourceOf(world({
    "read:questions/read": () => ok({ group: questionGroup(1), ...META }),
    "command:questions/defer": () =>
      ok({
        id: id("qgr", 1),
        status: "cancelled",
        closed_seq: "61",
        replayed: false,
      }),
  }));
  assertEquals(await w.source.deferQuestions(id("qgr", 1)), {
    ok: true,
    value: undefined,
  });
  const body = w.calls.find((call) => call.method === "defer")!
    .body as Record<string, unknown>;
  assertEquals(body.input, { group: id("qgr", 1), created_seq: "41" });
  assertEquals(body.compare, { created_seq: "41" });
  assertEquals(body.idempotency_key, `questions-defer-${id("qgr", 1)}`);
  w.verify();

  const closed = sourceOf(world({
    "read:questions/read": () => ok({ group: questionGroup(1), ...META }),
    "command:questions/defer": () => fail("conflict"),
  }));
  assertEquals(await closed.source.deferQuestions(id("qgr", 1)), {
    ok: false,
    code: "conflict",
  });
});

function actionGroup(command: string) {
  return questionGroup(1, {}, {
    options: [{
      key: "apply",
      label: "Apply",
      evidence: [],
      adoption: null,
      action: {
        concern: "apps",
        command,
        targets: [APP],
        input: { kind: "inline", value: {} },
        input_hash: "6".repeat(64),
        comparison: {},
        binding_hash: "7".repeat(64),
      },
      description_blob: "1".repeat(64),
    }],
    recommendation: null,
  });
}

test("lophn-agent/questions#R13 [agent-I33b]: 고정 action 선택지의 답은 일반 답 경로가 아니라 확인 없이 확정하는 통로(app.create·apply_settings)나 확인 창으로 간다", async () => {
  const answers = [{
    question: id("qst", 1),
    answer: { kind: "option" as const, option_key: "apply" },
  }];
  const windowless: unknown[] = [];
  const windows: unknown[] = [];
  const deps: AgentCoreDeps = {
    ...DEPS,
    confirmWithoutWindow: (input) => {
      windowless.push(input);
      return Promise.resolve({ ok: true });
    },
    openConfirmation: (intent) => {
      windows.push(intent);
      return Promise.resolve({ windowId: "win_1" });
    },
  };
  const direct = sourceOf(
    world({
      "read:questions/read": () =>
        ok({ group: actionGroup("app.create"), ...META }),
    }),
    undefined,
    deps,
  );
  assertEquals(
    await direct.source.answerQuestions({ group: id("qgr", 1), answers }),
    { ok: true, value: undefined },
  );
  assertEquals(windowless, [{ group: id("qgr", 1), option_key: "apply" }]);
  assertEquals(windows, []);
  assertEquals(
    direct.calls.filter((call) => call.method === "answer").length,
    0,
  );

  const review = sourceOf(
    world({
      "read:questions/read": () =>
        ok({ group: actionGroup("release.activate"), ...META }),
    }),
    undefined,
    deps,
  );
  assertEquals(
    await review.source.answerQuestions({ group: id("qgr", 1), answers }),
    { ok: true, value: undefined },
  );
  assertEquals(windows, [{
    request: {
      kind: "question_option_action",
      group: id("qgr", 1),
      option_key: "apply",
    },
    parentWindow: "requesting-window",
  }]);
  assertEquals(
    review.calls.filter((call) => call.method === "answer").length,
    0,
  );
});

test("platform/approvals#R18 shell/desktop#R47 [agent-I33b]: 승인 카드의 단추는 결정이 아니라 미리 고른 choice로 confirmation window를 여는 것이다", async () => {
  const opened: unknown[] = [];
  const w = sourceOf(world(), undefined, {
    ...DEPS,
    openConfirmation: (intent) => {
      opened.push(intent);
      return Promise.resolve({ windowId: "win_1" });
    },
  });
  for (const choice of ["allow_once", "allow_session", "deny"] as const) {
    assertEquals(
      await w.source.openApproval({ approval: id("apr", 1), choice }),
      { ok: true, value: undefined },
    );
  }
  assertEquals(
    opened,
    ["allow_once", "allow_session", "deny"].map((preselect) => ({
      request: { kind: "approval_request", approval: id("apr", 1), preselect },
      parentWindow: "requesting-window",
    })),
  );
  // 결정 command는 한 번도 부르지 않았다.
  assertEquals(w.calls.length, 0);
});

test("platform/approvals#R18 [agent-I33b]: 창을 열 수 없거나 열지 못하면 그 이유를 돌려주고 결정을 내지 않는다", async () => {
  const none = sourceOf(world());
  assertEquals(
    await none.source.openApproval({ approval: id("apr", 1), choice: "deny" }),
    { ok: false, code: "unavailable" },
  );
  const refused = sourceOf(world(), undefined, {
    ...DEPS,
    openConfirmation: () => Promise.resolve({ code: "conflict" }),
  });
  assertEquals(
    await refused.source.openApproval({
      approval: id("apr", 1),
      choice: "allow_once",
    }),
    { ok: false, code: "conflict" },
  );
  const thrown = sourceOf(world(), undefined, {
    ...DEPS,
    openConfirmation: () => Promise.reject(new Error("ipc closed")),
  });
  assertEquals(
    await thrown.source.openApproval({
      approval: id("apr", 1),
      choice: "allow_once",
    }),
    { ok: false, code: "unavailable" },
  );
});

// ---------------------------------------------------------------- the rest

test("lophn-agent/revert [agent-I33b]: 되돌리기는 revert 화면 task가 붙이기 전까지 unavailable이고 core를 부르지 않는다", async () => {
  const w = sourceOf(world());
  const unavailable = { ok: false, code: "unavailable" } as const;
  assertEquals(await w.source.rewind(SESSION, id("msg", 1)), unavailable);
  assertEquals(await w.source.rewind(SESSION, null), unavailable);
  assertEquals(await w.source.undoEdit(VER2), unavailable);
  assertEquals(await w.source.redoEdit(VER2), unavailable);
  assertEquals(w.calls.length, 0);
});

test("shell/desktop#R7 [agent-I33b]: watch는 main이 미는 연결 상태를 그대로 듣고 해제하면 더 받지 않는다", () => {
  const w = sourceOf(world());
  const seen: string[] = [];
  const stop = w.source.watch((state) => seen.push(state.state));
  w.connect({ state: "stale", confirmedAt: 5 });
  stop();
  w.connect({ state: "ready", confirmedAt: 6 });
  assertEquals(seen, ["stale"]);
});

test("shell/desktop#R7 [agent-I33b]: 한 source의 읽기는 한꺼번에 많이 보내지 않는다(core reader가 한 사람의 동시 읽기를 제한한다)", async () => {
  const harness = contractCore(world(), CHECKED, { delayMs: 5 });
  const source = coreAgentViewSourceFactory(harness.core, DEPS)({
    assignment: LOPHN,
    place: { kind: "project", id: PROJECT },
  });
  await Promise.all(
    Array.from({ length: 12 }, () => source.agent()),
  );
  assert(harness.peak() <= 4, `동시 호출 ${harness.peak()}`);
  assert(harness.peak() >= 2);
});
