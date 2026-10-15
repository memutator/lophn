import { z } from "zod";
import { defineSetting } from "../config/settings.ts";
import { atSchema, sha256Schema } from "../base/values.ts";
import { connectionIdSchema } from "./connections.ts";
import { HARNESS_IDS, type HarnessId, harnessIdSchema } from "./harness-id.ts";

export { HARNESS_IDS, type HarnessId, harnessIdSchema };

// native machine identity·distro·remote identity를 구별한다. 지금 host만 수집이다.
export const harnessEnvironmentSchema = z.object({
  kind: z.enum(["host", "wsl", "remote"]),
  identity: z.string().min(1),
});

export type HarnessEnvironment = z.infer<typeof harnessEnvironmentSchema>;

// PATH와 정한 bounded fallback만 읽는다. home 전체 순회는 없다.
export const DISCOVERY_RESULTS = [
  "unobserved",
  "detected",
  "absent",
  "unknown",
  "error",
] as const;

export const discoveryResultSchema = z.enum(DISCOVERY_RESULTS);

export type DiscoveryResult = z.infer<typeof discoveryResultSchema>;

export const harnessCandidateSchema = z.object({
  path: z.string().min(1),
  source: z.string().min(1),
  executable_result: z.string().min(1),
});

export type HarnessCandidate = z.infer<typeof harnessCandidateSchema>;

// parsed version 성공만 verified다. 존재만으로 인정하지 않는다.
export const VERSION_RESULTS = ["verified", "unknown", "error"] as const;

export const versionResultSchema = z.enum(VERSION_RESULTS);

const pairedReason = <T extends z.ZodRawShape>(fields: T) =>
  z.object(fields).refine(
    (value: Record<string, unknown>) =>
      (value.value !== null) === (value.reason === null),
    { message: "value and reason must pair" },
  );

export const harnessVersionSchema = pairedReason({
  result: versionResultSchema,
  value: z.string().min(1).nullable(),
  reason: z.string().min(1).nullable(),
});

export type HarnessVersion = z.infer<typeof harnessVersionSchema>;

// auth 파일 존재만으로 verified 금지. 원문은 없다.
export const AUTH_RESULTS = [
  "verified",
  "not_verified",
  "unknown",
  "error",
  "unverified_capability",
] as const;

export const authResultSchema = z.enum(AUTH_RESULTS);

export const harnessAuthSchema = z.object({
  result: authResultSchema,
  evidence: z.string().min(1).nullable(),
  reason: z.string().min(1).nullable(),
}).refine(
  (value) => (value.evidence !== null) === (value.reason === null),
  { message: "auth evidence and reason must pair" },
);

export type HarnessAuth = z.infer<typeof harnessAuthSchema>;

// raw stdout는 없다. classifier·timeout·side effects만 남긴다.
export const harnessProbeResultSchema = z.object({
  probe: z.string().min(1),
  outcome: z.string().min(1),
  detail: z.string().min(1).nullable(),
});

export type HarnessProbeResult = z.infer<typeof harnessProbeResultSchema>;

export const harnessDetectionSchema = z.object({
  harness_id: harnessIdSchema,
  catalog_revision: z.string().min(1),
  environment: harnessEnvironmentSchema,
  profile_id: z.string().min(1).nullable(),
  observed_at: atSchema,
  discovery: discoveryResultSchema,
  candidates: z.array(harnessCandidateSchema),
  selected_executable: z.string().min(1).nullable(),
  version: harnessVersionSchema,
  auth: harnessAuthSchema,
  probe_results: z.array(harnessProbeResultSchema),
  freshness: z.enum(["fresh", "stale"]),
}).refine(
  (value) =>
    (value.discovery === "detected") ===
      (value.selected_executable !== null),
  { message: "selected executable follows discovery" },
).refine(
  (value) =>
    value.version.result !== "verified" || value.version.value !== null,
  { message: "verified version needs a value" },
);

export type HarnessDetection = z.infer<typeof harnessDetectionSchema>;

// user이면 app 값 둘 다 null, app이면 둘 다 필수다(domain-model harnesses).
export const integrationTargetSchema = z.discriminatedUnion("scope_kind", [
  z.strictObject({
    scope_kind: z.literal("user"),
    environment: harnessEnvironmentSchema,
    profile_id: z.string().min(1).nullable(),
    harness_id: harnessIdSchema,
    app: z.null(),
    app_realpath: z.null(),
  }),
  z.strictObject({
    scope_kind: z.literal("app"),
    environment: harnessEnvironmentSchema,
    profile_id: z.string().min(1).nullable(),
    harness_id: harnessIdSchema,
    app: z.string().min(1),
    app_realpath: z.string().min(1),
  }),
]);

export type IntegrationTarget = z.infer<typeof integrationTargetSchema>;

export const COMPONENT_KINDS = [
  "cli_wrapper",
  "mcp",
  "skill",
  "guide",
  "hook",
] as const;

export const componentKindSchema = z.enum(COMPONENT_KINDS);

export type ComponentKind = z.infer<typeof componentKindSchema>;

export const COMPONENT_STATES = [
  "missing",
  "current",
  "outdated",
  "modified",
  "conflict",
  "unknown",
  "error",
] as const;

export const componentStateSchema = z.enum(COMPONENT_STATES);

export type ComponentState = z.infer<typeof componentStateSchema>;

export const componentObservationSchema = z.object({
  kind: componentKindSchema,
  resource_identity: z.string().min(1),
  expected_version: z.string().min(1).nullable(),
  expected_hash: sha256Schema.nullable(),
  observed_version: z.string().min(1).nullable(),
  observed_hash: sha256Schema.nullable(),
  effective_target: z.string().min(1),
  ownership: z.enum(["owned", "unowned", "unknown"]),
  state: componentStateSchema,
  receipt_ref: z.string().min(1).nullable(),
  reason: z.string().min(1),
  observed_at: atSchema,
});

export type ComponentObservation = z.infer<typeof componentObservationSchema>;

// 네 stage 각각 한 번씩이다. current 파일이 loading success가 아니다.
export const LOADING_STAGES = [
  "mcp_initialize",
  "tool_discovery",
  "skill_discovery",
  "app_guide_loading",
] as const;

export const loadingStageSchema = z.enum(LOADING_STAGES);

export type LoadingStage = z.infer<typeof loadingStageSchema>;

export const LOADING_RESULTS = ["success", "failure", "unknown"] as const;

export const loadingResultSchema = z.enum(LOADING_RESULTS);

export type LoadingResult = z.infer<typeof loadingResultSchema>;

export const loadingCheckSchema = z.object({
  stage: loadingStageSchema,
  result: loadingResultSchema,
  reason: z.string().min(1),
}).refine(
  (value) => value.result === "success" || value.reason !== "",
  { message: "failure and unknown need a reason" },
);

export type LoadingCheck = z.infer<typeof loadingCheckSchema>;

export const harnessIntegrationObservationSchema = z.object({
  target: integrationTargetSchema,
  connection: connectionIdSchema.nullable(),
  catalog_revision: z.string().min(1),
  adapter_revision: z.string().min(1),
  observed_at: atSchema,
  components: z.array(componentObservationSchema),
  loading_checks: z.array(loadingCheckSchema),
}).refine(
  (value) => value.loading_checks.length === LOADING_STAGES.length,
  { message: "each loading stage appears exactly once" },
).refine(
  (value) =>
    new Set(value.loading_checks.map((check) => check.stage)).size ===
      value.loading_checks.length,
  { message: "loading stages must be unique" },
);

export type HarnessIntegrationObservation = z.infer<
  typeof harnessIntegrationObservationSchema
>;

// 설치는 resource별 outcome과 receipt 결과를 낸다.
export const RECEIPT_OUTCOMES = [
  "changed",
  "unchanged",
  "skipped",
  "conflict",
  "failed",
] as const;

export const receiptOutcomeSchema = z.enum(RECEIPT_OUTCOMES);

export type ReceiptOutcome = z.infer<typeof receiptOutcomeSchema>;

export const resourceInstallResultSchema = z.object({
  resource_identity: z.string().min(1),
  outcome: receiptOutcomeSchema,
  receipt_stored: z.boolean(),
  reason: z.string().min(1),
});

export type ResourceInstallResult = z.infer<typeof resourceInstallResultSchema>;

// 비었으면 enabled·detected·검증된 후보 하나를 제안한다.
export const harnessSuggestionSchema = z.object({
  suggested_harness: harnessIdSchema.nullable(),
  candidates: z.array(harnessCandidateSchema),
  reason: z.string().min(1).nullable(),
}).refine(
  (value) => (value.suggested_harness !== null) === (value.reason === null),
  { message: "suggestion pairs with a reason" },
);

export type HarnessSuggestion = z.infer<typeof harnessSuggestionSchema>;

// harness 설정 key 3개다. secret 값은 넣지 않는다(domain-model harnesses).
const settingKeys = {
  display_name_key: "settings.coding-agent.harnesses.name",
  value_meaning_key: "settings.coding-agent.harnesses.value",
  default_meaning_key: "settings.coding-agent.harnesses.default",
  risk_key: "settings.coding-agent.harnesses.risk",
  revert_key: "settings.coding-agent.harnesses.revert",
  apply_at_key: "settings.coding-agent.harnesses.apply_at",
} as const;

export const harnessEnabledSetting = defineSetting({
  ...settingKeys,
  display_name_key: "settings.coding-agent.harnesses.enabled.name",
  key: "coding-agent.harnesses.enabled",
  owner: "coding-agent/harnesses",
  description: "Turn the harness integration on or off.",
  value_meaning_key: "settings.coding-agent.harnesses.enabled.value",
  default_meaning_key: "settings.coding-agent.harnesses.enabled.default",
  affected_features: ["coding-agent/harnesses"],
  risk_key: "settings.coding-agent.harnesses.enabled.risk",
  revert_key: "settings.coding-agent.harnesses.enabled.revert",
  constraints: { values: [true, false] },
  required: false,
  layers: ["common"],
  apply_at: "next_turn",
  apply_at_key: "settings.coding-agent.harnesses.enabled.apply_at",
  machine_local: true,
  default_present: true,
  default: true,
  value_type: z.boolean(),
});

export const defaultHarnessSetting = defineSetting({
  key: "coding-agent.default_harness",
  owner: "coding-agent/harnesses",
  display_name_key: "settings.coding-agent.default_harness.name",
  description: "Harness the connection install suggests first.",
  value_meaning_key: "settings.coding-agent.default_harness.value",
  default_meaning_key: "settings.coding-agent.default_harness.default",
  affected_features: ["coding-agent/harnesses", "coding-agent/sessions"],
  risk_key: "settings.coding-agent.default_harness.risk",
  revert_key: "settings.coding-agent.default_harness.revert",
  constraints: {
    harness_ids: [...HARNESS_IDS],
    nullable: true,
  },
  required: false,
  layers: ["common"],
  apply_at: "next_turn",
  apply_at_key: "settings.coding-agent.default_harness.apply_at",
  machine_local: true,
  default_present: true,
  default: null,
  value_type: harnessIdSchema.nullable(),
});

export const harnessProfileSetting = defineSetting({
  key: "coding-agent.harnesses.profile",
  owner: "coding-agent/harnesses",
  display_name_key: "settings.coding-agent.harnesses.profile.name",
  description: "Explicit harness profile override on this machine.",
  value_meaning_key: "settings.coding-agent.harnesses.profile.value",
  default_meaning_key: "settings.coding-agent.harnesses.profile.default",
  affected_features: ["coding-agent/harnesses"],
  risk_key: "settings.coding-agent.harnesses.profile.risk",
  revert_key: "settings.coding-agent.harnesses.profile.revert",
  constraints: { max_length: 128 },
  required: false,
  layers: ["common"],
  apply_at: "next_turn",
  apply_at_key: "settings.coding-agent.harnesses.profile.apply_at",
  machine_local: true,
  default_present: false,
  value_type: z.string().min(1).max(128),
});
