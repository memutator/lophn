import { assert, assertEquals } from "@std/assert";
import {
  COMPONENT_KINDS,
  componentObservationSchema,
  defaultHarnessSetting,
  DISCOVERY_RESULTS,
  HARNESS_IDS,
  harnessDetectionSchema,
  harnessEnabledSetting,
  harnessIdSchema,
  harnessIntegrationObservationSchema,
  harnessSuggestionSchema,
  integrationTargetSchema,
  LOADING_RESULTS,
  LOADING_STAGES,
  loadingCheckSchema,
  RECEIPT_OUTCOMES,
  receiptOutcomeSchema,
  resourceInstallResultSchema,
} from "./harnesses.ts";

const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-05T00:00:00.000Z";

const detection = {
  harness_id: "claude" as const,
  catalog_revision: "rev-1",
  environment: { kind: "host" as const, identity: "work" },
  profile_id: null,
  observed_at: AT,
  discovery: "detected" as const,
  candidates: [
    { path: "/usr/local/bin/claude", source: "PATH", executable_result: "ok" },
  ],
  selected_executable: "/usr/local/bin/claude",
  version: { result: "verified" as const, value: "2.1.0", reason: null },
  auth: { result: "verified" as const, evidence: "keychain", reason: null },
  probe_results: [],
  freshness: "fresh" as const,
};

const target = {
  scope_kind: "user" as const,
  environment: { kind: "host" as const, identity: "work" },
  profile_id: null,
  harness_id: "claude" as const,
  app: null,
  app_realpath: null,
};

const loadingChecks = LOADING_STAGES.map((stage) => ({
  stage,
  result: "success" as const,
  reason: ".",
}));

const observation = {
  target,
  connection: CAC,
  catalog_revision: "rev-1",
  adapter_revision: "rev-1",
  observed_at: AT,
  components: [
    {
      kind: "skill" as const,
      resource_identity: "lophn-navigate",
      expected_version: "1",
      expected_hash: "ab".repeat(32),
      observed_version: "1",
      observed_hash: "ab".repeat(32),
      effective_target: "/home/u/.claude/skills/lophn-navigate",
      ownership: "owned" as const,
      state: "current" as const,
      receipt_ref: "receipt-1",
      reason: ".",
      observed_at: AT,
    },
  ],
  loading_checks: loadingChecks,
};

Deno.test(
  "coding-agent/harnesses#R1: 일곱 제품 id를 공개한다",
  () => {
    assertEquals(HARNESS_IDS, [
      "claude",
      "codex",
      "opencode",
      "gemini",
      "hermes",
      "pi",
      "openclaw",
    ]);
    assertEquals(harnessIdSchema.parse("hermes"), "hermes");
    assert(assertEquals(HARNESS_IDS.length, 7) === undefined);
  },
);

Deno.test(
  "coding-agent/harnesses#R3: 감지 결과는 발견·version·인증을 나눈다",
  () => {
    assertEquals(DISCOVERY_RESULTS, [
      "unobserved",
      "detected",
      "absent",
      "unknown",
      "error",
    ]);
    assertEquals(
      harnessDetectionSchema.parse(detection).selected_executable,
      "/usr/local/bin/claude",
    );
    assert(
      !harnessDetectionSchema.safeParse({
        ...detection,
        selected_executable: null,
      }).success,
    );
    const timeout = harnessDetectionSchema.parse({
      ...detection,
      discovery: "unknown",
      selected_executable: null,
      version: { result: "unknown", value: null, reason: "version timeout" },
      auth: { result: "unknown", evidence: null, reason: "auth probe timeout" },
    });
    assertEquals(timeout.version.result, "unknown");
    assert(
      !harnessDetectionSchema.safeParse({
        ...detection,
        discovery: "absent",
        selected_executable: "/usr/local/bin/claude",
      }).success,
    );
    assert(
      !harnessDetectionSchema.safeParse({
        ...detection,
        version: { result: "verified", value: null, reason: null },
      }).success,
    );
  },
);

Deno.test(
  "coding-agent/harnesses#R10: loading 검사는 네 stage 각각 한 번이다",
  () => {
    assertEquals(LOADING_STAGES, [
      "mcp_initialize",
      "tool_discovery",
      "skill_discovery",
      "app_guide_loading",
    ]);
    assertEquals(LOADING_RESULTS, ["success", "failure", "unknown"]);
    assertEquals(
      harnessIntegrationObservationSchema.parse(observation).components.length,
      1,
    );
    assert(
      !harnessIntegrationObservationSchema.safeParse({
        ...observation,
        loading_checks: loadingChecks.slice(0, 3),
      }).success,
    );
    assert(
      !harnessIntegrationObservationSchema.safeParse({
        ...observation,
        loading_checks: [...loadingChecks, loadingChecks[0]],
      }).success,
    );
    const failed = loadingCheckSchema.parse({
      stage: "mcp_initialize",
      result: "failure",
      reason: "server did not initialize",
    });
    assertEquals(failed.result, "failure");
    assertEquals(COMPONENT_KINDS, [
      "cli_wrapper",
      "mcp",
      "skill",
      "guide",
      "hook",
    ]);
    assertEquals(
      componentObservationSchema.parse(observation.components[0]).state,
      "current",
    );
  },
);

Deno.test(
  "coding-agent/harnesses#R9: 설치 결과는 resource별 outcome과 receipt를 낸다",
  () => {
    assertEquals(RECEIPT_OUTCOMES, [
      "changed",
      "unchanged",
      "skipped",
      "conflict",
      "failed",
    ]);
    const changed = resourceInstallResultSchema.parse({
      resource_identity: "lophn-navigate",
      outcome: "changed",
      receipt_stored: true,
      reason: ".",
    });
    assertEquals(changed.outcome, "changed");
    const partial = [
      resourceInstallResultSchema.parse({
        resource_identity: "lophn-save",
        outcome: "changed",
        receipt_stored: true,
        reason: ".",
      }),
      resourceInstallResultSchema.parse({
        resource_identity: "lophn-build-app",
        outcome: "failed",
        receipt_stored: false,
        reason: "second file write failed",
      }),
    ];
    assertEquals(partial[1].receipt_stored, false);
    assertEquals(receiptOutcomeSchema.parse("skipped"), "skipped");
    assert(receiptOutcomeSchema.safeParse("reverted").success === false);
  },
);

Deno.test(
  "coding-agent/harnesses#R5: target은 user와 app 둘뿐이고 기본 harness는 nullable이다",
  () => {
    assertEquals(integrationTargetSchema.parse(target).scope_kind, "user");
    const appTarget = integrationTargetSchema.parse({
      ...target,
      scope_kind: "app",
      app: "app_01h455vb4pex5v6nkc6gd5fdw1",
      app_realpath: "/work/app",
    });
    assertEquals(appTarget.scope_kind, "app");
    assert(
      !integrationTargetSchema.safeParse({
        ...target,
        scope_kind: "app",
        app: null,
        app_realpath: null,
      }).success,
    );
    assert(
      !integrationTargetSchema.safeParse({
        ...target,
        scope_kind: "app",
        app: "app_01h455vb4pex5v6nkc6gd5fdw1",
        app_realpath: null,
      }).success,
    );
    assert(defaultHarnessSetting.default === null);
    assert(defaultHarnessSetting.value_type.safeParse("codex").success);
    assertEquals(harnessEnabledSetting.default, true);
  },
);

Deno.test(
  "coding-agent/harnesses#R5: 제안은 후보 하나를 가리키고 이유와 짝이다",
  () => {
    const proposed = harnessSuggestionSchema.parse({
      suggested_harness: "claude",
      candidates: [detection.candidates[0]],
      reason: null,
    });
    assertEquals(proposed.suggested_harness, "claude");
    const empty = harnessSuggestionSchema.parse({
      suggested_harness: null,
      candidates: [],
      reason: "no verified executable candidate",
    });
    assertEquals(empty.candidates.length, 0);
    assert(
      !harnessSuggestionSchema.safeParse({
        suggested_harness: null,
        candidates: [],
        reason: null,
      }).success,
    );
  },
);
