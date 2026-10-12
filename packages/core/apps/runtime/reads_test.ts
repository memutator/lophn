import { assert, assertEquals } from "@std/assert";
import type { App, RuntimeObservation } from "../../../protocol/apps/mod.ts";
import type { RequestContext } from "../../../protocol/platform/mod.ts";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  createRuntimeReads,
  type MainRead,
  type RuntimeSources,
  withRuntimeLogs,
  withRuntimeObservation,
} from "./reads.ts";
import { createAppSnapshot } from "./testing/mod.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";

const app: App = {
  id: APP,
  slug: "usage",
  name: "Usage",
  description: "collect usage",
  planning_version: null,
  source_path: null,
  active_release: REL,
  revision: "3",
  run_enabled: true,
  status: "active",
};

const ctx: RequestContext = {
  actor: "user",
  principal: "test-user",
  credential_ref: "test:user",
  scope: { operations: ["app.runtime", "app.logs"], targets: {} },
  conditions: {},
};

const live: RuntimeObservation = {
  app: APP,
  release: REL,
  mode: "live",
  process_nonce: "nonce-1",
  endpoint: null,
  ready: true,
  accepting: true,
};

Deno.test("apps/runtime#R13: runtime read는 지금의 관측으로 running을 말하고 관측이 없으면 unavailable과 이유를 보인다", () => {
  const fixture = createAppSnapshot(app);
  try {
    const none = createRuntimeReads().runtime;
    const absent = none.handle(fixture.snapshot, ctx, { app: APP });
    assert(absent.ok);
    assertEquals(absent.value.state.state, "unavailable");
    assertEquals(absent.value.state.reason?.code, "no_observation");
    assertEquals(absent.value.observation, null);
    assertEquals(absent.value.observed_at, null);

    const observed = createRuntimeReads({
      observation: () => ({
        observation: live,
        observed_at: "2026-10-05T00:00:00.000Z",
      }),
    }).runtime.handle(fixture.snapshot, ctx, { app: APP });
    assert(observed.ok);
    assertEquals(observed.value.state, {
      state: "running",
      termination_pending: false,
    });
    assertEquals(observed.value.observation, live);
  } finally {
    fixture.close();
  }
});

Deno.test("apps/runtime#R15: 멈춘 앱에 live 자식이 관측되는 동안 read는 stopped와 termination_pending을 함께 보인다", () => {
  const stopped = { ...app, run_enabled: false };
  const fixture = createAppSnapshot(stopped);
  try {
    const stopping = createRuntimeReads({
      observation: () => ({
        observation: {
          ...live,
          ready: false,
          accepting: false,
          reason: {
            code: "terminating",
            summary: "stop requested; the OS has not confirmed the exit",
          },
        },
        observed_at: "2026-10-05T00:00:00.000Z",
      }),
    }).runtime.handle(fixture.snapshot, ctx, { app: APP });
    assert(stopping.ok);
    assertEquals(stopping.value.state, {
      state: "stopped",
      termination_pending: true,
    });
    const done = createRuntimeReads().runtime.handle(fixture.snapshot, ctx, {
      app: APP,
    });
    assert(done.ok);
    assertEquals(done.value.state.termination_pending, false);
  } finally {
    fixture.close();
  }
});

Deno.test("apps/runtime#R14: runtime read는 실행 상태만 말하고 problem·health 값을 만들지 않으며 logs는 source가 없으면 none과 빈 값이다", () => {
  const fixture = createAppSnapshot(app);
  try {
    const runtime = createRuntimeReads({
      observation: () => ({
        observation: live,
        observed_at: "2026-10-05T00:00:00.000Z",
      }),
    }).runtime.handle(fixture.snapshot, ctx, { app: APP });
    assert(runtime.ok);
    assertEquals(Object.keys(runtime.value).sort(), [
      "app",
      "as_of_seq",
      "next_cursor",
      "observation",
      "observed_at",
      "state",
    ]);
    const logs = createRuntimeReads().logs.handle(fixture.snapshot, ctx, {
      app: APP,
    });
    assert(logs.ok);
    assertEquals(logs.value.state, "none");
    assertEquals(logs.value.lines, []);
    assertEquals(logs.value.collected_at, null);
    assertEquals(logs.value.truncated, false);
  } finally {
    fixture.close();
  }
});

Deno.test("apps/runtime#R27: logs read는 source 결과를 그대로 주고 limit 기본값과 invocation·max_bytes를 source에 넘긴다", () => {
  const fixture = createAppSnapshot(app);
  try {
    const seen: unknown[] = [];
    const reads = createRuntimeReads({
      logs: (id, query) => {
        seen.push({ id, query });
        return {
          state: "ok",
          lines: ["a", "b"],
          collected_at: "2026-10-05T00:00:00.000Z",
          truncated: true,
        };
      },
    });
    const result = reads.logs.handle(fixture.snapshot, ctx, {
      app: APP,
      invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
      max_bytes: 100,
    });
    assert(result.ok);
    assertEquals(result.value.lines, ["a", "b"]);
    assertEquals(result.value.truncated, true);
    assertEquals(seen, [{
      id: APP,
      query: {
        invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
        limit: 200,
        max_bytes: 100,
      },
    }]);
  } finally {
    fixture.close();
  }
});

Deno.test("apps/runtime#R14: 범위 밖 앱과 없는 앱은 같은 not_found로 답한다", () => {
  const fixture = createAppSnapshot(app, () => false);
  try {
    const reads = createRuntimeReads();
    const outOfScope = reads.runtime.handle(fixture.snapshot, ctx, {
      app: APP,
    });
    const absent = reads.runtime.handle(fixture.snapshot, ctx, {
      app: "app_01h455vb4pex5v6nkc6gd5fdw9",
    });
    assert(!outOfScope.ok && !absent.ok);
    assertEquals(outOfScope.error, absent.error);
    const logs = reads.logs.handle(fixture.snapshot, ctx, { app: APP });
    assert(!logs.ok);
    assertEquals(logs.error, absent.error);
  } finally {
    fixture.close();
  }
});

// reader Worker가 접근을 판정하고 만든 값. 메인 스레드가 현재 관측·log로 덮는다.
const pooled = (extra: Record<string, unknown> = {}): MainRead => () =>
  ok({
    app: APP,
    state: { state: "unavailable", termination_pending: false },
    observation: null,
    observed_at: null,
    as_of_seq: "7",
    next_cursor: null,
    ...extra,
  });

function sources(over: Partial<RuntimeSources> = {}): RuntimeSources {
  return {
    observation: () => Promise.resolve(ok(live)),
    logs: () =>
      Promise.resolve(ok({
        state: "ok" as const,
        lines: ["one", "two"],
        collected_at: "2026-10-05T00:00:00.000Z",
        truncated: false,
      })),
    app: () =>
      Promise.resolve(ok({
        active_release: REL,
        status: "active" as const,
        run_enabled: true,
      })),
    redact: (line) => line,
    now: () => "2026-10-05T00:00:01.000Z",
    ...over,
  };
}

Deno.test("apps/runtime#R13: 메인의 관측 source는 reader가 낸 값에 현재 관측과 계산한 상태를 얹고 접근 판정은 reader 것을 그대로 쓴다", async () => {
  const read = withRuntimeObservation(pooled(), sources());
  const answered = await read(ctx as never, { app: APP });
  assert(answered.ok);
  const value = answered.value as {
    state: { state: string };
    observation: RuntimeObservation | null;
    observed_at: string | null;
    as_of_seq: string;
  };
  assertEquals(value.state.state, "running");
  assertEquals(value.observation, live);
  assertEquals(value.observed_at, "2026-10-05T00:00:01.000Z");
  assertEquals(value.as_of_seq, "7");
  // reader가 거절한 요청(범위 밖 앱)은 source를 부르지 않고 그대로 거절이다.
  let asked = 0;
  const denied = withRuntimeObservation(
    () => err({ code: "not_found", message: "app not found" }),
    sources({
      observation: () => {
        asked += 1;
        return Promise.resolve(ok(live));
      },
    }),
  );
  const refused = await denied(ctx as never, { app: APP });
  assert(!refused.ok);
  assertEquals(asked, 0);
});

Deno.test("apps/runtime#R13: supervisor를 읽지 못하면 과거 event로 running이라 하지 않고 관측 없음이다", async () => {
  const down = withRuntimeObservation(
    pooled(),
    sources({
      observation: (): Promise<Result<RuntimeObservation | null>> =>
        Promise.resolve(err({ code: "unavailable", message: "down" })),
    }),
  );
  const answered = await down(ctx as never, { app: APP });
  assert(answered.ok);
  const value = answered.value as {
    state: { state: string; reason?: { code: string } };
    observation: unknown;
    observed_at: unknown;
  };
  assertEquals(value.state.state, "unavailable");
  assertEquals(value.state.reason?.code, "no_observation");
  assertEquals(value.observation, null);
  assertEquals(value.observed_at, null);
});

Deno.test("apps/runtime#R15: 멈춘 앱의 live 관측은 종료 확인 전이라는 뜻이다", async () => {
  const stopped = withRuntimeObservation(
    pooled(),
    sources({
      app: () =>
        Promise.resolve(ok({
          active_release: REL,
          status: "active" as const,
          run_enabled: false,
        })),
      observation: () =>
        Promise.resolve(ok({
          ...live,
          ready: false,
          accepting: false,
          reason: { code: "terminating", summary: "stop requested" },
        })),
    }),
  );
  const answered = await stopped(ctx as never, { app: APP });
  assert(answered.ok);
  assertEquals(
    (answered.value as { state: unknown }).state,
    { state: "stopped", termination_pending: true },
  );
});

Deno.test("apps/runtime#R14: log source는 접근을 통과한 앱의 줄을 redaction해서 주고 없거나 안전화 못 하면 none이다", async () => {
  const logs = withRuntimeLogs(
    () =>
      ok({
        state: "none",
        lines: [],
        collected_at: null,
        truncated: false,
        as_of_seq: "7",
        next_cursor: null,
      }),
    sources({ redact: (line) => line.replace("two", "[redacted]") }),
  );
  const answered = await logs(ctx as never, { app: APP, limit: 10 });
  assert(answered.ok);
  const value = answered.value as {
    state: string;
    lines: string[];
    collected_at: string | null;
  };
  assertEquals(value.state, "ok");
  assertEquals(value.lines, ["one", "[redacted]"]);
  // source에 닿지 못하면 없는 log를 만들지 않는다.
  const unreachable = withRuntimeLogs(
    () =>
      ok({
        state: "none",
        lines: [],
        collected_at: null,
        truncated: false,
        as_of_seq: "7",
        next_cursor: null,
      }),
    sources({
      logs: () =>
        Promise.resolve(err({ code: "unavailable", message: "down" })),
    }),
  );
  const none = await unreachable(ctx as never, { app: APP });
  assert(none.ok);
  assertEquals((none.value as { state: string }).state, "none");
  // 알려진 secret 목록을 아직 다 모르면(redact가 null) 줄을 내보내지 않는다.
  const unsafe = withRuntimeLogs(
    () =>
      ok({
        state: "none",
        lines: [],
        collected_at: null,
        truncated: false,
        as_of_seq: "7",
        next_cursor: null,
      }),
    sources({ redact: () => null }),
  );
  const withheld = await unsafe(ctx as never, { app: APP });
  assert(withheld.ok);
  assertEquals(
    (withheld.value as { state: string; lines: string[] }).lines,
    [],
  );
  assertEquals((withheld.value as { state: string }).state, "none");
});
