import { assertEquals, assert } from "@std/assert";
import {
  childless,
  projection,
  reasonOf,
  stateOf,
  startedNeedsLive,
  terminationWithinGrace,
  withTerminationPending,
  TERMINATION_CONFIRM_WINDOW_MS,
} from "./model.ts";
import type { App } from "../../contracts/apps/mod.ts";
import type { RuntimeObservation } from "../../contracts/apps/mod.ts";

// App 값의 규칙은 contract schema refine이 이미 검사한다. 테스트 값은 그 모양이다.
function app(overrides: Partial<App> = {}): App {
  return {
    id: "app_01h455vb4pex5v6nkc6gd5fdw1",
    slug: "usage",
    name: "Usage",
    description: "collect usage",
    planning_version: null,
    source_path: null,
    active_release: null,
    revision: "1",
    run_enabled: false,
    status: "active",
    ...overrides,
  };
}

function observation(
  overrides: Partial<RuntimeObservation> = {},
): RuntimeObservation {
  return {
    app: "app_01h455vb4pex5v6nkc6gd5fdw1",
    release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
    mode: "live",
    process_nonce: "nonce-1",
    endpoint: "http://127.0.0.1:7431",
    ready: true,
    accepting: true,
    ...overrides,
  };
}

Deno.test("apps/runtime#R13: release 없음=preparing, 사람이 멈춤=stopped, 응답함=running, 허용됐지만 응답 없음=unavailable", () => {
  // release가 없으면 preparing이다.
  assertEquals(
    stateOf(app()),
    { state: "preparing", termination_pending: false },
  );
  // app이 없으면 preparing이다(기동 준비).
  assertEquals(
    stateOf(null),
    { state: "preparing", termination_pending: false },
  );
  // 사람이 멈춤(run_enabled=false)은 stopped다. active release가 있어도 stopped다.
  assertEquals(
    stateOf(
      app({
        run_enabled: false,
        active_release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
      }),
    ),
    { state: "stopped", termination_pending: false },
  );
  // 보관 상태는 stopped다.
  assertEquals(
    stateOf(app({ status: "archived", run_enabled: true })),
    { state: "stopped", termination_pending: false },
  );
  // 허용됐지만 응답 없음은 unavailable이고 reason이 필요하다(R13).
  const enabled = app({
    run_enabled: true,
    active_release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
  });
  assertEquals(
    stateOf(enabled),
    {
      state: "unavailable",
      termination_pending: false,
      reason: {
        code: "no_observation",
        summary: "no live observation of the current release",
      },
    },
  );
  // live 관측이 ready·accepting이면 running이다.
  assertEquals(
    projection(enabled, observation()),
    { state: "running", termination_pending: false },
  );
});

Deno.test("apps/runtime#R13: 상세 이유는 reason에만 있고 termination_pending은 상태와 별개 field다", () => {
  const pending = withTerminationPending({
    state: "unavailable",
    termination_pending: false,
    reason: { code: "unexpected_exit", summary: "the app process exited" },
  });
  assertEquals(pending.termination_pending, true);
  // reason은 상세 이유에만 있다.
  assertEquals(
    reasonOf(pending),
    { code: "unexpected_exit", summary: "the app process exited" },
  );
  // reason 없는 unavailable은 규칙에서 만들지 않는다(R13).
  assertEquals(reasonOf(stateOf(app())), undefined);
  // stopped 뒤 유예 중 termination_pending이다(R15).
  const stopped = withTerminationPending({
    state: "stopped",
    termination_pending: false,
  });
  assertEquals(stopped.termination_pending, true);
  // preparing 뒤에는 termination_pending이 없다.
  assertEquals(
    withTerminationPending({ state: "preparing", termination_pending: false })
      .termination_pending,
    false,
  );
  assertEquals(
    withTerminationPending({ state: "running", termination_pending: false })
      .termination_pending,
    false,
  );
});

Deno.test("apps/runtime#R13: 과거 event만으로 running이라 하지 않는다", () => {
  const enabled = app({
    run_enabled: true,
    active_release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
  });
  const noLive = {
    state: "unavailable",
    termination_pending: false,
    reason: {
      code: "no_observation",
      summary: "no live observation of the current release",
    },
  };
  // 관측이 없으면 running이라 하지 않는다(R13). 근거는 reason에만 있다(R13).
  assertEquals(projection(enabled, null), noLive);
  // AppStopped 등 과거 event는 관측이 아니다. state는 live 관측만 믿는다.
  assertEquals(projection(enabled, undefined), noLive);
  // release가 다른 관측은 생존의 근거가 아니다.
  assertEquals(
    projection(
      enabled,
      observation({ release: "rel_01h455vb4pex5v6nkc6gd5fdw2" }),
    ),
    noLive,
  );
  // preview mode의 관측으로 running이라 하지 않는다.
  assertEquals(projection(enabled, observation({ mode: "preview" })), noLive);
  // ready=false 관측에는 reason이 필요하고 running은 아니다. 근거는 관측의 reason이다.
  assertEquals(
    projection(
      enabled,
      observation({
        ready: false,
        accepting: false,
        reason: { code: "start_failed", summary: "probe missing" },
      }),
    ),
    {
      state: "unavailable",
      termination_pending: false,
      reason: { code: "start_failed", summary: "probe missing" },
    },
  );
});

Deno.test("apps/runtime#R15: 종료 확인 유예는 10초고 그 안에 요청한 stopped만 유예 중이다", () => {
  assertEquals(TERMINATION_CONFIRM_WINDOW_MS, 10_000);
  const requested = 1_000_000;
  // 유예 안이다.
  assertEquals(terminationWithinGrace(requested, requested + 9_999), true);
  // 유예가 지났다.
  assertEquals(terminationWithinGrace(requested, requested + 10_000), false);
  assertEquals(terminationWithinGrace(requested, requested + 20_000), false);
  // 유예 window를 바꿔 본다.
  assertEquals(
    terminationWithinGrace(requested, requested + 5_000, 5_000),
    false,
  );
  assertEquals(terminationWithinGrace(requested, requested + 4_999, 5_000), true);
});

Deno.test("apps/runtime#R13: childless 관측은 nonce·시작 시각이 없고 started는 live release가 필요하다", () => {
  // crash loop로 멈춘 상태의 관측은 자식 신원이 없다.
  assertEquals(
    childless({
      type: "AppUnavailable",
      app: "app_01h455vb4pex5v6nkc6gd5fdw1",
      release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
    }),
    true,
  );
  assertEquals(
    childless({
      type: "AppUnavailable",
      app: "app_01h455vb4pex5v6nkc6gd5fdw1",
      release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
      process_nonce: "nonce-1",
    }),
    false,
  );
  // startedNeedsLive는 live release를 주장하는지 본다.
  assert(startedNeedsLive({ release: "rel_01h455vb4pex5v6nkc6gd5fdw1" }).ok);
  const missing = startedNeedsLive({ release: null });
  assert(!missing.ok);
  assertEquals(missing.error.code, "invalid_input");
  assertEquals(missing.error.message, "AppStarted needs a live release");
});
