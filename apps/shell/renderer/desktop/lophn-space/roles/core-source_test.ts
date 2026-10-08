// roles 통로(shell#T30). 부른 route·입력·비교 기준이 contract route의 schema를 그대로 통과하는지와,
// core의 답을 화면 모양으로 옮기는 것을 가짜 core 위에서 본다. 본문은 `runs/body-view`로만 읽는다.
import { assert, assertEquals } from "@std/assert";

import { ALL_ROUTES } from "../../../../../../packages/contracts/mod.ts";
import type { CoreCall } from "../../../../ipc/core.ts";
import type { CoreReply } from "../../../../ipc/core-api.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { coreRolesSource, definitionOf, presetOf } from "./core-source.ts";
import type { PresetDefinition, RoleRow, WorkRow } from "./source.ts";

const ASG = "asg_01h455vb4pex5v6nkc6gd5fd01";
const PST = "pst_01h455vb4pex5v6nkc6gd5fd01";
const PVD = "pvd_01h455vb4pex5v6nkc6gd5fd01";
const APP = "app_01h455vb4pex5v6nkc6gd5fd01";
const SES = "ses_01h455vb4pex5v6nkc6gd5fd01";
const MSG = "msg_01h455vb4pex5v6nkc6gd5fd01";
const RUN = "run_01h455vb4pex5v6nkc6gd5fd01";
const RUN_NEXT = "run_01h455vb4pex5v6nkc6gd5fd02";
const TCL = "tcl_01h455vb4pex5v6nkc6gd5fd01";
const MCL = "mcl_01h455vb4pex5v6nkc6gd5fd01";
const NOW = Date.parse("2026-10-07T00:00:00.000Z");

interface Fake {
  readonly core: CoreSource;
  readonly calls: CoreCall[];
}

function fakeCore(
  answers: Record<string, (body: unknown) => CoreReply>,
): Fake {
  const calls: CoreCall[] = [];
  return {
    calls,
    core: {
      subscribe: () => () => {},
      call(input) {
        calls.push(input);
        const key = `${input.kind}:${input.resource}/${input.method}`;
        const answer = answers[key];
        return Promise.resolve(
          answer === undefined
            ? { ok: false, error: { code: "not_found", message: key } }
            : answer(input.body),
        );
      },
    },
  };
}

const ok = (value: unknown): CoreReply => ({ ok: true, value });

type Schema = { safeParse(value: unknown): { success: boolean } };

function route(kind: string, resource: string, method: string) {
  const found = ALL_ROUTES.find((candidate) =>
    candidate.kind === kind && candidate.resource === resource &&
    candidate.method === method
  );
  assert(found !== undefined, `no route ${kind}:${resource}/${method}`);
  return found as unknown as { input: Schema; compare?: Schema };
}

/** 부른 것마다 contract의 입력(과 비교 기준) schema를 통과하는지 센다. */
function assertValid(calls: readonly CoreCall[]) {
  assert(calls.length > 0);
  for (const call of calls) {
    const found = route(call.kind, call.resource, call.method);
    const body = call.body as {
      input?: unknown;
      compare?: unknown;
    };
    const label = `${call.kind}:${call.resource}/${call.method}`;
    if (call.kind === "command") {
      assert(found.input.safeParse(body.input).success, `${label} input`);
      if (found.compare !== undefined) {
        assert(
          found.compare.safeParse(body.compare).success,
          `${label} compare`,
        );
      }
    } else {
      assert(found.input.safeParse(call.body).success, `${label} input`);
    }
  }
}

const OPTIONS = {
  picker: undefined,
  openDecision: undefined,
  now: () => NOW,
  random: () => "r1",
};

function assignment(over: object = {}) {
  return {
    id: ASG,
    role: "app_engineer",
    scope: { kind: "app", id: APP },
    state: "enabled",
    preset: PST,
    preset_revision: 2,
    outputs: [],
    revision: 5,
    ...over,
  };
}

function presetValue(over: object = {}, definition: object = {}) {
  return {
    id: PST,
    revision: 2,
    definition_hash: "d".repeat(64),
    definition: {
      kind: "app_engineer",
      name: "App Engineer",
      origin: "product",
      prompt: "a".repeat(64),
      capability: { bundles: [{ name: "documents", revision: 1 }], tools: [] },
      context: [{ kind: "all", target: null, section: null }],
      mcp: { servers: [], tools: [] },
      safe_tools: [],
      skills: [],
      model: {
        provider: PVD,
        credentials: ["main"],
        model_name: "claude-a",
        reasoning_level: "medium",
        options: {},
      },
      organizing_model: null,
      instructions: [],
      ...definition,
    },
    ...over,
  };
}

function runValue(id: string, over: object = {}) {
  return {
    id,
    session: SES,
    state: "finished",
    source: { kind: "message", message: MSG },
    start_after: null,
    start_confirmed_seq: null,
    started_at: "2026-10-06T08:00:00.000Z",
    finished_at: "2026-10-06T08:05:00.000Z",
    outcome: { kind: "failed", reason: "model_error" },
    state_seq: "12",
    accepted_seq: "3",
    ...over,
  };
}

const ROLE: RoleRow = {
  id: ASG,
  role: "app_engineer",
  state: "enabled",
  revision: 5,
  scope: { kind: "app", id: APP },
  preset: { id: PST, revision: 2 },
  presetName: "App Engineer",
  outputs: [],
};

Deno.test("shell/desktop#R4: 역할 목록은 assignments와 presets를 읽어 역할·범위·Preset 이름으로 옮기고 읽기 입력은 route schema를 통과한다", async () => {
  const { core, calls } = fakeCore({
    "read:assignments/list": () =>
      ok({
        assignments: [assignment({ outputs: [{ document: "doc_x" }] })],
        next_cursor: null,
      }),
    "read:presets/list": () =>
      ok({ presets: [presetValue()], next_cursor: null }),
  });
  const source = coreRolesSource(core, OPTIONS);
  const roles = await source.roles();
  assert(roles.ok);
  assertEquals(roles.value, [{
    id: ASG,
    role: "app_engineer",
    state: "enabled",
    revision: 5,
    scope: { kind: "app", id: APP },
    preset: { id: PST, revision: 2 },
    presetName: "App Engineer",
    outputs: ["doc_x"],
    operator: null,
  }]);
  assertValid(calls);
});

Deno.test("shell/desktop#R5: 하는 일은 담당의 일을 읽고 앞선 일이 멈춘 일만 다시 시작 대상으로 만들며 다시 시작·멈추기·재개의 입력과 비교 기준이 route schema를 통과한다", async () => {
  const { core, calls } = fakeCore({
    "read:runs/list": () =>
      ok({
        runs: [
          runValue(RUN),
          runValue(RUN_NEXT, {
            state: "accepted",
            start_after: RUN,
            started_at: null,
            finished_at: null,
            outcome: null,
            state_seq: "20",
            accepted_seq: "19",
          }),
        ],
        next_cursor: null,
      }),
    "command:runs/confirm-next": () =>
      ok({
        id: RUN_NEXT,
        predecessor: RUN,
        start_confirmed_seq: "22",
        state: "accepted",
      }),
    "command:runs/stop": () => ok({}),
    "command:assignments/resume": () => ok({ assignment: {} }),
  });
  const source = coreRolesSource(core, OPTIONS);
  const works = await source.works(ROLE);
  assert(works.ok);
  const next = works.value.find((item) => item.id === RUN_NEXT)!;
  assertEquals(next.after, { id: RUN, stateSeq: "12", stopped: true });
  assertEquals(next.origin, "message");
  assertEquals(works.value.find((item) => item.id === RUN)!.after, null);
  assert((await source.restart(next)).ok);
  assert((await source.stop(works.value[0] as WorkRow, "stop-1")).ok);
  assert((await source.resume({ ...ROLE, state: "paused" })).ok);
  const confirm = calls.find((call) => call.method === "confirm-next")!;
  assertEquals((confirm.body as { compare: unknown }).compare, {
    accepted_seq: "19",
    predecessor_state_seq: "12",
  });
  assertValid(calls);
  // 앞선 일이 없는 일은 다시 시작할 수 없다.
  const refused = await source.restart(
    works.value.find((item) => item.id === RUN)!,
  );
  assertEquals(refused, { ok: false, code: "invalid_input" });
});

Deno.test("lophn-agent/observability#R20: 작업 검토는 trace·도구 단계·model 호출·사용량·본문을 읽어 화면 모양으로 옮기고 본문은 사람 전용 읽기로만 연다", async () => {
  const toolValue = (over: object) => ({
    id: TCL,
    run: RUN,
    model_call: MCL,
    tool: "document.create",
    effect: "write",
    app_command: null,
    extension: null,
    input: "i".repeat(64),
    output: "o".repeat(64),
    state: "finished",
    started_at: "2026-10-06T08:01:00.000Z",
    duration_ms: 90,
    outcome: { kind: "success", code: "ok" },
    decision: { decision: "allow", reason: "Allowed.", approval: null },
    ...over,
  });
  const { core, calls } = fakeCore({
    "read:agent-traces/read": () =>
      ok({
        trace: {
          run: RUN,
          session: SES,
          assignment: ASG,
          state: "finished",
          started_at: "2026-10-06T08:00:00.000Z",
          finished_at: "2026-10-06T08:05:00.000Z",
          basis: "b".repeat(64),
          events: ["1"],
          messages: [MSG],
          model_calls: [MCL],
          tool_calls: [TCL],
          handoff_links: [],
          activity: {
            model: {
              attempts: 1,
              failed: [],
              partial: [],
              cancelled: [],
              uncertain: [],
              unfinished: [],
            },
            tools: {
              steps: 2,
              succeeded: 1,
              failed: [],
              denied: [TCL],
              not_executed: [],
              uncertain: [],
              unfinished: [],
              external: [],
            },
          },
          times: { wall_ms: 10, active_ms: 8, waiting_ms: 2 },
          reason: { kind: "completed", reason: "answer_completed" },
          missing: [{
            kind: "body",
            reference: "x",
            reason: "reference_not_registered",
          }],
        },
      }),
    "read:tool-calls/list": () =>
      ok({
        tool_calls: [
          toolValue({}),
          toolValue({
            id: "tcl_01h455vb4pex5v6nkc6gd5fd02",
            outcome: { kind: "not_executed", code: "denied" },
            output: null,
            decision: {
              decision: "deny",
              reason: "Not allowed here.",
              approval: null,
            },
            extension: { server_name: "files", original_tool: "read_file" },
          }),
        ],
        next_cursor: null,
      }),
    "read:model-calls/list": () =>
      ok({
        calls: [{
          id: MCL,
          attempt_order: 1,
          model: { name: "claude-a", billing_route: "api" },
          state: "finished",
          started_at: "2026-10-06T08:00:00.000Z",
          duration_ms: 900,
          outcome: { kind: "complete" },
          usage: { input: 10, output: 5, cache_read: null, cache_write: null },
          cost: { kind: "reported", amount: "0.01", currency: "USD" },
        }],
        next_cursor: null,
      }),
    "read:agent-usage/read": () =>
      ok({
        totals: [{
          calls: 1,
          costs: [{
            kind: "reported",
            amount: "0.01",
            currency: "USD",
            calls: 1,
          }],
          complete: true,
        }],
      }),
    "read:runs/body-view": (body) =>
      (body as { kind: string }).kind === "tool_call_output"
        ? ok({ value: { summary: "done" }, truncated: false })
        : { ok: false, error: { code: "unavailable", message: "x" } },
  });
  const source = coreRolesSource(core, OPTIONS);
  const traced = await source.trace(RUN);
  assert(traced.ok);
  assertEquals(traced.value.tools.denied, [TCL]);
  assertEquals(traced.value.outcome, {
    kind: "completed",
    reason: "answer_completed",
  });
  assertEquals(traced.value.activeMs, 8);
  const steps = await source.steps(RUN);
  assert(steps.ok);
  assertEquals(
    steps.value.map((step) => [step.outcome, step.source, step.decision?.kind]),
    [
      ["success", "tool", "allow"],
      ["not_executed", "outside", "deny"],
    ],
  );
  const attempts = await source.attempts(RUN);
  assert(attempts.ok);
  assertEquals(attempts.value[0]!.cost, {
    kind: "reported",
    amount: "0.01",
    currency: "USD",
  });
  assertEquals(attempts.value[0]!.usage.cacheRead, null);
  const usage = await source.usage(RUN);
  assert(usage.ok);
  assertEquals(usage.value.costs[0]!.amount, "0.01");
  const body = await source.body("tool_call_output", TCL);
  assert(body.ok);
  assertEquals(body.value, { value: { summary: "done" }, truncated: false });
  const absent = await source.body("run_basis", RUN);
  assertEquals(absent, { ok: false, code: "unavailable" });
  assertValid(calls);
  // 사람 화면은 machine 전용 ReadRunBody가 아니라 사람 전용 읽기만 부른다.
  assertEquals(calls.filter((call) => call.method === "body").length, 0);
});

Deno.test("lophn-agent/observability#R16: export는 폴더를 사람이 고른 뒤 고른 내용 종류만 보내고 결과 수를 돌려주며 그만두면 아무것도 부르지 않는다", async () => {
  const { core, calls } = fakeCore({
    "command:agent-traces/export": () =>
      ok({ sent: 4, not_sent: 1, errors: [] }),
  });
  const source = coreRolesSource(core, {
    ...OPTIONS,
    picker: {
      pick: () => Promise.resolve({ ok: true, path: "/home/me/out/" }),
    },
  });
  const exported = await source.exportTrace(RUN, ["message", "tool_output"]);
  assertEquals(exported, { ok: true, value: { sent: 4, notSent: 1 } });
  const input = (calls[0]!.body as {
    input: { destination: string; content_kinds: string[] };
  }).input;
  assertEquals(input.destination, `/home/me/out/lophn-work-${RUN}.ndjson`);
  assertEquals(input.content_kinds, ["message", "tool_output"]);
  assertValid(calls);
  // 기본은 메타데이터뿐이다.
  await source.exportTrace(RUN, []);
  assertEquals(
    (calls[1]!.body as { input: { content_kinds: string[] } }).input
      .content_kinds,
    [],
  );
  const cancelled = fakeCore({});
  const none = coreRolesSource(cancelled.core, {
    ...OPTIONS,
    picker: { pick: () => Promise.resolve({ ok: true, path: null }) },
  });
  assertEquals(await none.exportTrace(RUN, []), { ok: true, value: null });
  assertEquals(cancelled.calls.length, 0);
});

Deno.test("lophn-agent/revert#R6: 되돌리기는 확인 창에 RevertRun과 그 일만 가리키고 창을 못 열면 아무것도 바뀌지 않았다고 돌려준다", async () => {
  const opened: unknown[] = [];
  const { core } = fakeCore({});
  const source = coreRolesSource(core, {
    ...OPTIONS,
    openDecision: (intent) => {
      opened.push(intent);
      return Promise.resolve({ windowId: "w1" });
    },
  });
  assertEquals(await source.undo(RUN), { ok: true });
  assertEquals(opened, [{
    request: {
      kind: "owner_decision",
      concern: "lophn-agent/revert",
      decision: "RevertRun",
      targets: [RUN],
    },
    parentWindow: "requesting-window",
  }]);
  const closed = coreRolesSource(core, { ...OPTIONS, openDecision: undefined });
  assertEquals(await closed.undo(RUN), { ok: false, code: "unavailable" });
});

Deno.test("lophn-agent/presets#R11: Preset 저장은 기본이면 사본 만들기, 사람이 만든 것이면 같은 Preset의 새 판이고 적용은 따로이며 입력과 비교 기준이 route schema를 통과한다", async () => {
  const product = presetOf(presetValue() as never);
  const mine = presetOf(
    presetValue({ id: "pst_01h455vb4pex5v6nkc6gd5fd02", revision: 4 }, {
      origin: "user",
    }) as never,
  );
  const { core, calls } = fakeCore({
    "command:presets/create": (body) => {
      const input =
        (body as { input: { id: string; definition: object } }).input;
      return ok({
        preset: {
          ...presetValue({ id: input.id, revision: 1 }),
          definition: input.definition,
        },
      });
    },
    "command:presets/revise": () =>
      ok({ preset: presetValue({ revision: 5 }, { origin: "user" }) }),
    "command:assignments/change-preset": () => ok({ assignment: {} }),
  });
  const source = coreRolesSource(core, OPTIONS);
  const edited: PresetDefinition = {
    ...product.definition,
    name: "Careful",
    skills: ["pdf-tools"],
    servers: ["files"],
    tools: [{ server: "files", tool: "read_file" }, {
      server: "other",
      tool: "x",
    }],
    decisions: {
      ...product.definition.decisions!,
      accounts: ["spare", "main"],
    },
  };
  const copied = await source.savePreset(ROLE, product, edited, "ignored");
  assert(copied.ok);
  assertEquals(copied.value.revision, 1);
  const create = calls.find((call) => call.method === "create")!;
  const created = (create.body as {
    input: { definition: Record<string, unknown>; copied_from: unknown };
  }).input;
  // 사본이다: 사람 Preset이고 원본 판을 가리킨다. 고치지 않은 prompt·capability는 원본 그대로다.
  assertEquals(created.definition["origin"], "user");
  assertEquals(created.copied_from, { preset: PST, revision: 2 });
  assertEquals(created.definition["prompt"], "a".repeat(64));
  assertEquals(created.definition["skills"], ["pdf-tools"]);
  assertEquals(created.definition["mcp"], {
    servers: ["files"],
    tools: [{ server_name: "files", original_tool: "read_file" }],
  });
  assertEquals(
    (created.definition["model"] as {
      credentials: string[];
      reasoning_level: string;
    }).credentials,
    ["spare", "main"],
  );
  assertEquals(
    (created.definition["model"] as { reasoning_level: string })
      .reasoning_level,
    "medium",
  );
  const revised = await source.savePreset(ROLE, mine, {
    ...mine.definition,
    name: "Mine v5",
  }, "Tidied");
  assert(revised.ok);
  assertEquals(revised.value.revision, 5);
  const revise = calls.find((call) => call.method === "revise")!;
  assertEquals((revise.body as { compare: unknown }).compare, { revision: 4 });
  assert((await source.applyPreset(ROLE, PST, 2)).ok);
  const applied = calls.find((call) => call.method === "change-preset")!;
  assertEquals((applied.body as { compare: unknown }).compare, {
    revision: 5,
    role: "app_engineer",
  });
  assertValid(calls);
  // 정의로 되돌려도 고치지 않은 자리가 그대로다.
  assertEquals(definitionOf(product.definition).prompt, "a".repeat(64));
});

Deno.test("lophn-agent/extensions#R27: 선택지는 연결의 계정을 순서대로, MCP server의 분류된 tool만 읽고 model 이름은 catalog에서 읽는다", async () => {
  const { core, calls } = fakeCore({
    "read:providers/list": () =>
      ok({
        providers: [{
          id: PVD,
          name: "Claude",
          definition: { key: "anthropic" },
          credentials: [
            { key: "spare", label: "Spare", order: 1 },
            { key: "main", label: "Main", order: 0 },
          ],
        }],
        next_cursor: null,
      }),
    "read:settings/get": () =>
      ok({
        settings: [{
          key: "lophn-agent.extensions.mcp_servers",
          value: [{
            name: "files",
            enabled: true,
            classifications: { write_file: {}, read_file: {} },
          }],
        }],
      }),
    "read:agent-model-catalog/read": () =>
      ok({
        entries: [{ model_name: "b" }, { model_name: "a" }, {
          model_name: "a",
        }],
      }),
    "read:presets/list": () =>
      ok({ presets: [presetValue()], next_cursor: null }),
  });
  const source = coreRolesSource(core, OPTIONS);
  const choices = await source.choices();
  assert(choices.ok);
  assertEquals(choices.value.connections[0]!.accounts.map((item) => item.key), [
    "main",
    "spare",
  ]);
  assertEquals(choices.value.servers, [{
    name: "files",
    enabled: true,
    tools: ["read_file", "write_file"],
  }]);
  assertEquals(await source.models("anthropic"), {
    ok: true,
    value: ["a", "b"],
  });
  const presets = await source.presets(ROLE);
  assert(presets.ok);
  assertEquals(presets.value[0]!.definition.decisions?.accounts, ["main"]);
  assertValid(calls);
});

Deno.test("shell/desktop#R4: 대화 통로는 역할의 담당을 가리키고 새 대화는 그 역할로 열며 회수된 담당의 상태를 그대로 넘긴다", async () => {
  const { core, calls } = fakeCore({
    "read:sessions/list": () => ok({ sessions: [], next_cursor: null }),
    "command:sessions/open": () =>
      ok({ id: SES, state: "open", state_seq: "30" }),
  });
  const source = coreRolesSource(core, OPTIONS);
  const withdrawn = { ...ROLE, state: "withdrawn" as const };
  const conversation = source.conversation(withdrawn);
  const agent = await conversation.agent();
  assertEquals(agent, {
    ok: true,
    value: { id: ASG, state: "withdrawn", revision: 5, role: "app_engineer" },
  });
  await conversation.openSession({
    id: SES,
    agent: agent.ok && agent.value !== null ? agent.value : ROLE as never,
    workPlace: { kind: "app", id: APP },
  });
  const open = calls.find((call) => call.method === "open")!;
  assertEquals(
    (open.body as { input: { role: string } }).input.role,
    "app_engineer",
  );
});
