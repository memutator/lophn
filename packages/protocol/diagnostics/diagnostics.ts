import { z } from "zod";
import { withReadCommon } from "../server/envelope.ts";
import { ACTOR_KINDS, defineRead } from "../server/route.ts";
import { redactionResultSchema } from "../base/redaction.ts";
import { atSchema } from "../base/values.ts";

// domain-model platform/diagnostics. 등록 component·code 목록은 아직 정하지 않았다.
export const DIAGNOSTIC_RECORD_KINDS = ["log", "crash", "health"] as const;

export const diagnosticRecordKindSchema = z.enum(DIAGNOSTIC_RECORD_KINDS);

export type DiagnosticRecordKind = z.infer<typeof diagnosticRecordKindSchema>;

export const diagnosticRecordSchema = z.object({
  at: atSchema,
  component: z.string().min(1),
  kind: diagnosticRecordKindSchema,
  code: z.string().min(1),
  error_type: z.string().min(1).nullable(),
  location: z.string().min(1).nullable(),
  message: z.string().nullable(),
  redaction: redactionResultSchema,
});

export type DiagnosticRecord = z.infer<typeof diagnosticRecordSchema>;

// doctor가 실제로 검사하는 항목(platform/diagnostics#R9, R10).
export const DIAGNOSTIC_CHECKS = [
  "sdk_hash",
  "credential_permission",
  "broad_grant",
  "file_and_network_grant",
  "unused_grant",
  "raw_key_pattern",
] as const;

export const diagnosticCheckSchema = z.enum(DIAGNOSTIC_CHECKS);

export type DiagnosticCheck = z.infer<typeof diagnosticCheckSchema>;

export const diagnosticCheckResultSchema = z.object({
  check: diagnosticCheckSchema,
  observed_at: atSchema,
  finding: diagnosticRecordSchema.nullable(),
}).refine(
  (value) => value.finding === null || value.finding.kind === "health",
  { message: "a check finding is a health observation" },
);

export type DiagnosticCheckResult = z.infer<typeof diagnosticCheckResultSchema>;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "unavailable",
] as const;

export const diagnosticsList = defineRead({
  resource: "diagnostics",
  method: "list",
  name: "ListDiagnostics",
  input: z.strictObject({
    component: z.string().min(1).optional(),
    kind: diagnosticRecordKindSchema.optional(),
  }),
  output: withReadCommon(z.object({
    records: z.array(diagnosticRecordSchema),
  })),
  actors: ACTOR_KINDS,
  errors: readErrors,
});

export const diagnosticsCheck = defineRead({
  resource: "diagnostics",
  method: "check",
  name: "CheckDiagnostics",
  input: z.strictObject({
    checks: z.array(diagnosticCheckSchema).optional(),
  }),
  output: withReadCommon(z.object({
    results: z.array(diagnosticCheckResultSchema),
    observed_at: atSchema,
  })),
  actors: ACTOR_KINDS,
  errors: readErrors,
});

export const DIAGNOSTIC_ROUTES = [diagnosticsList, diagnosticsCheck] as const;
