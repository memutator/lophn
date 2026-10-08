// 앱 개발 op의 공통 실행 테스트다(T21, mcp#R19–R21·R29·R32·R33, cli#R24–R28·R31·R32). core 대신
// route 이름별로 답을 정한 흐름 client와 가짜 앱 통로를 쓴다. 실제 test runner·model provider·
// 앱 process를 부르지 않는다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import type {
  AppDirect,
  AppInvokeOutcome,
  AppInvokeRequest,
} from "./app-direct.ts";
import {
  APP_OP_ROUTES,
  APP_TEST_TIMEOUT_MS,
  humanOnlyReport,
  runAppOp,
} from "./app-ops.ts";
import { fail, scriptedFlow } from "./testing/mod.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const VRF = "vrf_01arz3ndektsv4rrffq69g5fav";
const INV = "inv_01arz3ndektsv4rrffq69g5fav";
const APR = "apr_01arz3ndektsv4rrffq69g5fav";
const TKT = "tkt_01arz3ndektsv4rrffq69g5fav";
const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);
const COMMIT = "c".repeat(40);
const APP_TARGET = {
  scope_kind: "app",
  environment: { kind: "host", identity: "native" },
  profile_id: null,
  harness_id: "claude",
  app: APP,
  app_realpath: "/w/notes",
} as const;

const now = { idempotencyKey: () => "key-0123456789" };
// 기다림을 건너뛰는 설정이다. sleep은 즉시 끝난다.
const fastWait = {
  wait: { budget_ms: 3_000, interval_ms: 1_000 },
  sleep: () => Promise.resolve(),
};

function appRecord(over: Record<string, unknown> = {}) {
  return {
    id: APP,
    slug: "notes",
    name: "Notes",
    description: "메모",
    planning_version: null,
    source_path: null,
    active_release: null,
    revision: "7",
    run_enabled: false,
    status: "active",
    ...over,
  };
}

function direct(
  outcome: AppInvokeOutcome | Error | (() => Promise<never>),
  seen: AppInvokeRequest[] = [],
): AppDirect {
  return {
    invoke(request) {
      seen.push(request);
      if (outcome instanceof Error) {
        return Promise.resolve(err(outcome as never));
      }
      if (typeof outcome === "function") return outcome();
      return Promise.resolve(ok(outcome));
    },
  };
}

Deno.test("coding-agent/mcp-server#R19: 모든 op는 소유 route 하나로만 간다", () => {
  const names = Object.fromEntries(
    Object.entries(APP_OP_ROUTES).map(([op, route]) => [op, route.name]),
  );
  assertEquals(names.list, "app.list");
  assertEquals(names.register, "app.create");
  assertEquals(names.source, "app.connect_source");
  assertEquals(names.validate, "release.prepare_bundle");
  assertEquals(names.release_prepare, "release.prepare_bundle");
  assertEquals(names.test, "RequestTest");
  assertEquals(names.preview_start, "previews.start");
  assertEquals(names.invocations, "invocations.list");
  assertEquals(names.logs, "app.logs");
  // command의 첫 core 요청은 앱 통로를 여는 연결이다.
  assertEquals(names.command, "app.connect");
  // 사람 결정·machine 기록 route를 부르는 op가 없다.
  for (const route of Object.values(APP_OP_ROUTES)) {
    assert(route.actors.includes("coding_agent"), route.name);
  }
});

Deno.test("coding-agent/mcp-server#R19, coding-agent/connection#R4: register는 가벼운 등록이고 거절은 전체 범위 연결 안내와 함께 그대로 전한다", async () => {
  const flow = scriptedFlow({ "app.create": appRecord() });
  const done = await runAppOp({
    op: "register",
    slug: "notes",
    name: "Notes",
    description: "메모",
  }, { client: flow.client, ...now });
  assertEquals(done.isError, undefined);
  assert(done.summary.includes("source·release 없음"));
  assert(done.next[0].includes("source"));
  assertEquals(flow.calls("app.create")[0].compare, {});
  // op는 소유 입력이 아니라 떼어 보낸다.
  assertEquals(flow.calls("app.create")[0].input, {
    slug: "notes",
    name: "Notes",
    description: "메모",
  });

  const refused = scriptedFlow({
    "app.create": fail(
      "forbidden",
      "app registration is a whole-scope request only",
    ),
  });
  const denied = await runAppOp({
    op: "register",
    slug: "notes",
    name: "Notes",
    description: "메모",
  }, { client: refused.client, ...now });
  assertEquals(denied.isError, true);
  assertEquals((denied.data as { code: string }).code, "forbidden");
  assert(denied.next[0].includes("전체 범위 연결"));
});

Deno.test("coding-agent/cli#R25: source 연결은 현재 revision에 CAS하고 register와 따로다", async () => {
  const flow = scriptedFlow({
    "app.get": { app: appRecord() },
    "app.connect_source": appRecord({ source_path: "/work/notes" }),
  });
  const done = await runAppOp({
    op: "source",
    app: APP,
    source_path: "/work/notes",
  }, { client: flow.client, ...now });
  assertEquals(done.isError, undefined);
  assertEquals(flow.calls("app.connect_source")[0].compare, {
    base_revision: "7",
  });
  assertEquals(flow.calls("app.connect_source")[0].input, {
    app: APP,
    source_path: "/work/notes",
  });

  // 범위 밖 앱은 읽기에서 막혀 쓰기에 닿지 않는다.
  const blocked = scriptedFlow({ "app.get": fail("not_found", "없다") });
  const out = await runAppOp({ op: "source", app: APP, source_path: "/x" }, {
    client: blocked.client,
    ...now,
  });
  assertEquals(out.isError, true);
  assertEquals(blocked.calls("app.connect_source").length, 0);
});

Deno.test("coding-agent/mcp-server#R20: validate는 blueprint 구조 검사이고 실제 test result가 아니다", async () => {
  const progress: string[] = [];
  let polls = 0;
  const flow = scriptedFlow({
    "release.prepare_bundle": {
      request_key: "req-1",
      status: "preparing",
      bundle_hash: null,
      blueprint_hash: null,
      manifest: null,
    },
    "release.preparation": () => {
      polls += 1;
      return polls < 2
        ? {
          app: APP,
          request_key: "req-1",
          status: "preparing",
          bundle_hash: null,
          blueprint_hash: null,
          manifest: null,
        }
        : {
          app: APP,
          request_key: "req-1",
          status: "completed",
          bundle_hash: HASH,
          blueprint_hash: OTHER,
          manifest: {
            entrypoint: "main.ts",
            files: [{}, {}],
            sdk_dependencies: [],
          },
        };
    },
  });
  const done = await runAppOp(
    { op: "validate", app: APP, commit: COMMIT, request_key: "req-1" },
    {
      client: flow.client,
      ...now,
      ...fastWait,
      progress: (message) => {
        progress.push(message);
      },
    },
  );
  assertEquals(done.isError, undefined);
  const data = done.data as {
    check: string;
    real_test: boolean;
    files: number;
  };
  assertEquals(data.check, "blueprint_structure");
  assertEquals(data.real_test, false);
  assertEquals(data.files, 2);
  assert(done.summary.includes("test result가 아니다"));
  // 기다리는 동안 알림을 보냈다.
  assert(progress.length >= 1);
  // 다음 조회는 같은 bundle_hash의 실제 test다.
  assert(done.next[0].includes("test"));
});

Deno.test("coding-agent/mcp-server#R19: 준비가 끝나지 않으면 접수와 다음 read를 돌려주고 한도 안에서 멈춘다", async () => {
  let sleeps = 0;
  const flow = scriptedFlow({
    "release.prepare_bundle": {
      request_key: "req-1",
      status: "preparing",
      bundle_hash: null,
      blueprint_hash: null,
      manifest: null,
    },
    "release.preparation": {
      app: APP,
      request_key: "req-1",
      status: "preparing",
      bundle_hash: null,
      blueprint_hash: null,
      manifest: null,
    },
  });
  const done = await runAppOp(
    { op: "validate", app: APP, commit: COMMIT, request_key: "req-1" },
    {
      client: flow.client,
      ...now,
      wait: { budget_ms: 2_000, interval_ms: 1_000 },
      sleep: () => {
        sleeps += 1;
        return Promise.resolve();
      },
    },
  );
  assertEquals(done.isError, undefined);
  assertEquals((done.data as { accepted: boolean }).accepted, true);
  assertEquals(sleeps, 2);
  assert(done.next[0].includes("preparation"));
  // 기다림 한도는 OpenCode 기본 tool timeout 30초보다 짧다.
  const { DEFAULT_WAIT } = await import("./app-ops.ts");
  assert(DEFAULT_WAIT.budget_ms < 30_000);
});

Deno.test("coding-agent/mcp-server#R21: release 준비는 ticket·claim_seq 없이는 core에 닿지 않고 거절한다", async () => {
  const flow = scriptedFlow({});
  const done = await runAppOp({
    op: "release_prepare",
    app: APP,
    commit: COMMIT,
    request_key: "req-1",
  }, { client: flow.client, ...now });
  assertEquals(done.isError, true);
  assertEquals((done.data as { code: string }).code, "invalid_input");
  assert(done.summary.includes("ticket"));
  assertEquals(flow.sent.length, 0);
});

function prepared(verifications: unknown[]) {
  return scriptedFlow({
    "release.prepare_bundle": {
      request_key: "req-1",
      status: "completed",
      bundle_hash: HASH,
      blueprint_hash: OTHER,
      manifest: { entrypoint: "main.ts", files: [], sdk_dependencies: [] },
    },
    ListVerifications: { verifications, next_cursor: null },
  });
}

function verification(over: Record<string, unknown>) {
  return {
    id: VRF,
    kind: "app_test",
    target: { bundle_hash: HASH, release: null },
    result: "pass",
    reason: "통과",
    ...over,
  };
}

const RELEASE_INPUT = {
  op: "release_prepare",
  app: APP,
  commit: COMMIT,
  request_key: "req-1",
  ticket_source: { ticket: TKT, claim_seq: "3" },
};

Deno.test("coding-agent/mcp-server#R20, coding-agent/mcp-server#R21: 같은 묶음 hash의 app test가 없거나 통과하지 못하면 release 준비를 거절한다", async () => {
  const none = prepared([]);
  const missing = await runAppOp(RELEASE_INPUT, {
    client: none.client,
    ...now,
  });
  assertEquals(missing.isError, true);
  assertEquals(
    (missing.data as { prepared_release: boolean }).prepared_release,
    false,
  );
  assert(missing.summary.includes("app test가 아직 없다"));

  // 다른 hash의 통과는 근거가 아니다(변경된 source는 이전 성공으로 준비하지 않는다).
  const stale = prepared([
    verification({ target: { bundle_hash: OTHER, release: null } }),
  ]);
  const other = await runAppOp(RELEASE_INPUT, { client: stale.client, ...now });
  assertEquals(other.isError, true);
  assertEquals((other.data as { tests: unknown[] }).tests, []);

  // 같은 hash의 실패는 거절이고 이유를 보인다.
  const failed = prepared([
    verification({ result: "fail", reason: "check 2 실패" }),
  ]);
  const refused = await runAppOp(RELEASE_INPUT, {
    client: failed.client,
    ...now,
  });
  assertEquals(refused.isError, true);
  assert(refused.summary.includes("통과하지 않았다"));
});

Deno.test("coding-agent/mcp-server#R21: 같은 묶음 hash의 통과가 있으면 준비를 접수하고 activation은 사람의 몫이라고 구별한다", async () => {
  const flow = prepared([verification({})]);
  const done = await runAppOp(RELEASE_INPUT, { client: flow.client, ...now });
  assertEquals(done.isError, undefined);
  const data = done.data as {
    prepared_release: boolean;
    activated: boolean;
    tests: { id: string }[];
  };
  assertEquals(data.prepared_release, true);
  assertEquals(data.activated, false);
  assertEquals(data.tests[0].id, VRF);
  assert(done.next.some((line) => line.includes("activation은 사람")));
  // ticket 출처를 그대로 core에 보낸다.
  assertEquals(
    (flow.calls("release.prepare_bundle")[0].input as {
      ticket_source: unknown;
    })
      .ticket_source,
    { ticket: TKT, claim_seq: "3" },
  );
});

const TEST_INPUT = {
  op: "test",
  kind: "app_test",
  app: APP,
  target: { bundle_hash: HASH, release: null },
  problem: null,
  basis_seq: null,
  reports: [],
  before: null,
  after: null,
  ticket: null,
  test: OTHER,
  request_key: "req-test-0123456789",
};

function testFlow(request: Record<string, unknown>, extra = {}) {
  return scriptedFlow({
    RequestTest: {
      request_key: TEST_INPUT.request_key,
      accepted: true,
      result_ref: null,
    },
    GetTestRequest: {
      request: {
        request_key: TEST_INPUT.request_key,
        accepted: true,
        preparation_failed: false,
        start_attempted_at: null,
        started_at: null,
        start_unknown: false,
        result_ref: null,
        reason: "accepted",
        ...request,
      },
    },
    ...extra,
  });
}

Deno.test("coding-agent/mcp-server#R33: test는 runner에 요청하고 기본 timeout 300,000ms를 응답에 명시한다", async () => {
  assertEquals(APP_TEST_TIMEOUT_MS, 300_000);
  const flow = testFlow({}, {});
  const done = await runAppOp(TEST_INPUT, {
    client: flow.client,
    ...now,
    wait: { budget_ms: 0, interval_ms: 1_000 },
  });
  // 접수와 다음 read로 돌려준다. 결과가 없는데 성공으로 쓰지 않는다.
  assertEquals(done.isError, undefined);
  const data = done.data as { state: string; runner_timeout_ms: number };
  assertEquals(data.state, "accepted");
  assertEquals(data.runner_timeout_ms, 300_000);
  assert(done.summary.includes("300000ms"));
  // 요청 key가 envelope key와 같아 응답을 잃어도 같은 key로 다시 읽는다.
  assertEquals(
    flow.calls("RequestTest")[0].idempotency_key,
    TEST_INPUT.request_key,
  );
  assertEquals(
    (flow.calls("RequestTest")[0].input as Record<string, unknown>).op,
    undefined,
  );
});

Deno.test("coding-agent/mcp-server#R33, coding-agent/cli#R26: 통과·실패·timeout·판정 불가·준비 실패·시작 불명을 구별한다", async () => {
  const run = async (
    request: Record<string, unknown>,
    verifications?: Record<string, unknown>,
  ) => {
    const flow = testFlow(
      request,
      verifications === undefined ? {} : { GetVerification: verifications },
    );
    return await runAppOp(TEST_INPUT, {
      client: flow.client,
      ...now,
      wait: { budget_ms: 0, interval_ms: 1_000 },
    });
  };
  const verified = (over: Record<string, unknown>) => ({
    verification: verification(over),
  });
  const pass = await run({ result_ref: VRF }, verified({}));
  assertEquals(pass.isError, undefined);
  assertEquals((pass.data as { state: string }).state, "pass");
  assertEquals((pass.data as { real_test: boolean }).real_test, true);

  const failed = await run(
    { result_ref: VRF },
    verified({ result: "fail", reason: "check 1" }),
  );
  assertEquals(failed.isError, true);
  assertEquals((failed.data as { state: string }).state, "fail");

  const timeout = await run(
    { result_ref: VRF },
    verified({ result: "inconclusive", reason: "timeout" }),
  );
  assertEquals(timeout.isError, true);
  assertEquals((timeout.data as { state: string }).state, "timeout");

  const unknown = await run(
    { result_ref: VRF },
    verified({ result: "inconclusive", reason: "runner_lost" }),
  );
  assertEquals((unknown.data as { state: string }).state, "inconclusive");

  const preparation = await run({
    preparation_failed: true,
    reason: "bundle 준비 실패",
  });
  assertEquals(preparation.isError, true);
  assertEquals(
    (preparation.data as { state: string }).state,
    "preparation_failed",
  );

  const lost = await run({ start_unknown: true });
  assertEquals(lost.isError, true);
  assertEquals((lost.data as { state: string }).state, "start_unknown");

  const running = await run({ started_at: "2026-10-05T00:00:00.000Z" });
  assertEquals((running.data as { state: string }).state, "running");
  // stderr excerpt를 test result 정본으로 쓰지 않는다: 통과도 Verification 근거만이다.
  assert(
    failed.next.some((line) =>
      line.includes("stderr excerpt를 test result로 쓰지")
    ),
  );
});

Deno.test("coding-agent/mcp-server#R33: 접수하지 못한 test 요청은 성공이 아니다", async () => {
  const flow = scriptedFlow({
    RequestTest: {
      request_key: TEST_INPUT.request_key,
      accepted: false,
      result_ref: null,
    },
  });
  const done = await runAppOp(TEST_INPUT, { client: flow.client, ...now });
  assertEquals(done.isError, true);
  assertEquals(flow.sent.length, 1);
});

const PREVIEW_INPUT = {
  op: "preview_start",
  input: {
    app: APP,
    bundle_hash: HASH,
    release: null,
    fixture_hash: OTHER,
  },
};

Deno.test("coding-agent/mcp-server#R20: preview는 fixture 격리·운영 불변·상태·중지 결과를 알린다", async () => {
  const flow = scriptedFlow({
    "previews.start": { process_nonce: "n1", ready: false },
    "previews.get": {
      observation: {
        app: APP,
        release: null,
        bundle_hash: HASH,
        mode: "preview",
        process_nonce: "n1",
        endpoint: null,
        ready: true,
        accepting: false,
      },
      observed_at: "2026-10-05T00:00:00.000Z",
    },
    "previews.stop": { stopped: true },
  });
  const started = await runAppOp(PREVIEW_INPUT, {
    client: flow.client,
    ...now,
    ...fastWait,
  });
  assertEquals(started.isError, undefined);
  const data = started.data as {
    state: string;
    isolated: boolean;
    live_release_untouched: boolean;
    fixture_hash: string;
  };
  assertEquals(data.state, "ready");
  assertEquals(data.isolated, true);
  assertEquals(data.live_release_untouched, true);
  assertEquals(data.fixture_hash, OTHER);
  assert(started.summary.includes("운영 active release·data는 그대로"));

  const stopped = await runAppOp(
    { op: "preview_stop", app: APP, process_nonce: "n1" },
    { client: flow.client, ...now },
  );
  assert(stopped.summary.includes("운영 앱은 멈추지 않았다"));
  assertEquals(stopped.isError, undefined);
});

Deno.test("coding-agent/mcp-server#R20: preview 시작 실패는 이유와 함께 실패로, 준비 중은 접수로 구별한다", async () => {
  const failing = scriptedFlow({
    "previews.start": { process_nonce: "n1", ready: false },
    "previews.get": {
      observation: {
        ready: false,
        reason: { code: "handler", summary: "handler 없음" },
      },
    },
  });
  const failed = await runAppOp(PREVIEW_INPUT, {
    client: failing.client,
    ...now,
    ...fastWait,
  });
  assertEquals(failed.isError, true);
  assert(failed.summary.includes("handler 없음"));

  const starting = scriptedFlow({
    "previews.start": { process_nonce: "n1", ready: false },
    "previews.get": { observation: { ready: false } },
  });
  const pending = await runAppOp(PREVIEW_INPUT, {
    client: starting.client,
    ...now,
    wait: { budget_ms: 0, interval_ms: 1_000 },
  });
  assertEquals(pending.isError, undefined);
  assertEquals((pending.data as { state: string }).state, "starting");
});

Deno.test("coding-agent/cli#R24: status는 운영 active release와 preview를 따로 낸다", async () => {
  const flow = scriptedFlow({
    "app.get": { app: appRecord({ active_release: REL, source_path: "/w" }) },
    "app.runtime": {
      app: APP,
      state: { state: "running", termination_pending: false },
      observation: null,
      observed_at: null,
    },
    "previews.get": { observation: null, observed_at: null },
  });
  const done = await runAppOp({ op: "status", app: APP }, {
    client: flow.client,
    ...now,
  });
  assert(done.summary.includes(`active release ${REL}`));
  assert(done.summary.includes("운영 상태 running"));
  assert(done.summary.includes("preview 없음"));
  const data = done.data as { preview: { observation: unknown } };
  assertEquals(data.preview.observation, null);
});

Deno.test("coding-agent/cli#R24: source 미연결 앱은 없는 이유를 낸다", async () => {
  const flow = scriptedFlow({ "app.get": { app: appRecord() } });
  const done = await runAppOp({ op: "show", app: APP }, {
    client: flow.client,
    ...now,
  });
  assert(done.summary.includes("source 미연결"));
  assert(done.summary.includes("active release 없음"));
  assert(done.next[0].includes("source"));
});

Deno.test("coding-agent/mcp-server#R32: invocations는 기본·최대 20개이고 이어 읽기를 알린다", async () => {
  const flow = scriptedFlow({
    "invocations.list": (input) => ({
      invocations: Array.from(
        { length: 25 },
        (_, index) => ({ id: `inv-${index}` }),
      ),
      as_of_seq: "1",
      next_cursor: "c1",
      seen: input,
    }),
  });
  const done = await runAppOp({ op: "invocations", app: APP }, {
    client: flow.client,
    ...now,
  });
  assertEquals(flow.calls("invocations.list")[0].input, {
    app: APP,
    limit: 20,
  });
  assertEquals(
    (done.data as { invocations: unknown[] }).invocations.length,
    20,
  );
  assert(done.summary.includes("이어 읽을 것이 더 있다"));
  const wide = await runAppOp({ op: "invocations", app: APP, limit: 200 }, {
    client: flow.client,
    ...now,
  });
  assertEquals(
    (flow.calls("invocations.list")[1].input as { limit: number }).limit,
    20,
  );
  assertEquals(
    (wide.data as { invocations: unknown[] }).invocations.length,
    20,
  );
});

Deno.test("coding-agent/mcp-server#R32: log는 한 번에 최대 200줄이고 잘림·수집 상태를 표시한다", async () => {
  const flow = scriptedFlow({
    "app.logs": {
      state: "ok",
      lines: ["a", "b"],
      collected_at: null,
      truncated: true,
      as_of_seq: "1",
      next_cursor: null,
    },
  });
  const done = await runAppOp({ op: "logs", app: APP, limit: 2_000 }, {
    client: flow.client,
    ...now,
  });
  assertEquals(
    (flow.calls("app.logs")[0].input as { limit: number }).limit,
    200,
  );
  assert(done.summary.includes("log 2줄"));
  assert(done.summary.includes("잘렸다"));
  const off = scriptedFlow({
    "app.logs": { state: "off", lines: [], truncated: false },
  });
  const none = await runAppOp({ op: "logs", app: APP }, {
    client: off.client,
    ...now,
  });
  assert(none.summary.includes("수집이 꺼져"));
});

function invocation(over: Record<string, unknown>) {
  return {
    id: INV,
    app: APP,
    release: REL,
    operation: { kind: "command", command: "usage.read" },
    mode: "preview",
    approval: null,
    input_hash: HASH,
    status: "succeeded",
    ...over,
  };
}

Deno.test("coding-agent/mcp-server#R29: invocation은 같은 환경의 기록만 읽고 다른 환경은 없는 것과 같은 답이다", async () => {
  const flow = scriptedFlow({
    "invocations.get": { invocation: invocation({ mode: "live" }) },
  });
  const wrong = await runAppOp({ op: "invocation", invocation: INV }, {
    client: flow.client,
    ...now,
  });
  assertEquals(wrong.isError, true);
  assertEquals((wrong.data as { code: string }).code, "not_found");
  const gone = scriptedFlow({ "invocations.get": { invocation: null } });
  const none = await runAppOp({ op: "invocation", invocation: INV }, {
    client: gone.client,
    ...now,
  });
  assertEquals(none.summary, wrong.summary);
  assertEquals(none.data, wrong.data);
  // 환경을 바꾸어 다시 조회하지 않는다: 요청은 한 번뿐이다.
  assertEquals(flow.calls("invocations.get").length, 1);
  const live = await runAppOp(
    { op: "invocation", invocation: INV, environment: "live" },
    { client: flow.client, ...now },
  );
  assertEquals(live.isError, undefined);
  // 다른 앱의 invocation은 같은 답이다.
  const mismatch = await runAppOp(
    {
      op: "invocation",
      invocation: INV,
      app: "app_01arz3ndektsv4rrffq69g5faw",
      environment: "live",
    },
    { client: flow.client, ...now },
  );
  assertEquals(mismatch.data, wrong.data);
});

Deno.test("coding-agent/cli#R32: 접수·실행 중·실패·효과 불명을 구별하고 확인 대기는 exact 대상과 결정 링크를 낸다", async () => {
  const states = [
    "accepted",
    "running",
    "succeeded",
    "failed",
    "denied",
    "unknown",
  ];
  const texts = new Set<string>();
  for (const status of states) {
    const flow = scriptedFlow({
      "invocations.get": {
        invocation: invocation({
          status,
          approval: status === "accepted" ? APR : null,
        }),
      },
    });
    const done = await runAppOp({ op: "invocation", invocation: INV }, {
      client: flow.client,
      ...now,
    });
    texts.add(done.summary);
    if (status === "accepted") {
      const waiting = (done.data as {
        waiting_decision: {
          release: string;
          command: string;
          input_hash: string;
          decision_link: string;
        };
      }).waiting_decision;
      assertEquals(waiting.release, REL);
      assertEquals(waiting.command, "usage.read");
      assertEquals(waiting.input_hash, HASH);
      assertEquals(waiting.decision_link, `lophn://things-to-confirm/${APR}`);
    }
    if (status === "unknown") assert(done.summary.includes("추측하지 않는다"));
  }
  assertEquals(texts.size, states.length);
});

const COMMAND_INPUT = { op: "command", app: APP, command: "usage.read" };

const previewReady = {
  "previews.get": {
    observation: { ready: true, process_nonce: "n1", accepting: false },
  },
};

function invoked(
  mode: "preview" | "live",
  extra: Record<string, unknown> = {},
) {
  return {
    kind: "result" as const,
    output: {
      result: { result: { total: 3 }, ...extra },
      invocation: INV,
      mode,
    },
  };
}

Deno.test("coding-agent/mcp-server#R29: command는 기본 preview이고 preview nonce로 앱 통로를 부른다", async () => {
  const flow = scriptedFlow(previewReady);
  const seen: AppInvokeRequest[] = [];
  const done = await runAppOp(
    { ...COMMAND_INPUT, input: { month: 10 } },
    {
      client: flow.client,
      ...now,
      direct: direct(invoked("preview"), seen),
      requestKey: () => "rk-1",
    },
  );
  assertEquals(done.isError, undefined);
  assertEquals(seen, [{
    app: APP,
    environment: "preview",
    command: "usage.read",
    input: { month: 10 },
    request_key: "rk-1",
    preview_nonce: "n1",
  }]);
  assertEquals((done.data as { result: unknown }).result, { total: 3 });
  assertEquals((done.data as { invocation: string }).invocation, INV);
});

Deno.test("coding-agent/mcp-server#R29: preview가 없으면 운영 앱으로 대신 부르지 않는다", async () => {
  const flow = scriptedFlow({ "previews.get": { observation: null } });
  const seen: AppInvokeRequest[] = [];
  const done = await runAppOp(COMMAND_INPUT, {
    client: flow.client,
    ...now,
    direct: direct(invoked("live"), seen),
  });
  assertEquals(done.isError, true);
  assertEquals(seen.length, 0);
  assert(done.summary.includes("운영 앱으로 대신 부르지 않는다"));
});

Deno.test("coding-agent/mcp-server#R29: live 선택은 preview를 보지 않고 live로만 부르며 다른 환경의 응답은 쓰지 않는다", async () => {
  const flow = scriptedFlow({});
  const seen: AppInvokeRequest[] = [];
  const done = await runAppOp(
    { ...COMMAND_INPUT, environment: "live" },
    { client: flow.client, ...now, direct: direct(invoked("live"), seen) },
  );
  assertEquals(done.isError, undefined);
  assertEquals(seen[0].environment, "live");
  assertEquals(seen[0].preview_nonce, undefined);
  assertEquals(flow.sent.length, 0);
  const mixed = await runAppOp(
    { ...COMMAND_INPUT, environment: "live" },
    { client: flow.client, ...now, direct: direct(invoked("preview")) },
  );
  assertEquals(mixed.isError, true);
  assertEquals((mixed.data as { code: string }).code, "conflict");
});

Deno.test("coding-agent/cli#R31: 결과 불명은 실제 실패와 구별하고 다시 부르지 않는다", async () => {
  const flow = scriptedFlow(previewReady);
  const seen: AppInvokeRequest[] = [];
  const unknown = await runAppOp(COMMAND_INPUT, {
    client: flow.client,
    ...now,
    direct: direct({ kind: "unknown", request_key: "rk-9" }, seen),
  });
  assertEquals(unknown.isError, true);
  const data = unknown.data as { diagnosis: string; request_key: string };
  assertEquals(data.diagnosis, "result_unknown");
  assertEquals(data.request_key, "rk-9");
  assertEquals(seen.length, 1);

  // 실제 실패는 오류 코드 그대로다.
  const failing: AppDirect = {
    invoke: () =>
      Promise.resolve(err({ code: "forbidden", message: "confirm command다" })),
  };
  const refused = await runAppOp(COMMAND_INPUT, {
    client: flow.client,
    ...now,
    direct: failing,
  });
  assertEquals((refused.data as { code: string }).code, "forbidden");
  assertEquals(
    (refused.data as { diagnosis?: string }).diagnosis,
    undefined,
  );
});

Deno.test("coding-agent/cli#R31: timeout은 양의 정수만이고 기한을 넘기면 결과 불명이다", async () => {
  const flow = scriptedFlow(previewReady);
  const bad = await runAppOp({ ...COMMAND_INPUT, timeout_ms: 0 }, {
    client: flow.client,
    ...now,
    direct: direct(invoked("preview")),
  });
  assertEquals((bad.data as { code: string }).code, "invalid_input");
  const slow: AppDirect = {
    invoke: () => new Promise(() => {}),
  };
  const done = await runAppOp({ ...COMMAND_INPUT, timeout_ms: 5 }, {
    client: flow.client,
    ...now,
    direct: slow,
    requestKey: () => "rk-slow",
  });
  assertEquals(done.isError, true);
  assertEquals(
    (done.data as { diagnosis: string }).diagnosis,
    "result_unknown",
  );
  assertEquals((done.data as { request_key: string }).request_key, "rk-slow");
});

Deno.test("coding-agent/mcp-server#R29: 앱 통로가 없으면 command는 unavailable이고 core에 가지 않는다", async () => {
  const flow = scriptedFlow({});
  const done = await runAppOp(COMMAND_INPUT, { client: flow.client, ...now });
  assertEquals((done.data as { code: string }).code, "unavailable");
  assertEquals(flow.sent.length, 0);
});

Deno.test("coding-agent/mcp-server#R29: 읽기 원천이 부분·미수집이면 정상 0행으로 읽지 않게 알린다", async () => {
  const flow = scriptedFlow(previewReady);
  const done = await runAppOp(COMMAND_INPUT, {
    client: flow.client,
    ...now,
    direct: direct(
      invoked("preview", {
        source: {
          coverage: "uncollected",
          freshness: "unknown",
          continuation: null,
        },
      }),
    ),
  });
  assert(done.summary.includes("uncollected"));
  assert(done.summary.includes("정상 0행"));
});

Deno.test("coding-agent/mcp-server#R19: sync port가 없는 process의 sync_tools는 unavailable이고 core에 가지 않는다", async () => {
  const flow = scriptedFlow({});
  const done = await runAppOp({ op: "sync_tools", app: APP }, {
    client: flow.client,
    ...now,
  });
  assertEquals(done.isError, true);
  assertEquals((done.data as { code: string }).code, "unavailable");
  assertEquals(flow.sent.length, 0);
});

Deno.test("coding-agent/mcp-server#R19, coding-agent/guides#R17: sync_tools는 host가 끼운 sync port로 guides의 syncTools를 돌리고 항목별 결과를 낸다", async () => {
  const flow = scriptedFlow({});
  const seen: Record<string, unknown>[] = [];
  const done = await runAppOp({
    op: "sync_tools",
    app: APP,
    target: {
      scope_kind: "app",
      environment: { kind: "host", identity: "native" },
      profile_id: null,
      harness_id: "claude",
      app: APP,
      app_realpath: "/w/notes",
    },
  }, {
    client: flow.client,
    ...now,
    sync: (input) => {
      seen.push(input);
      return Promise.resolve(ok({
        status: "complete",
        files: [
          {
            target: "mcp",
            name: "mcp:app",
            outcome: "changed",
            reason: "MCP 설정을 썼다",
          },
          {
            target: "skill",
            name: "skill:app:lophn-save",
            outcome: "unchanged",
            reason: "이미 같은 내용이다",
          },
          {
            target: "ignore",
            name: ".gitignore",
            outcome: "changed",
            reason: "ignore 구간을 썼다",
          },
        ],
        notices: [],
      }));
    },
  });
  assertEquals(done.isError, undefined);
  assert(done.summary.includes("도구 재배포를 마쳤다"));
  const files = (done.data as { files: { outcome: string }[] }).files;
  assertEquals(files.length, 3);
  assertEquals(done.next[0].includes("doctor"), true);
  // 파일 설치라 core route로 가지 않는다.
  assertEquals(flow.sent.length, 0);
  // 검사한 입력과 operationId가 port에 온다(소유 route 표의 입력 자리다).
  const passed = seen[0];
  assertEquals(
    (passed.target as { app_realpath: string }).app_realpath,
    "/w/notes",
  );
  assertEquals(passed.app, APP);
});

Deno.test("coding-agent/mcp-server#R19: sync port의 실패는 같은 오류로 전하고 부분 결과는 isError 없이 표시한다", async () => {
  const flow = scriptedFlow({});
  const refused = await runAppOp({
    op: "sync_tools",
    app: APP,
    target: APP_TARGET,
  }, {
    client: flow.client,
    ...now,
    sync: () =>
      Promise.resolve(
        fail(
          "invalid_input",
          "sync는 앱 하나 범위의 target만 받는다(--app 범위 target)",
        ),
      ),
  });
  assertEquals(refused.isError, true);
  assertEquals((refused.data as { code: string }).code, "invalid_input");
  assertEquals(flow.sent.length, 0);

  const partial = await runAppOp({
    op: "sync_tools",
    app: APP,
    target: APP_TARGET,
  }, {
    client: flow.client,
    ...now,
    sync: () =>
      Promise.resolve(ok({
        status: "partial",
        files: [{
          target: "guide",
          name: "instruction:region",
          outcome: "skipped",
          reason: "symlink라 건드리지 않는다",
        }],
        notices: ["CLAUDE.md에 lophn 관리 구간이 없어 건드리지 않는다"],
      })),
  });
  assertEquals(partial.isError, undefined);
  assert(partial.summary.includes("일부만 됐다"));
  assertEquals(
    (partial.data as { status: string }).status,
    "partial",
  );
});

Deno.test("coding-agent/mcp-server#R19, apps/blueprint#R3: blueprint op는 apps.blueprint를 읽고 설명·test 근거를 구별해 보인다", async () => {
  assertEquals(APP_OP_ROUTES.blueprint.name, "app.blueprint");
  const flow = scriptedFlow({
    "app.blueprint": {
      app: APP,
      release: REL,
      blueprint_hash: HASH,
      name: "Notes",
      description: "메모",
      commands: [{
        key: "list",
        label: "목록",
        description: "목록을 읽는다",
        effect: "read",
        confirm: false,
        input: null,
      }],
      screens: [],
      automations: [],
      evidence: {
        description: { complete: true, gaps: [] },
        structure: { validated: true },
        test: { passed: true, verifications: [VRF] },
      },
      as_of_seq: "3",
      next_cursor: null,
    },
  });
  const done = await runAppOp({ op: "blueprint", app: APP }, {
    client: flow.client,
    ...now,
  });
  assertEquals(done.isError, undefined);
  assert(done.summary.includes("command 1개"));
  assert(done.summary.includes("설명 완성"));
  assert(done.summary.includes("실제 test 통과"));
  assertEquals(flow.calls("app.blueprint")[0].input, { app: APP });
  // 범위 밖·없는 앱·active release 없는 앱은 같은 not_found로 온다.
  const absent = scriptedFlow({ "app.blueprint": fail("not_found", "없다") });
  const out = await runAppOp({ op: "blueprint", app: APP }, {
    client: absent.client,
    ...now,
  });
  assertEquals(out.isError, true);
  assertEquals((out.data as { code: string }).code, "not_found");
});

Deno.test("coding-agent/mcp-server#R19: 표 밖 op는 실행하지 않는다", async () => {
  const flow = scriptedFlow({});
  for (const op of ["activate", "start", "stop", "grant", undefined]) {
    const done = await runAppOp({ op, app: APP }, {
      client: flow.client,
      ...now,
    });
    assertEquals(done.isError, true);
    assertEquals((done.data as { code: string }).code, "invalid_input");
  }
  assertEquals(flow.sent.length, 0);
});

Deno.test("coding-agent/cli#R7: 사람 전용 앱 결정은 거절하고 결정 화면 링크와 사실만 낸다", () => {
  for (
    const name of [
      "app start",
      "app stop",
      "app release activate",
      "app automation run",
    ] as const
  ) {
    const report = humanOnlyReport(name, { app: APP });
    assert(report.ok);
    assertEquals(report.value.isError, true);
    const data = report.value.data as {
      code: string;
      decision_link: string;
      window_opened: boolean;
      requested: boolean;
    };
    assertEquals(data.code, "forbidden");
    assertEquals(data.decision_link, `lophn://things-to-confirm/${APP}`);
    // confirmation window를 열지 않고 아무것도 요청하지 않는다.
    assertEquals(data.window_opened, false);
    assertEquals(data.requested, false);
  }
  assertEquals(humanOnlyReport("app start", {}).ok, false);
  assertEquals(humanOnlyReport("app start", { app: "notes" }).ok, false);
});

Deno.test("coding-agent/cli#R28, coding-agent/connection#R6: 같은 입력의 흐름은 표면이 달라도 같은 요청을 보낸다", async () => {
  const handlers = {
    "app.get": { app: appRecord() },
    "app.connect_source": appRecord({ source_path: "/w" }),
  };
  const mcp = scriptedFlow(handlers);
  const cli = scriptedFlow(handlers);
  const input = { op: "source", app: APP, source_path: "/w" };
  const a = await runAppOp(input, {
    client: mcp.client,
    ...now,
    surface: "mcp",
  });
  const b = await runAppOp(input, {
    client: cli.client,
    ...now,
    surface: "cli",
  });
  assertEquals(mcp.sent, cli.sent);
  assertEquals(a.data, b.data);
  assertEquals(a.isError, b.isError);
  // 다음 조회 안내만 표면의 이름을 쓴다.
  assert(a.next.some((line) => line.startsWith("lophn_app ")));
  assert(b.next.some((line) => line.startsWith("lophn app ")));
});

Deno.test("coding-agent/mcp-server#R33: timeout_ms를 주지 않아도 기본 300,000ms를 요청에 명시해 runner에 넘기고 준 값은 그대로다", async () => {
  const flow = testFlow({}, {});
  await runAppOp(TEST_INPUT, {
    client: flow.client,
    ...now,
    wait: { budget_ms: 0, interval_ms: 1_000 },
  });
  assertEquals(
    (flow.calls("RequestTest")[0].input as { timeout_ms: number }).timeout_ms,
    300_000,
  );
  const short = testFlow({}, {});
  const done = await runAppOp({ ...TEST_INPUT, timeout_ms: 45_000 }, {
    client: short.client,
    ...now,
    wait: { budget_ms: 0, interval_ms: 1_000 },
  });
  assertEquals(
    (short.calls("RequestTest")[0].input as { timeout_ms: number }).timeout_ms,
    45_000,
  );
  assertEquals(
    (done.data as { runner_timeout_ms: number }).runner_timeout_ms,
    45_000,
  );
  assert(done.summary.includes("45000ms"));
});

Deno.test("coding-agent/cli#R24: log가 잘리고 더 오래된 줄이 있으면 cursor로 이어 읽는 안내를 낸다", async () => {
  const flow = scriptedFlow({
    "app.logs": {
      state: "ok",
      lines: ["a"],
      truncated: true,
      next_cursor: "40",
    },
  });
  const first = await runAppOp({ op: "logs", app: APP, limit: 1 }, {
    client: flow.client,
    ...now,
  });
  assert(first.summary.includes("next_cursor"));
  assert(first.next[0].includes("cursor=next_cursor"));
  await runAppOp({ op: "logs", app: APP, limit: 1, cursor: "40" }, {
    client: flow.client,
    ...now,
  });
  assertEquals(flow.calls("app.logs")[1].input, {
    app: APP,
    limit: 1,
    cursor: "40",
  });
});
