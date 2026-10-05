import { assert, assertEquals } from "@std/assert";
import type { App, RuntimeObservation } from "../../contracts/apps/mod.ts";
import type { RequestContext } from "../../contracts/platform/mod.ts";
import { createRuntimeReads } from "./reads.ts";
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
