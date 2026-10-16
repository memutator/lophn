import { z } from "zod";
import { atSchema } from "../base/values.ts";
import { HARNESS_IDS, type HarnessId, harnessIdSchema } from "./harness-id.ts";

export { HARNESS_IDS, type HarnessId, harnessIdSchema };

// PATH와 정한 bounded fallback만 읽는다. home 전체 순회는 없다.
const DISCOVERY_RESULTS = [
  "unobserved",
  "detected",
  "absent",
  "unknown",
  "error",
] as const;

const discoveryResultSchema = z.enum(DISCOVERY_RESULTS);

const harnessCandidateSchema = z.object({
  path: z.string().min(1),
  source: z.string().min(1),
  executable_result: z.string().min(1),
});

export type HarnessCandidate = z.infer<typeof harnessCandidateSchema>;

// parsed version 성공만 verified다. 존재만으로 인정하지 않는다.
const VERSION_RESULTS = ["verified", "unknown", "error"] as const;

const versionResultSchema = z.enum(VERSION_RESULTS);

const pairedReason = <T extends z.ZodRawShape>(fields: T) =>
  z.object(fields).refine(
    (value: Record<string, unknown>) =>
      (value.value !== null) === (value.reason === null),
    { message: "value and reason must pair" },
  );

const harnessVersionSchema = pairedReason({
  result: versionResultSchema,
  value: z.string().min(1).nullable(),
  reason: z.string().min(1).nullable(),
});

export type HarnessVersion = z.infer<typeof harnessVersionSchema>;

// auth 파일 존재만으로 verified 금지. 원문은 없다.
const AUTH_RESULTS = [
  "verified",
  "not_verified",
  "unknown",
  "error",
  "unverified_capability",
] as const;

export const authResultSchema = z.enum(AUTH_RESULTS);

const harnessAuthSchema = z.object({
  result: authResultSchema,
  evidence: z.string().min(1).nullable(),
  reason: z.string().min(1).nullable(),
}).refine(
  (value) => (value.evidence !== null) === (value.reason === null),
  { message: "auth evidence and reason must pair" },
);

export type HarnessAuth = z.infer<typeof harnessAuthSchema>;

// raw stdout는 없다. classifier·timeout·side effects만 남긴다.
const harnessProbeResultSchema = z.object({
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
