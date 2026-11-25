import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutboundCalls } from "./outbound.ts";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../../base/mod.ts";
import type { Assignment } from "../../../protocol/approvals/mod.ts";
import {
  appCallTool,
  type ToolCallInput,
  type ToolCallOutput,
} from "../../../protocol/apps/calls/mod.ts";
import type { AppGrant } from "../../../protocol/apps/grants.ts";
import { routePath } from "../../../protocol/base/mod.ts";
import {
  type CallPolicy,
  DEFAULT_CALL_POLICY,
} from "../../../protocol/lophn-agent/call-policy.ts";
import type { AgentId } from "../../../protocol/lophn-agent/workspaces.ts";
import {
  type MachineCandidate,
  type Requester,
  resolveMachine,
} from "../../../protocol/machine/requester.ts";
import {
  appCommands,
  appCommandTool,
} from "../../lophn-agent/tools/app-tool/command.ts";
import { resolveAppCall } from "../../lophn-agent/tools/lophn/resolve.ts";
import type { VerifiedCaller } from "./caller.ts";
import {
  createRemoteForward,
  REMOTE_COMMAND_DEADLINE_MS,
  type RemoteForwardDeps,
  type RemoteMachines,
} from "./forward.ts";
import { createAppCalls } from "./mod.ts";

const APP = "app_0000000000000000000000000a";
const OTHER_APP = "app_0000000000000000000000000b";
const CALLER_APP = "app_0000000000000000000000000c";
const SES = "ses_0000000000000000000000000a";
const TRN = "trn_0000000000000000000000000a";
const TCL = "tcl_0000000000000000000000000a";
const AGENT = "agt_0000000000000000000000000a" as AgentId;
const STUDIO: MachineCandidate = {
  machine: "mch_0000000000000000000000000a",
  device: "dev_0000000000000000000000000a",
  name: "studio",
  self: false,
};
const SELF: MachineCandidate = {
  machine: "mch_0000000000000000000000000b",
  device: "dev_0000000000000000000000000b",
  name: "laptop",
  self: true,
};
const SUCCEEDED: ToolCallOutput = {
  invocation: null,
  outcome: { status: "succeeded", result: { done: true } },
};

type Sent = {
  device: string;
  call: { resource: string; method: string; body: unknown };
  by: Requester;
};

function setup(
  options: {
    entries?: Assignment["entries"];
    policy?: CallPolicy;
    grants?: AppGrant[];
    computers?: MachineCandidate[];
    reply?: Result<unknown>;
    name?: string | null;
  } = {},
) {
  const sent: Sent[] = [];
  // 보낼 때 고른 lane과 시한.
  const lanes: { lane?: string; deadlineMs?: number }[] = [];
  const records: {
    begin: Parameters<OutboundCalls["begin"]>[0];
    end?: Parameters<OutboundCalls["finish"]>[1];
  }[] = [];
  const outbound: OutboundCalls = {
    begin: (call) => {
      records.push({ begin: call });
      return ok(undefined);
    },
    finish: (id, end) => {
      records.find((one) => one.begin.id === id)!.end = end;
      return ok(undefined);
    },
    closeStale: () => ok(undefined),
  };
  const computers = options.computers ?? [STUDIO, SELF];
  const machines: RemoteMachines = {
    computers: () => computers,
    list: () => [],
    resolve: (ref) => resolveMachine(ref, computers),
    call: (device, { lane, deadlineMs, ...call }, by) => {
      lanes.push({ lane, deadlineMs });
      sent.push({ device, call, by });
      return Promise.resolve(options.reply ?? ok(SUCCEEDED));
    },
  };
  const deps: RemoteForwardDeps = {
    isPrivate: () => false,
    assignmentOf: (agent) =>
      ok({
        agent,
        entries: options.entries ?? [
          {
            app: APP,
            machine: STUDIO.machine,
            name: "Notes",
            removed_tools: [],
          },
        ],
      }),
    appGrantsOf: () => Promise.resolve(ok(options.grants ?? [])),
    machines: () => machines,
    policy: () => options.policy ?? DEFAULT_CALL_POLICY,
    agentName: () => (options.name === undefined ? "Ada" : options.name),
    outbound,
    clock: manualClock(Date.parse("2026-10-16T00:00:00.000Z")),
    ids: createIdSource({
      clock: manualClock(Date.parse("2026-10-16T00:00:00.000Z")),
      random: seededRandom(7),
    }),
  };
  return { forward: createRemoteForward(deps), sent, lanes, records };
}

function agentCaller(
  workspace: Extract<VerifiedCaller, { kind: "agent" }>["workspace"] = null,
): Extract<VerifiedCaller, { kind: "agent" }> {
  return {
    kind: "agent",
    agent: AGENT,
    workspace,
    session: SES,
    turn: TRN,
    toolCall: TCL,
  } as never;
}

function appCaller(remote = false): Extract<VerifiedCaller, { kind: "app" }> {
  return {
    kind: "app",
    app: CALLER_APP,
    parent: { id: "inv_0000000000000000000000000a", app: CALLER_APP, remote },
  } as never;
}

const target = (machine = "studio") => ({ machine, app: APP as never });
const grant = (tools: string[]): AppGrant =>
  ({
    id: "grt_0000000000000000000000000a",
    app: CALLER_APP,
    scope: { kind: "app.call", app: APP, app_tools: tools },
    status: "active",
  }) as never;

function denied(result: Result<ToolCallOutput>) {
  return (
    result.ok &&
    result.value.outcome.status === "denied" &&
    result.value.outcome.denial.code
  );
}

// 받는 기계는 보낸 쪽의 Gate를 지나지 않은 호출을 받는다. 이 컴퓨터가 보내기 전에 할당을 보지 않으면 할당이 없는 agent도 다른 기계의 앱을 부른다.
test("할당이 없는 agent는 다른 기계의 앱을 부르지 못한다: 그 앱의 줄이 없거나 command를 뺐거나 이 기계에만 할당했으면 link에 아무것도 가지 않는다", async () => {
  const lines: [string, Assignment["entries"]][] = [
    ["no assignment", []],
    [
      "command removed",
      [
        {
          app: APP,
          machine: STUDIO.machine,
          name: "Notes",
          removed_tools: ["add"],
        },
      ],
    ],
    [
      "removed there, allowed on another computer",
      [
        {
          app: APP,
          machine: "mch_0000000000000000000000000c",
          name: "Notes",
          removed_tools: [],
        },
        {
          app: APP,
          machine: STUDIO.machine,
          name: "Notes",
          removed_tools: ["add"],
        },
      ],
    ],
    ["assigned on this machine only", [{ app: APP, removed_tools: [] }]],
    [
      "another app on that machine",
      [
        {
          app: OTHER_APP,
          machine: STUDIO.machine,
          name: "Other",
          removed_tools: [],
        },
      ],
    ],
  ];
  for (const [label, entries] of lines) {
    const t = setup({ entries });
    const result = await t.forward({
      caller: agentCaller(),
      target: target(),
      name: "add",
      input: undefined,
    });
    assert.equal(denied(result), "gate_blocked", label);
    assert.deepEqual(t.sent, [], label);
  }

  // 할당했으면 보낸다. `by`는 그 agent다(session은 부른 session, 이름은 사람이 보는 이름).
  const t = setup();
  const result = await t.forward({
    caller: agentCaller(),
    target: target(),
    name: "add",
    input: { title: "x" },
  });
  assert.deepEqual(result, ok(SUCCEEDED));
  assert.deepEqual(t.sent, [
    {
      device: STUDIO.device,
      call: {
        resource: "apps",
        method: "remote_call",
        body: { app: APP, command: "add", input: { title: "x" } },
      },
      by: { kind: "agent", agent: AGENT, session: SES, name: "Ada" },
    },
  ]);
});

test("앱은 다른 앱에는 app.call grant가 command를 덮을 때만, 다른 컴퓨터의 자기 자신은 grant 없이도 부르고 보내는 요청한 쪽은 그 앱이다", async () => {
  for (const grants of [[], [grant(["other"])]]) {
    const t = setup({ grants });
    const result = await t.forward({
      caller: appCaller(),
      target: target(),
      name: "add",
      input: undefined,
    });
    assert.equal(denied(result), "gate_blocked");
    assert.deepEqual(t.sent, []);
  }
  const t = setup({ grants: [grant(["add"])] });
  const result = await t.forward({
    caller: appCaller(),
    target: target(),
    name: "add",
    input: undefined,
  });
  assert.ok(result.ok);
  assert.deepEqual(
    t.sent.map((one) => [one.by, one.call.body]),
    [
      [
        { kind: "app", app: CALLER_APP },
        { app: APP, command: "add" },
      ],
    ],
  );
  // 자기 앱은 `app_connections`에 선언할 수 없으므로 grant 없이도 다른 컴퓨터의 자기 command를 부른다.
  const self = setup({ grants: [] });
  const selfDone = await self.forward({
    caller: appCaller(),
    target: { machine: "studio", app: CALLER_APP as never },
    name: "monitor.view",
    input: undefined,
  });
  assert.ok(selfDone.ok);
  assert.deepEqual(
    self.sent.map((one) => [one.by, one.call.body]),
    [
      [
        { kind: "app", app: CALLER_APP },
        { app: CALLER_APP, command: "monitor.view" },
      ],
    ],
  );
});

// private은 기계 사이에도 선다.
test("private인 workspace의 agent와 앱은 다른 기계를 부르지 못한다", async () => {
  const policy: CallPolicy = {
    ...DEFAULT_CALL_POLICY,
    private: [
      { kind: "app", id: CALLER_APP },
      { kind: "project", id: "prj_0000000000000000000000000a" },
    ],
  };
  const call = (caller: VerifiedCaller) => {
    const t = setup({ policy, grants: [grant(["add"])] });
    return t
      .forward({
        caller: caller as never,
        target: target(),
        name: "add",
        input: undefined,
      })
      .then((result) => ({ result, sent: t.sent }));
  };
  for (const caller of [
    appCaller(),
    agentCaller({ kind: "project", id: "prj_0000000000000000000000000a" }),
    agentCaller({ kind: "app", id: CALLER_APP }),
  ]) {
    const { result, sent } = await call(caller);
    assert.equal(!result.ok && result.error.code, "forbidden");
    assert.deepEqual(sent, []);
  }
  // 같은 정책에서 private이 아닌 workspace의 agent는 보낸다.
  const open = await call(
    agentCaller({ kind: "project", id: "prj_0000000000000000000000000b" }),
  );
  assert.ok(open.result.ok);
  assert.equal(open.sent.length, 1);
});

// 받은 call을 돌리는 중인 앱이 다른 기계를 부르면 한 hop 넓어진 권한이 된다.
test("다른 기계에서 받은 호출 안에서 부른 앱 호출은 또 다른 기계로 넘어가지 않는다", async () => {
  const t = setup({ grants: [grant(["add"])] });
  const result = await t.forward({
    caller: appCaller(true),
    target: target(),
    name: "add",
    input: undefined,
  });
  assert.equal(!result.ok && result.error.code, "forbidden");
  assert.deepEqual(t.sent, []);
});

test("기계를 고르지 못하면 보내지 않는다: 이 컴퓨터는 invalid_input, 없는 기계는 not_found, 이름이 둘이면 invalid_input", async () => {
  const twin: MachineCandidate = {
    ...STUDIO,
    machine: "mch_0000000000000000000000000d",
    device: "dev_0000000000000000000000000d",
  };
  for (const [ref, computers, code] of [
    ["laptop", [STUDIO, SELF], "invalid_input"],
    [SELF.machine, [STUDIO, SELF], "invalid_input"],
    ["nowhere", [STUDIO, SELF], "not_found"],
    ["studio", [STUDIO, twin, SELF], "invalid_input"],
  ] as const) {
    const t = setup({
      computers: [...computers],
      entries: computers.map((one) => ({
        app: APP,
        machine: one.machine,
        name: "Notes",
        removed_tools: [],
      })),
    });
    const result = await t.forward({
      caller: agentCaller(),
      target: target(ref),
      name: "add",
      input: undefined,
    });
    assert.equal(!result.ok && result.error.code, code, ref);
    assert.deepEqual(t.sent, [], ref);
  }
});

// 할당이 없는 agent와 grant가 없는 앱은 컴퓨터 이름이 명단에 있는지 알아내지 못한다: 있는 이름도 없는 이름도 같은 거절이다.
test("할당이 없는 agent와 grant가 없는 앱에게는 있는 컴퓨터 이름과 없는 이름이 같은 거절이다", async () => {
  for (const caller of [agentCaller(), appCaller()]) {
    const answers = [];
    for (const ref of ["studio", "laptop", "nowhere", STUDIO.machine]) {
      const t = setup({ entries: [] });
      answers.push(
        await t.forward({
          caller,
          target: target(ref),
          name: "add",
          input: undefined,
        }),
      );
      assert.deepEqual(t.sent, []);
    }
    for (const answer of answers) assert.equal(denied(answer), "gate_blocked");
  }
  // 줄이 가리키지 않는 컴퓨터의 이름은 그 agent에게도 풀리지 않는다.
  const t = setup();
  const other = await t.forward({
    caller: agentCaller(),
    target: target("laptop"),
    name: "add",
    input: undefined,
  });
  assert.equal(!other.ok && other.error.code, "not_found");
});

// 보내지 못한 호출은 돌지 않았다(오류), 보낸 뒤 답을 잃은 호출은 돌았을 수 있다(결과 모름).
test("link가 보내지 못했으면 unavailable 오류이고 보낸 뒤 답을 잃었으면 결과 모름이다", async () => {
  const notSent = setup({
    reply: err({
      code: "unavailable",
      message: "not connected",
      details: { sent: false },
    }),
  });
  const failed = await notSent.forward({
    caller: agentCaller(),
    target: target(),
    name: "add",
    input: undefined,
  });
  assert.equal(!failed.ok && failed.error.code, "unavailable");

  const lost = setup({
    reply: err({
      code: "unavailable",
      message: "connection closed",
      details: { sent: true },
    }),
  });
  assert.deepEqual(
    await lost.forward({
      caller: agentCaller(),
      target: target(),
      name: "add",
      input: undefined,
    }),
    ok({
      invocation: null,
      outcome: { status: "unknown", reason: "connection_lost" },
    }),
  );
});

test("보낸 뒤 받은 답이 모양에 맞지 않으면 결과 모름이다", async () => {
  const t = setup({ reply: ok({ outcome: "whatever" }) });
  assert.deepEqual(
    await t.forward({
      caller: agentCaller(),
      target: target(),
      name: "add",
      input: undefined,
    }),
    ok({
      invocation: null,
      outcome: { status: "unknown", reason: "connection_lost" },
    }),
  );
});

test("agent 이름은 frame이 받는 길이로 줄어 보낸다", async () => {
  const t = setup({ name: "가".repeat(100) });
  await t.forward({
    caller: agentCaller(),
    target: target(),
    name: "add",
    input: undefined,
  });
  const by = t.sent[0].by;
  assert.ok(by.kind === "agent" && by.name.length <= 64 && by.name.length > 0);
});

// `lophn <slug> <command> --on <기계>`가 실행기까지 가서 가짜 link가 받은 `apps/remote_call`의 본문이 되는 길을 한 번 잇는다.
test("lophn <app> <command> --on <기계>는 apps/call_tool(remote)과 forward를 지나 그 기계의 apps/remote_call 본문이 된다", async () => {
  const t = setup();
  const clock = manualClock(Date.parse("2026-10-16T00:00:00.000Z"));
  const ids = createIdSource({ clock, random: seededRandom(7) });
  const calls = createAppCalls({
    callers: { agentToolCall: () => ok({ agent: AGENT, workspace: null }) },
    // 다른 기계로 가는 호출은 이 기계의 앱 표, ledger, 앱 process를 쓰지 않는다.
    apps: {
      activeRelease: () => ok(null),
      archived: () => ok(false),
      bySlug: () => ok(null),
    },
    lookup: {},
    ledger: {},
    link: {},
    forward: t.forward,
    assignmentOf: (a: AgentId) => ok({ agent: a, entries: [] }),
    appGrantsOf: () => Promise.resolve(ok([])),
    clock,
    ids,
  } as never);

  const view = {
    app: APP,
    machine: STUDIO.machine,
    slug: "notes",
    name: "Notes",
    release: "rel_0000000000000000000000000a",
    tools: [
      {
        name: "add",
        description: "Add a note",
        inputSchema: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
          additionalProperties: false,
        },
        effect: "write" as const,
        public: true,
      },
    ],
  };
  const assignment = [
    { app: APP, machine: STUDIO.machine, name: "Notes", removed_tools: [] },
  ];
  const found = appCommands({
    views: [view as never],
    entries: assignment,
    machines: [STUDIO, SELF],
  });
  const hit = resolveAppCall(
    { args: ["notes", "add", "--title", "hello", "--on", "studio"] },
    found.entries,
    found.machines,
  );
  assert.ok(hit !== undefined);
  // `--on` 없이는 이 기계의 command로 풀리지 않는다(이 기계에는 그 앱의 할당이 없다).
  assert.equal(
    resolveAppCall(
      { args: ["notes", "add", "--title", "hello"] },
      found.entries,
      found.machines,
    ),
    undefined,
  );
  const definition = appCommandTool(hit.entry);
  assert.equal(definition.gate, undefined);
  const core = async (path: string, body: unknown) => {
    assert.equal(path, routePath(appCallTool));
    const done = await calls.path.call(body as ToolCallInput, {
      actor: "agent",
    });
    return done;
  };
  const done = await definition.handler!(hit.input, {
    session: SES,
    turn: TRN,
    tool_call: TCL,
    core,
  } as never);
  assert.ok(done.ok);
  assert.equal(done.value.status, "success");
  assert.deepEqual(t.sent, [
    {
      device: STUDIO.device,
      call: {
        resource: "apps",
        method: "remote_call",
        body: { app: APP, command: "add", input: { title: "hello" } },
      },
      by: { kind: "agent", agent: AGENT, session: SES, name: "Ada" },
    },
  ]);
});

test("보낼 때 command lane과 긴 시한으로 보내고, 부른 컴퓨터에 시작과 끝 기록을 남긴다", async () => {
  const t = setup();
  const done = await t.forward({
    caller: agentCaller(),
    target: target(),
    name: "add",
    input: undefined,
  });
  assert.ok(done.ok);
  assert.deepEqual(t.lanes, [
    { lane: "command", deadlineMs: REMOTE_COMMAND_DEADLINE_MS },
  ]);
  assert.equal(t.records.length, 1);
  const [record] = t.records;
  assert.deepEqual(record.begin.caller, {
    kind: "agent",
    agent: AGENT,
    session: SES,
    name: "Ada",
  });
  assert.equal(record.begin.machine, STUDIO.machine);
  assert.equal(record.begin.app, APP);
  assert.equal(record.begin.command, "add");
  assert.equal(record.end?.status, "succeeded");

  // 답을 잃으면 unknown으로 남는다: 그 컴퓨터가 꺼져 있어도 부른 쪽 기록은 읽힌다.
  const lost = setup({
    grants: [grant(["add"])],
    reply: err({
      code: "unavailable",
      message: "connection closed",
      details: { sent: true },
    }),
  });
  await lost.forward({
    caller: appCaller(),
    target: target(),
    name: "add",
    input: undefined,
  });
  assert.deepEqual(lost.records[0].end?.status, "unknown");
});

test("다른 컴퓨터의 event로 연 job의 agent는 또 다른 컴퓨터를 부르지 못하고 기록도 남지 않는다", async () => {
  const t = setup();
  const done = await t.forward({
    caller: { ...agentCaller(), remote: true },
    target: target(),
    name: "add",
    input: undefined,
  });
  assert.equal(!done.ok && done.error.code, "forbidden");
  assert.deepEqual(t.sent, []);
  assert.deepEqual(t.records, []);
});
