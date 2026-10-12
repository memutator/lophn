import { assertEquals, assertThrows } from "@std/assert";
import type {
  InternalErrorClass,
  ProcessKind,
} from "../../protocol/supervision/mod.ts";
import {
  classifyFailure,
  classifyReport,
  type FailureObservation,
} from "./mod.ts";

const at = "2026-10-04T00:00:00.000Z";
const app = "app_01arz3ndektsv4rrffq69g5fav";
const report = "rpt_01arz3ndektsv4rrffq69g5fav";

function failure(
  component: ProcessKind,
  errorClass: InternalErrorClass,
  location: string,
  extra: Partial<FailureObservation> = {},
): FailureObservation {
  return {
    component,
    observed_at: at,
    count: 1,
    error_class: errorClass,
    location,
    app,
    app_frame: false,
    ...extra,
  };
}

Deno.test("platform/diagnostics#R1 core·SDK·desktop 실패는 앱을 쓰던 중이어도 lophn_internal이고 앱 문제로 가지 않는다", () => {
  const cases: FailureObservation[] = [
    failure("platform/core", "internal_exception", "core.command"),
    failure("apps/sdk-host", "internal_exception", "sdk.host"),
    failure("apps/desktop", "internal_exception", "desktop.frame"),
    failure("platform/core", "disk_full", "core.ledger"),
    failure("platform/io", "ledger_corruption", "io.store"),
  ];
  for (const observation of cases) {
    const result = classifyFailure(observation);
    assertEquals(result.outcome, "platform_diagnostic");
    if (result.outcome !== "platform_diagnostic") continue;
    assertEquals(result.diagnostic.kind, "lophn_internal");
    if (result.diagnostic.kind !== "lophn_internal") continue;
    assertEquals(result.diagnostic.payload, {
      component: observation.component,
      observed_at: at,
      error_class: observation.error_class,
      location: observation.location,
      count: 1,
    });
  }
});

Deno.test("platform/diagnostics#R1 출처 불명 관측과 잘못된 보고는 진단으로 남고 앱 문제로 가지 않는다", () => {
  const unknown = classifyFailure(
    failure("platform/core", "internal_exception", "core.command", {
      error_class: null,
      location: null,
    }),
  );
  assertEquals(unknown, {
    outcome: "platform_diagnostic",
    diagnostic: {
      type: "diagnostic",
      kind: "unattributed_observation",
      payload: { component: "platform/core", observed_at: at, count: 1 },
    },
  });

  const badReport = classifyReport({
    component: "platform/core",
    observed_at: at,
    count: 2,
    report: "not-a-report",
  });
  assertEquals(badReport, {
    outcome: "platform_diagnostic",
    diagnostic: {
      type: "diagnostic",
      kind: "unattributed_observation",
      payload: { component: "platform/core", observed_at: at, count: 2 },
    },
  });

  const kept = classifyReport({
    component: "apps/supervisor",
    observed_at: at,
    count: 1,
    report,
  });
  assertEquals(kept, {
    outcome: "platform_diagnostic",
    diagnostic: {
      type: "diagnostic",
      kind: "invalid_report",
      payload: {
        component: "apps/supervisor",
        observed_at: at,
        report,
        count: 1,
      },
    },
  });
});

Deno.test("platform/diagnostics#R1 앱 코드 frame만 앱 귀속이고 앱 ID가 없으면 진단으로 남는다", () => {
  assertEquals(
    classifyFailure(
      failure("apps/supervisor", "internal_exception", "app.handler", {
        app_frame: true,
      }),
    ),
    { outcome: "app_attribution", app },
  );
  assertEquals(
    classifyFailure(
      failure("apps/supervisor", "internal_exception", "app.handler", {
        app_frame: true,
        app: "nope",
      }),
    ).outcome,
    "platform_diagnostic",
  );
  assertThrows(
    () =>
      classifyFailure(
        failure("platform/core", "internal_exception", "core.command", {
          count: -1,
        }),
      ),
    TypeError,
    "invalid observation count",
  );
});
