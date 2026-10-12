// Tasks 통로(shell#T50). 부른 route·입력·비교 기준이 contract route schema를 그대로 통과하는지, 사람 credential로
// 가는 command만 쓰는지, main IPC 입력이 contracts의 값 모양과 맞는지를 가짜 core 위에서 본다.
import { assert, assertEquals } from "@std/assert";

import { ALL_ROUTES } from "../../../../../protocol/mod.ts";
import {
  commandRequestSchema,
  type Route,
} from "../../../../../protocol/platform/mod.ts";
import {
  connectionIdSchema,
  harnessIdSchema,
  ticketIdSchema,
} from "../../../../../protocol/coding-agent/mod.ts";
import { projectIdSchema } from "../../../../../protocol/projects/values.ts";
import { seqSchema } from "../../../../../protocol/platform/mod.ts";
import type { CodingApi, CodingReply } from "../../../../ipc/coding.ts";
import type { CoreCall } from "../../../../ipc/core.ts";
import type { CoreReply } from "../../../../ipc/core-api.ts";
import type { CoreSource } from "../../../desktop/connection/connection.ts";
import { coreTasksSource } from "./core-source.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fd01";
const TKT = "tkt_01h455vb4pex5v6nkc6gd5fd01";
const CAC = "cac_01h455vb4pex5v6nkc6gd5fd01";
const CAC_OTHER_APP = "cac_01h455vb4pex5v6nkc6gd5fd02";
const PRJ = "prj_01h455vb4pex5v6nkc6gd5fd01";

function fakeCore(answers: Record<string, (body: unknown) => CoreReply>) {
  const calls: CoreCall[] = [];
  const core: CoreSource = {
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
  };
  return { core, calls };
}

const ok = (value: unknown): CoreReply => ({ ok: true, value });
const ok_ = <T>(value: T): CodingReply<T> => ({ ok: true, value });

function summary(over: Record<string, unknown> = {}) {
  return {
    id: TKT,
    app: APP,
    kind: "implementation",
    title: "Add a thing",
    request: "add a thing to the app",
    problem_count: 1,
    screen_state: "ready",
    next_action: "start",
    ...over,
  };
}

function screenDetail(over: Record<string, unknown> = {}) {
  return {
    ...summary(),
    why: "because",
    needs: [],
    problems: [],
    inspect: [],
    preserve: [],
    claim: null,
    conditions: [{
      position: 0,
      kind: "app_test",
      input: { kind: "app_test" },
      condition_hash: "a".repeat(64),
    }],
    completion: null,
    checks: [],
    remaining: [],
    revision: "12",
    ...over,
  };
}

function route(kind: string, resource: string, method: string) {
  const found = ALL_ROUTES.find((candidate) =>
    candidate.kind === kind && candidate.resource === resource &&
    candidate.method === method
  );
  assert(found !== undefined, `${resource}/${method} is a route`);
  return found as unknown as Route & {
    input: { safeParse(value: unknown): { success: boolean } };
  };
}

Deno.test("coding-agent#T27: 목록과 상세는 화면 read의 상태·다음 행동 값을 그대로 옮기고 입력은 route schema를 통과한다", async () => {
  const { core, calls } = fakeCore({
    "read:tickets/screen_list": (body) =>
      (body as { cursor?: string }).cursor === undefined
        ? ok({
          tickets: [summary()],
          as_of_seq: "5",
          next_cursor: "c1",
        })
        : ok({
          tickets: [summary({
            id: "tkt_01h455vb4pex5v6nkc6gd5fd02",
            screen_state: "in_progress",
            next_action: null,
          })],
          as_of_seq: "5",
          next_cursor: null,
        }),
    "read:tickets/screen_detail": () =>
      ok({
        ticket: screenDetail({
          screen_state: "reported",
          next_action: "waiting_for_approval",
          claim: {
            connection: CAC,
            claim_seq: "3",
            expires_at: "2026-10-07T12:45:00Z",
          },
          completion: { seq: "9", release: "rel_01h455vb4pex5v6nkc6gd5fd01" },
          checks: [{
            condition: 0,
            result: "inconclusive",
            reason: "not run",
            verification: null,
          }],
          remaining: [0],
        }),
        as_of_seq: "5",
        next_cursor: null,
      }),
  });
  const source = coreTasksSource(core, { coding: undefined });
  const listed = await source.list(APP);
  assert(listed.ok);
  assertEquals(listed.value.map((item) => [item.state, item.next]), [
    ["ready", "start"],
    ["in_progress", null],
  ]);
  assertEquals(listed.value[0]?.app, APP);
  const read = await source.get(TKT);
  assert(read.ok);
  assertEquals(read.value.state, "reported");
  assertEquals(read.value.heldUntil, "2026-10-07T12:45:00Z");
  assertEquals(read.value.reported, true);
  assertEquals(read.value.checks, [{ condition: 0, result: "inconclusive" }]);
  assertEquals(read.value.remaining, [0]);
  assertEquals(read.value.revision, "12");
  // 연결 ID·claim 번호는 화면 값에 없다.
  assert(!JSON.stringify(read.value).includes(CAC));
  for (const call of calls) {
    assertEquals(call.kind, "read");
    const found = route(call.kind, call.resource, call.method);
    assert(found.input.safeParse(call.body).success, `${call.method} input`);
  }
});

Deno.test("coding-agent#T25, coding-agent/tickets#R22: 취소는 사람 credential의 CancelTicket에 본 판·사유·같은 판 비교 기준을 실어 보낸다", async () => {
  const { core, calls } = fakeCore({
    "command:tickets/cancel": () => ok({ ticket: TKT, state: "cancelled" }),
  });
  const source = coreTasksSource(core, { coding: undefined, key: () => "k1" });
  const result = await source.cancel(TKT, "12", "I changed my mind.");
  assert(result.ok);
  assertEquals(calls.length, 1);
  const call = calls[0]!;
  assertEquals(call.kind, "command");
  const found = route("command", "tickets", "cancel");
  const parsed = commandRequestSchema(found as never).safeParse(call.body);
  assert(parsed.success, JSON.stringify(parsed));
  assertEquals((call.body as { input: unknown }).input, {
    ticket: TKT,
    base_revision: "12",
    reason: "I changed my mind.",
  });
  // 확인 창 handle이 붙지 않는다(사람이 누르는 것이 허락이다).
  assertEquals("confirmation" in (call.body as object), false);
  assert(!(found as { confirmation?: unknown }).confirmation);
  // 실패 이유는 그대로 올라간다.
  const stale = coreTasksSource(
    fakeCore({}).core,
    { coding: undefined },
  );
  const failed = await stale.cancel(TKT, "11", "x");
  assertEquals(failed, { ok: false, code: "not_found" });
});

Deno.test("coding-agent#T25, flow manage-tickets 1: 생성은 사람 말(제목·원하는 결과·이유)만 담고 가짜 근거·채택·조건 없이 준비 중으로 만든다", async () => {
  const { core, calls } = fakeCore({
    "command:tickets/create": () =>
      ok({
        ticket: TKT,
        state: "open",
        readiness: "needs_confirmation",
        revision: "4",
      }),
  });
  const source = coreTasksSource(core, { coding: undefined, key: () => "k2" });
  const created = await source.create(APP, {
    title: "Add a tag filter",
    what: "Filter receipts by tag.",
    why: "I use tags a lot.",
  });
  assertEquals(created, { ok: true, value: { ticket: TKT } });
  const call = calls[0]!;
  const found = route("command", "tickets", "create");
  const parsed = commandRequestSchema(found as never).safeParse(call.body);
  assert(parsed.success, JSON.stringify(parsed));
  const input = (call.body as { input: Record<string, unknown> }).input;
  assertEquals(input.readiness, "needs_confirmation");
  assertEquals(input.kind, "implementation");
  assertEquals(input.references, []);
  assertEquals(input.conditions, []);
  assertEquals(input.adoption_questions, []);
  assertEquals((input.needs as string[]).length, 1);
  assertEquals(input.app, APP);
});

function codingApi(
  over: Partial<CodingApi> = {},
  starts: unknown[] = [],
): CodingApi {
  return {
    detect: () =>
      Promise.resolve(ok_({
        source: "cached" as const,
        harnesses: [
          {
            harness_id: "claude" as const,
            discovery: "detected" as const,
            version: "1",
            version_result: "verified" as const,
            auth: "verified" as const,
            profile_id: "work",
            observed_at: "2026-10-07T00:00:00.000Z",
            freshness: "fresh" as const,
            executable: "/usr/bin/claude",
            candidates: [],
            probes: [],
          },
          {
            harness_id: "codex" as const,
            discovery: "absent" as const,
            version: null,
            version_result: "unknown" as const,
            auth: "unknown" as const,
            profile_id: null,
            observed_at: "2026-10-07T00:00:00.000Z",
            freshness: "fresh" as const,
            executable: null,
            candidates: [],
            probes: [],
          },
        ],
      })),
    refresh: () => Promise.reject(new Error("no refresh from tasks")),
    connect: () => Promise.reject(new Error("no connect from tasks")),
    folders: () =>
      Promise.resolve(ok_([{
        project: PRJ,
        project_name: "Notes",
        folder_ref: `${PRJ}_0`,
        path: "/work/notes",
      }])),
    start: (click) => {
      starts.push(click);
      return Promise.resolve(ok_({ ok: true as const, runtime_ref: "term_1" }));
    },
    sessions: () =>
      Promise.resolve(ok_([{
        runtime_ref: "term_1",
        ticket: TKT,
        connection: CAC,
        tui: "waiting_input" as const,
        prompt_delivery: "delivered" as const,
      }])),
    ...over,
  };
}

Deno.test("coding-agent/sessions#R1, R4: [Start] 앞 선택지는 감지된 harness·이 앱에 쓸 수 있는 활성 연결·등록 폴더만 모은다", async () => {
  const { core, calls } = fakeCore({
    "read:coding_agent_connections/list": (body) => {
      assertEquals((body as { state?: string }).state, "active");
      return ok({
        connections: [
          {
            id: CAC,
            label: "Desk",
            scope: { kind: "all", app: null },
            state: "active",
          },
          {
            id: CAC_OTHER_APP,
            label: "Other app",
            scope: { kind: "app", app: "app_01h455vb4pex5v6nkc6gd5fd09" },
            state: "active",
          },
          {
            id: "cac_01h455vb4pex5v6nkc6gd5fd03",
            label: "This app",
            scope: { kind: "app", app: APP },
            state: "active",
          },
          {
            id: "cac_01h455vb4pex5v6nkc6gd5fd04",
            label: "Old",
            scope: { kind: "all", app: null },
            state: "revoked",
          },
        ],
        as_of_seq: "5",
        next_cursor: null,
      });
    },
  });
  const source = coreTasksSource(core, { coding: codingApi() });
  const choices = await source.startChoices(APP);
  assert(choices.ok);
  assertEquals(choices.value.harnesses, [{ id: "claude", profile: "work" }]);
  assertEquals(choices.value.connections.map((item) => item.label), [
    "Desk",
    "This app",
  ]);
  assertEquals(choices.value.folders[0]?.folder_ref, `${PRJ}_0`);
  const call = calls[0]!;
  const found = route(call.kind, call.resource, call.method);
  assert(found.input.safeParse(call.body).success);
  // 하나라도 못 읽으면 일부만 보이지 않고 실패다.
  const noFolders = coreTasksSource(core, {
    coding: codingApi({
      folders: () =>
        Promise.resolve({
          ok: false,
          error: { code: "unavailable", message: "x" },
        }),
    }),
  });
  assertEquals(await noFolders.startChoices(APP), {
    ok: false,
    code: "unavailable",
  });
  assertEquals(
    await coreTasksSource(core, { coding: undefined }).startChoices(APP),
    {
      ok: false,
      code: "unavailable",
    },
  );
});

Deno.test("shell/terminal#R4, coding-agent/sessions#R2: 클릭은 사람이 본 값만 main으로 보내고 그 모양이 contracts의 값 규칙을 통과한다", async () => {
  const starts: unknown[] = [];
  const source = coreTasksSource(fakeCore({}).core, {
    coding: codingApi({}, starts),
  });
  const result = await source.start({
    ticket: TKT,
    revision: "12",
    connection: CAC,
    harness: "claude",
    profile: "work",
    project: PRJ,
    folderRef: `${PRJ}_0`,
  });
  assertEquals(result, { ok: true, value: { ok: true } });
  assertEquals(starts, [{
    ticket: TKT,
    ticket_revision: "12",
    connection: CAC,
    harness_id: "claude",
    profile_id: "work",
    project: PRJ,
    folder_ref: `${PRJ}_0`,
  }]);
  const click = starts[0] as Record<string, unknown>;
  assert(ticketIdSchema.safeParse(click.ticket).success);
  assert(seqSchema.safeParse(click.ticket_revision).success);
  assert(connectionIdSchema.safeParse(click.connection).success);
  assert(harnessIdSchema.safeParse(click.harness_id).success);
  assert(projectIdSchema.safeParse(click.project).success);
  // 토큰·경로·cwd는 클릭에 없다.
  assertEquals(Object.keys(click).sort(), [
    "connection",
    "folder_ref",
    "harness_id",
    "profile_id",
    "project",
    "ticket",
    "ticket_revision",
  ]);
});

Deno.test("coding-agent/sessions#R4: 시작이 거절되면 이유와 자기 터미널 안내 여부를 그대로 옮기고 통로가 끊기면 이유 코드만 올린다", async () => {
  const refused = coreTasksSource(fakeCore({}).core, {
    coding: codingApi({
      start: () =>
        Promise.resolve(ok_({
          ok: false as const,
          reason: "plan_refused",
          next: ["x"],
          own_terminal: true,
        })),
    }),
  });
  const press = {
    ticket: TKT,
    revision: "12",
    connection: CAC,
    harness: "claude" as const,
    profile: null,
    project: PRJ,
    folderRef: `${PRJ}_0`,
  };
  assertEquals(await refused.start(press), {
    ok: true,
    value: { ok: false, reason: "plan_refused", ownTerminal: true },
  });
  const forbidden = coreTasksSource(fakeCore({}).core, {
    coding: codingApi({
      start: () =>
        Promise.resolve({
          ok: false,
          error: { code: "forbidden", message: "x" },
        }),
    }),
  });
  assertEquals(await forbidden.start(press), { ok: false, code: "forbidden" });
});

Deno.test("coding-agent/sessions#R6: TUI 상태는 main이 관측한 값을 그대로 옮긴다", async () => {
  const source = coreTasksSource(fakeCore({}).core, { coding: codingApi() });
  assertEquals(await source.sessions(), {
    ok: true,
    value: [{ ticket: TKT, tui: "waiting_input", promptDelivery: "delivered" }],
  });
  assertEquals(
    await coreTasksSource(fakeCore({}).core, { coding: undefined }).sessions(),
    { ok: false, code: "unavailable" },
  );
});
