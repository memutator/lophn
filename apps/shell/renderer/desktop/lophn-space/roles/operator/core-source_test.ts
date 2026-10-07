// Operator 통로(shell#T54). 부른 route·입력·비교 기준이 contract route의 schema를 그대로 통과하는지와,
// 승인 요청이 고정하는 지문이 platform과 같은 규칙인지, core의 답을 화면 모양으로 옮기는 것을 가짜
// core 위에서 본다.
import { assert, assertEquals } from "@std/assert";

import { fingerprint } from "../../../../../../../packages/base/mod.ts";
import { ALL_ROUTES } from "../../../../../../../packages/contracts/mod.ts";
import { approvalBindingHash } from "../../../../../../../packages/contracts/platform/approvals.ts";
import { confirmationOpenIntentSchema } from "../../../../../../../packages/contracts/shell/confirmation.ts";
import type { CoreCall } from "../../../../../ipc/core.ts";
import type { CoreReply } from "../../../../../ipc/core-api.ts";
import type { CoreSource } from "../../../connection/connection.ts";
import { coreRolesSource, factsOf, presetOf } from "../core-source.ts";
import type { PresetEntry, RoleRow } from "../source.ts";
import type { OperatorDraft } from "./source.ts";

const ASG = "asg_01h455vb4pex5v6nkc6gd5fd04";
const PST = "pst_01h455vb4pex5v6nkc6gd5fd03";
const PRJ = "prj_01h455vb4pex5v6nkc6gd5fd01";
const APP = "app_01h455vb4pex5v6nkc6gd5fd01";
const DOC = "doc_01h455vb4pex5v6nkc6gd5fd01";
const DOC_TWO = "doc_01h455vb4pex5v6nkc6gd5fd02";
const DOC_THREE = "doc_01h455vb4pex5v6nkc6gd5fd03";
const DOC_FOUR = "doc_01h455vb4pex5v6nkc6gd5fd04";
const VER = "ver_01h455vb4pex5v6nkc6gd5fd01";
const APR = "apr_01h455vb4pex5v6nkc6gd5fd01";
const RUN = "run_01h455vb4pex5v6nkc6gd5fd01";
const RUN_DONE = "run_01h455vb4pex5v6nkc6gd5fd02";
const NOW = Date.parse("2026-10-07T00:00:00.000Z");
const HASH = "c".repeat(64);

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
    const body = call.body as { input?: unknown; compare?: unknown };
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

const entry: PresetEntry = presetOf({
  id: PST,
  revision: 2,
  definition_hash: HASH,
  definition: {
    kind: "operator",
    name: "Operator",
    origin: "product",
    prompt: "a".repeat(64),
    capability: { bundles: [], tools: [] },
    context: [{ kind: "assignment_scope", target: null, section: null }],
    mcp: { servers: [], tools: [] },
    safe_tools: [],
    skills: [],
    model: null,
    organizing_model: null,
    instructions: [],
  },
});

function role(over: Partial<RoleRow> = {}): RoleRow {
  return {
    id: ASG,
    role: "operator",
    state: "enabled",
    revision: 4,
    scope: { kind: "project", id: PRJ },
    preset: { id: PST, revision: 1 },
    presetName: "Operator",
    outputs: [DOC],
    ...over,
  };
}

function draft(over: Partial<OperatorDraft> = {}): OperatorDraft {
  return {
    change: null,
    scope: { kind: "project", id: PRJ },
    preset: entry,
    outputs: [{ document: DOC, content: "What changed", version: VER }],
    reads: [{ app: APP, command: "list_items" }],
    period: { firstAt: "2026-10-08T00:00:00.000Z", everyMs: 86_400_000 },
    ...over,
  };
}

function sourceOf(
  fake: Fake,
  openDecision: ((intent: unknown) => Promise<unknown>) | undefined,
) {
  return coreRolesSource(fake.core, {
    picker: undefined,
    openDecision,
    now: () => NOW,
    random: () => "r1",
  }).operator;
}

const created = (body: unknown) => {
  const input = (body as { input: { id: string } }).input;
  return ok({ request: { id: input.id, created_seq: "7" } });
};

Deno.test("lophn-agent/assignments#R5: 붙이기는 구성 전체를 승인 요청으로 고정하고(적용 command의 입력 schema·platform의 지문 규칙을 그대로 통과) 보호 확인 창을 approval_request로 연다", async () => {
  const fake = fakeCore({ "command:approvals/create": created });
  const intents: unknown[] = [];
  const operator = sourceOf(fake, (intent) => {
    intents.push(intent);
    return Promise.resolve({ windowId: "win-1" });
  });
  const proposed = await operator.propose(draft());
  assert(proposed.ok);
  assertValid(fake.calls);
  const input = (fake.calls[0]!.body as {
    input: {
      id: string;
      requester: string;
      action: {
        concern: string;
        command: string;
        caller: string;
        input: { kind: string; value: Record<string, unknown> };
        input_hash: string;
        binding_hash: string;
        targets: string[];
        comparison: object;
      };
    };
  }).input;
  const action = input.action;
  assertEquals(action.concern, "lophn-agent/assignments");
  assertEquals(action.command, "ApplyOperatorAssignment");
  assertEquals(action.caller, "user");
  // 적용 command가 받는 입력 그대로이고 approval·대상이 이 요청과 맞는다.
  assert(
    route("command", "assignments", "apply-operator").input.safeParse(
      action.input.value,
    ).success,
  );
  assertEquals(action.input.value.approval, input.id);
  assertEquals(proposed.value.approval, input.id);
  assertEquals(action.targets, [proposed.value.assignment]);
  assertEquals(action.input.value.id, proposed.value.assignment);
  assertEquals(action.input_hash, await fingerprint(action.input.value));
  assertEquals(
    action.binding_hash,
    await approvalBindingHash({ ...action, binding_hash: "0" } as never),
  );
  const bundle = action.input.value.bundle as Record<string, unknown>;
  assertEquals(bundle.assignment, null);
  assertEquals(bundle.expected_assignment_revision, null);
  assertEquals(bundle.preset_definition, HASH);
  assertEquals(bundle.preset_revision, 2);
  assertEquals(bundle.draft_version, VER);
  assertEquals(bundle.read_apps, [APP]);
  assertEquals(bundle.schedule, {
    first_at: "2026-10-08T00:00:00.000Z",
    every_ms: 86_400_000,
  });
  // 창은 승인 요청 하나를 가리킨다. 본문·구성은 창으로 가지 않는다.
  assertEquals(intents.length, 1);
  assert(confirmationOpenIntentSchema.safeParse(intents[0]).success);
  assertEquals(
    (intents[0] as { request: unknown }).request,
    { kind: "approval_request", approval: input.id },
  );
});

Deno.test("lophn-agent/assignments#R5: 이미 붙은 Operator를 바꾸는 승인은 그 assignment와 읽은 revision에 묶이고 창을 열지 못하면 만든 요청을 취소한다", async () => {
  const fake = fakeCore({
    "command:approvals/create": created,
    "command:approvals/cancel": (body) =>
      ok({
        request: {
          id: (body as { input: { approval: string } }).input.approval,
        },
      }),
  });
  const operator = sourceOf(fake, () => Promise.resolve({ code: "internal" }));
  const changed = await operator.propose(draft({ change: role() }));
  assertEquals(changed, { ok: false, code: "internal" });
  assertValid(fake.calls);
  const [create, cancel] = fake.calls;
  const value = (create!.body as {
    input: { action: { input: { value: { id: string; bundle: object } } } };
  }).input.action.input.value;
  assertEquals(value.id, ASG);
  assertEquals(
    (value.bundle as Record<string, unknown>).assignment,
    ASG,
  );
  assertEquals(
    (value.bundle as Record<string, unknown>).expected_assignment_revision,
    4,
  );
  // 아무도 결정할 수 없는 대기 요청이 남지 않는다.
  assertEquals(cancel!.method, "cancel");
  assertEquals(
    (cancel!.body as { compare: unknown }).compare,
    { created_seq: "7" },
  );
});

Deno.test("platform/approvals#R5: 창 연결이 없거나 Preset 판 hash를 모르면 승인 요청을 만들지 않는다", async () => {
  const fake = fakeCore({ "command:approvals/create": created });
  const without = await sourceOf(fake, undefined).propose(draft());
  assertEquals(without, { ok: false, code: "unavailable" });
  const unhashed = await sourceOf(
    fake,
    () => Promise.resolve({ windowId: "w" }),
  )
    .propose(draft({ preset: { ...entry, hash: undefined } }));
  assertEquals(unhashed, { ok: false, code: "invalid_input" });
  assertEquals(fake.calls.length, 0);
});

function approval(status: string, used: boolean) {
  return ok({
    request: {
      status,
      action: {
        concern: "lophn-agent/assignments",
        command: "ApplyOperatorAssignment",
        caller: "user",
        targets: [ASG],
        input: { kind: "inline", value: {} },
        input_hash: HASH,
        comparison: {},
        binding_hash: HASH,
      },
    },
    use: used ? { approval: APR } : null,
  });
}

Deno.test("lophn-agent/assignments#R4: 허락된 승인만 적용하고(한 번만) 대기·거절·취소·만료는 적용하지 않는다", async () => {
  const states: [string, boolean, "waiting" | "declined" | "attached"][] = [
    ["pending", false, "waiting"],
    ["rejected", false, "declined"],
    ["cancelled", false, "declined"],
    ["expired", false, "declined"],
    ["granted", true, "attached"],
    ["granted", false, "attached"],
  ];
  for (const [status, used, expected] of states) {
    const fake = fakeCore({
      "read:approvals/get": () => approval(status, used),
      "command:approvals/apply": () =>
        ok({ use: { approval: APR }, replayed: false }),
    });
    const settled = await sourceOf(fake, undefined).settle({
      approval: APR,
      assignment: ASG,
    });
    assertEquals(settled, { ok: true, value: expected }, `${status}/${used}`);
    assertValid(fake.calls);
    const applies = fake.calls.filter((call) => call.method === "apply");
    assertEquals(applies.length, status === "granted" && !used ? 1 : 0);
  }
  // 허락됐지만 적용이 막히면 실패 코드를 그대로 돌려준다.
  const blocked = fakeCore({
    "read:approvals/get": () => approval("granted", false),
    "command:approvals/apply": () => ({
      ok: false,
      error: { code: "forbidden", message: "x" },
    }),
  });
  assertEquals(
    await sourceOf(blocked, undefined).settle({
      approval: APR,
      assignment: ASG,
    }),
    { ok: false, code: "forbidden" },
  );
});

Deno.test("shell/desktop#R5: 멈춤은 켜진 역할의 revision에 묶이고 회수는 켜짐·멈춤 어느 쪽이든 읽은 상태에 묶이며 회수된 것은 다시 회수하지 않는다", async () => {
  const fake = fakeCore({
    "command:assignments/pause": () => ok({ assignment: {} }),
    "command:assignments/withdraw": () => ok({ assignment: {} }),
  });
  const operator = sourceOf(fake, undefined);
  assertEquals(await operator.pause(role()), { ok: true, value: null });
  assertEquals(await operator.withdraw(role()), { ok: true, value: null });
  assertEquals(
    await operator.withdraw(role({ state: "paused" })),
    { ok: true, value: null },
  );
  assertEquals(
    await operator.withdraw(role({ state: "withdrawn" })),
    { ok: false, code: "conflict" },
  );
  assertValid(fake.calls);
  assertEquals(fake.calls.map((call) => call.method), [
    "pause",
    "withdraw",
    "withdraw",
  ]);
  assertEquals((fake.calls[0]!.body as { compare: unknown }).compare, {
    revision: 4,
    state: "enabled",
  });
  assertEquals((fake.calls[2]!.body as { compare: unknown }).compare, {
    revision: 4,
    state: "paused",
  });
});

Deno.test("lophn-agent/scheduling#R5: 건너뛴 회차는 막은 일이 사람의 답을 기다리는지로 구별하고 건너뛰지 않은 회차는 말하지 않는다", async () => {
  const occurrence = (
    due: string,
    outcome: "accepted" | "skipped",
    blocking: string[],
  ) => ({
    occurrence: {
      due_at: due,
      outcome,
      blocking_runs: blocking,
    },
  });
  const fake = fakeCore({
    "read:assignment-occurrences/list": () =>
      ok({
        occurrences: [
          occurrence("2026-10-04T00:00:00.000Z", "accepted", []),
          occurrence("2026-10-05T00:00:00.000Z", "skipped", [RUN_DONE]),
          occurrence("2026-10-06T00:00:00.000Z", "skipped", [RUN]),
        ],
        next_cursor: null,
      }),
    "read:runs/list": () =>
      ok({
        runs: [
          { id: RUN, state: "waiting_user" },
          { id: RUN_DONE, state: "finished" },
        ],
        next_cursor: null,
      }),
  });
  const skipped = await sourceOf(fake, undefined).skipped(role());
  assertValid(fake.calls);
  assertEquals(skipped, {
    ok: true,
    value: [
      { dueAt: "2026-10-06T00:00:00.000Z", waitingForAnswer: true },
      { dueAt: "2026-10-05T00:00:00.000Z", waitingForAnswer: false },
    ],
  });
  // 건너뛴 회차가 없으면 일 목록을 읽지 않는다.
  const none = fakeCore({
    "read:assignment-occurrences/list": () =>
      ok({ occurrences: [], next_cursor: null }),
  });
  assertEquals(await sourceOf(none, undefined).skipped(role()), {
    ok: true,
    value: [],
  });
  assertEquals(none.calls.length, 1);
});

Deno.test("lophn-agent/assignments#R6: 보고할 문서 후보는 원본 파일에 연결된 문서와 다른 Operator가 쓰는 문서를 빼고 회수된 Operator가 쓰던 문서는 다시 쓸 수 있다", async () => {
  const listed = [DOC, DOC_TWO, DOC_THREE, DOC_FOUR].map((id, index) => ({
    document: { id, title: `Doc ${index}`, status: "active" },
    latest_version: { id: VER },
  }));
  const fake = fakeCore({
    "read:documents/list": () => ok({ documents: listed, next_cursor: null }),
    "read:documents/get": (body) => {
      const id = (body as { document: string }).document;
      return ok({
        document: id === DOC_TWO ? { file_source: { path: "a.md" } } : {},
        version: { id: VER },
      });
    },
    "read:assignments/outputs": (body) => {
      const id = (body as { document: string }).document;
      return ok({
        output: id === DOC_THREE
          ? { assignment: ASG, revision: 1, state: "enabled" }
          : id === DOC_FOUR
          ? { assignment: ASG, revision: 3, state: "withdrawn" }
          : null,
      });
    },
  });
  const choices = await sourceOf(fake, undefined).outputChoices({
    kind: "project",
    id: PRJ,
  });
  assertValid(fake.calls);
  assertEquals(choices, {
    ok: true,
    value: [
      { id: DOC, title: "Doc 0", version: VER },
      { id: DOC_FOUR, title: "Doc 3", version: VER },
    ],
  });
});

Deno.test("lophn-agent/assignments#R5: 읽게 할 수 있는 앱 명령은 확인이 필요 없는 읽기뿐이고 문서의 지금 판을 읽는다", async () => {
  const fake = fakeCore({
    "read:apps/blueprint": () =>
      ok({
        commands: [
          {
            key: "list_items",
            label: "List items",
            effect: "read",
            confirm: false,
          },
          {
            key: "add_item",
            label: "Add item",
            effect: "write",
            confirm: false,
          },
          {
            key: "export_all",
            label: "Export all",
            effect: "read",
            confirm: true,
          },
        ],
      }),
    "read:documents/get": () => ok({ document: {}, version: { id: VER } }),
    "read:presets/list": () =>
      ok({
        presets: [{
          id: PST,
          revision: 2,
          definition_hash: HASH,
          definition: entry.definition.raw,
        }],
        next_cursor: null,
      }),
  });
  const operator = sourceOf(fake, undefined);
  assertEquals(await operator.readChoices(APP), {
    ok: true,
    value: [{ app: APP, command: "list_items", label: "List items" }],
  });
  assertEquals(await operator.versionOf(DOC), { ok: true, value: VER });
  const presets = await operator.presets();
  assert(presets.ok);
  assertEquals(presets.value[0]!.hash, HASH);
  assertValid(fake.calls);
  assertEquals(
    (fake.calls[2]!.body as { kind: string }).kind,
    "operator",
  );
});

Deno.test("shell/desktop#R5: 역할 목록은 Operator의 주기·읽는 앱·멈춘 이유를 담고 다른 역할에는 담지 않는다", () => {
  const base = {
    id: ASG,
    scope: { kind: "project", id: PRJ },
    state: "paused",
    preset: PST,
    preset_revision: 1,
    revision: 3,
    outputs: [{ document: DOC, content: "What changed" }],
    read_apps: [APP],
    read_commands: [{ app: APP, command: "list_items" }],
    schedule: { first_at: "2026-10-08T00:00:00.000Z", every_ms: 3_600_000 },
    last_due_at: "2026-10-06T00:00:00.000Z",
    pause_reason: { kind: "consecutive_failures", detail: "three failures" },
  };
  assertEquals(factsOf({ ...base, role: "operator" } as never), {
    schedule: { firstAt: "2026-10-08T00:00:00.000Z", everyMs: 3_600_000 },
    lastDueAt: "2026-10-06T00:00:00.000Z",
    outputs: [{ document: DOC, content: "What changed" }],
    readApps: [APP],
    readCommands: [{ app: APP, command: "list_items" }],
    pause: { kind: "consecutive_failures", detail: "three failures" },
  });
  assertEquals(factsOf({ ...base, role: "app_engineer" } as never), null);
});
