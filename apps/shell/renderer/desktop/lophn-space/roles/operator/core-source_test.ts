// Operator 통로(shell#T54). 부른 route·입력·비교 기준이 contract route의 schema를 그대로 통과하는지와,
// 승인 요청이 고정하는 지문이 platform과 같은 규칙인지, core의 답을 화면 모양으로 옮기는 것을 가짜
// core 위에서 본다.
import { assert, assertEquals } from "@std/assert";

import { ALL_ROUTES } from "../../../../../../../packages/contracts/mod.ts";
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
const VER = "ver_01h455vb4pex5v6nkc6gd5fd01";
const APR = "apr_01h455vb4pex5v6nkc6gd5fd01";
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
