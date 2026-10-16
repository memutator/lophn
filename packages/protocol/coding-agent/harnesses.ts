import { z } from "zod";
import { defineSetting } from "../config/settings.ts";
import { atSchema } from "../base/values.ts";
import { HARNESS_IDS, type HarnessId, harnessIdSchema } from "./harness-id.ts";

export { HARNESS_IDS, type HarnessId, harnessIdSchema };

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
  observed_at: atSchema,
  discovery: discoveryResultSchema,
  candidates: z.array(harnessCandidateSchema),
  selected_executable: z.string().min(1).nullable(),
  version: harnessVersionSchema,
  auth: harnessAuthSchema,
  probe_results: z.array(harnessProbeResultSchema),
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
