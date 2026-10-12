import { assertEquals } from "@std/assert";
import { NO_OBSERVATION, projection, TERMINATING } from "./model.ts";
import type {
  App,
  RuntimeObservation,
  RuntimeState,
} from "../../protocol/apps/mod.ts";

const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const REL2 = "rel_01h455vb4pex5v6nkc6gd5fdw2";

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
    release: REL,
    mode: "live",
    process_nonce: "nonce-1",
    endpoint: null,
    ready: true,
    accepting: true,
    ...overrides,
  };
}

const unavailable: RuntimeState = {
  state: "unavailable",
  termination_pending: false,
  reason: NO_OBSERVATION,
};

Deno.test("apps/runtime#R13: release 없음=preparing, 사람이 멈춤=stopped, 응답함=running, 허용됐지만 응답 없음=unavailable", () => {
  assertEquals(projection(app(), null), {
    state: "preparing",
    termination_pending: false,
  });
  // 허용 값이 켜져 있어도 release가 없으면 preparing이다.
  assertEquals(projection(app({ run_enabled: true }), null).state, "preparing");
  assertEquals(
    projection(app({ active_release: REL }), null),
    { state: "stopped", termination_pending: false },
  );
  // 보관은 release가 있으면 stopped다. 허용 값이 남아 있어도 같다.
  assertEquals(
    projection(
      app({ active_release: REL, status: "archived", run_enabled: true }),
      null,
    ).state,
    "stopped",
  );
  const enabled = app({ active_release: REL, run_enabled: true });
  assertEquals(projection(enabled, null), unavailable);
  assertEquals(projection(enabled, observation()), {
    state: "running",
    termination_pending: false,
  });
});

Deno.test("apps/runtime#R13: 관측이 현재 release의 live ready 연결이 아니면 running이라 하지 않고 이유는 reason에만 둔다", () => {
  const enabled = app({ active_release: REL, run_enabled: true });
  // 다른 release, preview, accepting 아님은 생존 근거가 아니다.
  assertEquals(
    projection(enabled, observation({ release: REL2 })),
    unavailable,
  );
  assertEquals(
    projection(enabled, observation({ mode: "preview" })),
    unavailable,
  );
  assertEquals(
    projection(enabled, observation({ accepting: false })),
    unavailable,
  );
  // 준비 실패 관측은 그 reason을 그대로 보인다.
  const reason = { code: "start_failed", summary: "probe missing" };
  assertEquals(
    projection(
      enabled,
      observation({ ready: false, accepting: false, reason }),
    ),
    { state: "unavailable", termination_pending: false, reason },
  );
});

Deno.test("apps/runtime#R15: 멈춤 뒤 live 자식이 관측되는 동안은 termination_pending이고 관측이 사라지면 끝난다", () => {
  const stopped = app({ active_release: REL, run_enabled: false });
  const stopping = observation({
    ready: false,
    accepting: false,
    reason: TERMINATING,
  });
  assertEquals(projection(stopped, stopping), {
    state: "stopped",
    termination_pending: true,
  });
  // 자식이 아직 ready여도(정지 요청 전) 종료 확인 전이다.
  assertEquals(projection(stopped, observation()).termination_pending, true);
  // 종료 확인 뒤 관측이 없으면 완료다.
  assertEquals(projection(stopped, null).termination_pending, false);
  // 보관도 같은 순서다.
  assertEquals(
    projection(app({ active_release: REL, status: "archived" }), stopping)
      .termination_pending,
    true,
  );
  // 멈춘 앱이 아니면 pending이 없다.
  assertEquals(
    projection(app({ active_release: REL, run_enabled: true }), observation())
      .termination_pending,
    false,
  );
});
