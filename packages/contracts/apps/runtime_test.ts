import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { eventEnvelopeSchema } from "../platform/events.ts";
import { routePath } from "../platform/route.ts";
import {
  appAutomations,
  appDisableExecution,
  appEnableExecution,
  appExecutionDisabled,
  appExecutionEnabled,
  appExport,
  appLogs,
  appLogsInputSchema,
  appLogsOutputSchema,
  appRecordStarted,
  appRecordStartedInputSchema,
  appRecordStopped,
  appRecordUnavailable,
  appRuntime,
  appStarted,
  appStopped,
  appUnavailable,
  automationViewSchema,
  LOG_LINE_MAX_COUNT,
  LOG_LINE_MAX_LENGTH,
  readyAttestationSchema,
  runtimeObservationSchema,
  runtimeStateSchema,
} from "./runtime.ts";
import { EVENTS, ROUTES } from "./registry.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const HASH = "ab".repeat(32);
const AT = "2026-10-04T00:00:00.000Z";
const META = { as_of_seq: "8", next_cursor: null };
const reason = {
  code: "ready_timeout",
  summary: "30초 안에 준비를 확인하지 못함",
};

const attestation = {
  release: REL,
  bundle_hash: HASH,
  commands: ["usage.list"],
  data_schema: 1,
  process_nonce: "nonce-1",
  connection_ok: true as const,
};

const running = {
  state: "running" as const,
  termination_pending: false,
};

Deno.test("apps/runtime#R2, apps/runtime#R13, apps/runtime#R26, apps/runtime#R27, apps/automations#R10, apps/data#R13: route와 event 이름은 architecture 5.4와 같다", () => {
  const methods = [
    "enable_execution",
    "disable_execution",
    "record_started",
    "record_stopped",
    "record_unavailable",
    "runtime",
    "logs",
    "automations",
    "export",
  ];
  assertEquals(
    ROUTES.filter((route) => methods.includes(route.method)).map((
      route,
    ) => [route.kind, routePath(route), route.name]),
    [
      ["command", "/v1/apps/enable_execution", "app.enable_execution"],
      ["command", "/v1/apps/disable_execution", "app.disable_execution"],
      ["command", "/v1/apps/record_started", "app.record_started"],
      ["command", "/v1/apps/record_stopped", "app.record_stopped"],
      ["command", "/v1/apps/record_unavailable", "app.record_unavailable"],
      ["read", "/v1/apps/runtime", "app.runtime"],
      ["read", "/v1/apps/logs", "app.logs"],
      ["read", "/v1/apps/automations", "app.automations"],
      ["worker", "/v1/apps/export", "app.export"],
    ],
  );
  assertEquals(
    EVENTS.filter((event) =>
      event.type.startsWith("App") && ![
        "AppCreated",
        "AppSourceConnected",
        "AppArchived",
        "AppUnarchived",
      ].includes(event.type)
    ).map((event) => event.type),
    [
      "AppExecutionEnabled",
      "AppExecutionDisabled",
      "AppStarted",
      "AppStopped",
      "AppUnavailable",
    ],
  );
  assertEquals(appEnableExecution.actors, ["user"]);
  assertEquals(appRecordStarted.actors, ["machine"]);
  for (
    const route of [appRecordStarted, appRecordStopped, appRecordUnavailable]
  ) {
    assertEquals(route.errors, ["conflict", "invalid_input"]);
  }
  assertEquals(appExport.kind, "worker");
  for (
    const route of [
      appEnableExecution,
      appDisableExecution,
      appRecordStarted,
      appRecordStopped,
      appRecordUnavailable,
      appRuntime,
      appLogs,
      appAutomations,
      appExport,
    ]
  ) {
    for (const code of route.errors) assert(ERROR_CODES.includes(code));
  }
});

Deno.test("apps/runtime#R2, apps/runtime#R13: ReadyAttestation과 네 화면 상태가 통과한다", () => {
  readyAttestationSchema.parse(attestation);
  appRecordStartedInputSchema.parse({ app: APP, attestation });
  assertEquals(
    runtimeStateSchema.parse({
      state: "preparing",
      termination_pending: false,
    }).state,
    "preparing",
  );
  assertEquals(
    runtimeStateSchema.parse({
      state: "stopped",
      termination_pending: true,
    }).termination_pending,
    true,
  );
  runtimeStateSchema.parse(running);
  runtimeStateSchema.parse({
    state: "unavailable",
    termination_pending: false,
    reason,
  });
  assert(
    !runtimeStateSchema.safeParse({
      state: "unavailable",
      termination_pending: false,
    }).success,
  );
  assert(
    !runtimeStateSchema.safeParse({
      state: "degraded",
      termination_pending: false,
    }).success,
  );
});

Deno.test("apps/runtime#R13, apps/runtime#R14, apps/runtime#R25: 관측이 없으면 null이고 없는 지표를 만들지 않는다", () => {
  const page = appRuntime.output.parse({
    ...META,
    app: APP,
    state: { state: "stopped", termination_pending: false },
    observation: null,
    observed_at: null,
  });
  assertEquals(page.observation, null);
  assertEquals("problem_count" in page, false);
  assertEquals("health" in page, false);
  const live = runtimeObservationSchema.parse({
    app: APP,
    release: REL,
    mode: "live",
    process_nonce: "nonce-1",
    endpoint: "unix:///run/lophn/app.sock",
    ready: true,
    accepting: true,
  });
  assertEquals(live.ready, true);
  assert(
    !runtimeObservationSchema.safeParse({
      ...live,
      release: null,
    }).success,
  );
  assert(
    !runtimeObservationSchema.safeParse({
      ...live,
      ready: false,
    }).success,
  );
});

Deno.test("apps/runtime#R18, apps/runtime#R22, apps/runtime#R28: 시작·종료·사용 불가 근거를 구별한다", () => {
  eventEnvelopeSchema(appStarted).parse({
    seq: "8",
    type: "AppStarted",
    subject: APP,
    actor: "machine",
    run: null,
    payload: { release: REL, process_nonce: "nonce-1", data_schema: 1 },
    at: AT,
  });
  eventEnvelopeSchema(appStopped).parse({
    seq: "9",
    type: "AppStopped",
    subject: APP,
    actor: "machine",
    run: null,
    payload: { release: REL, process_nonce: "nonce-1" },
    at: AT,
  });
  eventEnvelopeSchema(appUnavailable).parse({
    seq: "10",
    type: "AppUnavailable",
    subject: APP,
    actor: "machine",
    run: null,
    payload: { release: REL, reason: { code: "oom", summary: "V8 OOM" } },
    at: AT,
  });
  eventEnvelopeSchema(appExecutionEnabled).parse({
    seq: "6",
    type: "AppExecutionEnabled",
    subject: APP,
    actor: "user",
    run: null,
    payload: { run_enabled: true },
    at: AT,
  });
  eventEnvelopeSchema(appExecutionDisabled).parse({
    seq: "7",
    type: "AppExecutionDisabled",
    subject: APP,
    actor: "user",
    run: null,
    payload: { run_enabled: false },
    at: AT,
  });
  assert(
    !appExecutionEnabled.payload.safeParse({
      run_enabled: false,
    }).success,
  );
});

Deno.test("apps/runtime#R26, apps/runtime#R27: log는 200줄·한 줄 300자이고 잘림을 명시한다", () => {
  assertEquals(LOG_LINE_MAX_COUNT, 200);
  assertEquals(LOG_LINE_MAX_LENGTH, 300);
  const line = "x".repeat(LOG_LINE_MAX_LENGTH);
  const page = appLogsOutputSchema.parse({
    ...META,
    state: "ok",
    lines: Array.from({ length: LOG_LINE_MAX_COUNT }, () => line),
    collected_at: AT,
    truncated: true,
  });
  assertEquals(page.lines.length, 200);
  assertEquals(page.truncated, true);
  appLogsInputSchema.parse({
    app: APP,
    invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
    limit: 200,
  });
  assert(
    !appLogsOutputSchema.safeParse({
      ...page,
      lines: Array.from({ length: 201 }, () => "x"),
    }).success,
  );
  assert(
    !appLogsOutputSchema.safeParse({
      ...page,
      lines: ["y".repeat(LOG_LINE_MAX_LENGTH + 1)],
    }).success,
  );
  assert(!appLogsInputSchema.safeParse({ app: APP, limit: 201 }).success);
});

Deno.test("apps/automations#R4, apps/automations#R10: 선언·실행 가능·실제 관측을 구별한다", () => {
  const view = automationViewSchema.parse({
    key: "refresh",
    declared: true,
    runnable: false,
    observed: false,
    release: REL,
    reason: {
      code: "not_accepting",
      summary: "통로가 닫혀 회차를 시작하지 못함",
    },
  });
  assertEquals(view.runnable, false);
  assertEquals(view.observed, false);
  appAutomations.output.parse({
    ...META,
    app: APP,
    automations: [view, {
      key: "sync",
      declared: true,
      runnable: true,
      observed: true,
      release: REL,
    }],
    observed_at: AT,
  });
  appAutomations.output.parse({
    ...META,
    app: APP,
    automations: [],
    observed_at: null,
  });
});

Deno.test("apps/data#R13: export는 준비 중·완성·실패를 구별하고 외부 자료 포함을 명시한다", () => {
  const ready = appExport.output.parse({
    app: APP,
    state: "ready",
    includes_external_data: false,
  });
  assertEquals(ready.state, "ready");
  assertEquals("credential" in ready, false);
  appExport.output.parse({
    app: APP,
    state: "preparing",
    includes_external_data: true,
  });
  appExport.output.parse({
    app: APP,
    state: "failed",
    reason,
    includes_external_data: false,
  });
  assert(
    !appExport.output.safeParse({
      app: APP,
      state: "failed",
      includes_external_data: false,
    }).success,
  );
});
