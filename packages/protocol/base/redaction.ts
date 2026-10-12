import { z } from "zod";
import { definePort } from "./ports.ts";
import { defineWorker } from "../server/route.ts";
import { sha256Schema } from "./values.ts";

const MIB = 1024 * 1024;
const KIB = 1024;

// architecture/platform 5.8의 고정 한도.
export const REDACTION_UNIT_MAX_BYTES = MIB;
export const REDACTION_MAX_DEPTH = 16;
export const REDACTION_MAX_ITEMS = 4096;
export const REDACTION_TIMEOUT_MS = 5_000;
export const REDACTION_REPLACEMENT = "*";
export const REDACTION_SAMPLE_MAX_CHARS = 64;
export const REDACTION_SAMPLE_MAX_BYTES = 2 * KIB;
export const REDACTION_SCREEN_STRING_MAX_CHARS = 80;

export const REDACTION_AUDIENCES = [
  "storage",
  "display",
  "model",
  "external",
] as const;
export const redactionAudienceSchema = z.enum(REDACTION_AUDIENCES);
export type RedactionAudience = z.infer<typeof redactionAudienceSchema>;

export const REDACTION_STATUSES = ["passed", "partial", "omitted"] as const;
export const redactionStatusSchema = z.enum(REDACTION_STATUSES);
export type RedactionStatus = z.infer<typeof redactionStatusSchema>;

export const OMISSION_REASONS = [
  "private",
  "secret_detected",
  "unsupported_media",
  "limit_exceeded",
  "redaction_failed",
  "uncertain",
] as const;
export const omissionReasonSchema = z.enum(OMISSION_REASONS);
export type OmissionReason = z.infer<typeof omissionReasonSchema>;

// 단독 `*`와 구간 중간 `*`는 원값 경로가 아니다(platform/redaction#R11).
const FIELD_PATH =
  /^(?!\*)[A-Za-z_][A-Za-z0-9_]*(?:\[[0-9]+\]|\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export const fieldPathSchema = z.string().regex(FIELD_PATH);

export type FieldPath = z.infer<typeof fieldPathSchema>;

const fieldPathsSchema = z.array(fieldPathSchema).refine(
  (paths) => new Set(paths).size === paths.length,
  { message: "duplicate field path" },
);

// 원문 메모리 참조. 바이트 자체는 pipe payload에 넣지 않는다.
export const redactionSourceSchema = z.strictObject({
  concern: z.string().min(1),
  revision: z.string().min(1),
  scope: z.string().min(1),
});
export type RedactionSource = z.infer<typeof redactionSourceSchema>;

export const redactionInputSchema = z.strictObject({
  source: redactionSourceSchema,
  media_type: z.string().min(1),
  audience: redactionAudienceSchema,
  safe_fields: fieldPathsSchema,
  private_fields: fieldPathsSchema,
});
export type RedactionInput = z.infer<typeof redactionInputSchema>;

// 검출한 값·길이·원문 일부를 담지 않는다(platform/redaction#R6, R7, R17).
export const redactedItemSchema = z.object({
  location: z.string().min(1),
});
export type RedactedItem = z.infer<typeof redactedItemSchema>;

export const redactionOmissionSchema = z.object({
  location: z.string().min(1),
  reason: omissionReasonSchema,
  message: z.string().min(1),
});
export type RedactionOmission = z.infer<typeof redactionOmissionSchema>;

const inlineContentSchema = z.object({
  kind: z.literal("inline"),
  value: z.string(),
});

const blobContentSchema = z.object({
  kind: z.literal("blob"),
  hash: sha256Schema,
});

export const redactionContentSchema = z.discriminatedUnion("kind", [
  inlineContentSchema,
  blobContentSchema,
]);
export type RedactionContent = z.infer<typeof redactionContentSchema>;

export const redactionResultSchema = z.object({
  rule_revision: z.string().min(1),
  status: redactionStatusSchema,
  content: redactionContentSchema.nullable(),
  redacted_items: z.array(redactedItemSchema),
  omissions: z.array(redactionOmissionSchema),
}).refine(
  (result) => result.status !== "omitted" || result.content === null,
  { message: "omitted result keeps no content" },
).refine(
  (result) => result.status === "passed" || result.omissions.length >= 1,
  { message: "partial and omitted results name an omission" },
);
export type RedactionResult = z.infer<typeof redactionResultSchema>;

export const redactionRulesSchema = z.object({
  revision: z.string().min(1),
  replacement: z.literal(REDACTION_REPLACEMENT),
  pattern_revision: z.string().min(1),
});
export type RedactionRules = z.infer<typeof redactionRulesSchema>;

// 안전 필드·private 필드·표본 원값 경로. 표본 경로는 명시 경로만이다.
export const redactionFieldDeclarationSchema = z.strictObject({
  safe_fields: fieldPathsSchema,
  private_fields: fieldPathsSchema,
  sample_paths: fieldPathsSchema,
});
export type RedactionFieldDeclaration = z.infer<
  typeof redactionFieldDeclarationSchema
>;

// domain-model/platform/security.md TrustClass. 자료 문자열로 승격하지 않는다.
export const TRUST_CLASSES = [
  "platform_rule",
  "user_request",
  "platform_fact",
  "data",
] as const;
export const trustClassSchema = z.enum(TRUST_CLASSES);
export type TrustClass = z.infer<typeof trustClassSchema>;

// 출처 불명은 data다(platform/security#R11). 구현은 platform이 entry로 받는다.
export type DataEnvelope = {
  trust: TrustClass;
  text: string;
  source?: string;
  revision?: string;
};

export type Redactor = (
  input: RedactionInput,
) => RedactionResult | Promise<RedactionResult>;

export type DataSerializer = (value: DataEnvelope) => string;

export const REDACTOR_PORT = definePort<Redactor>("redaction.redactor");
export const DATA_SERIALIZER_PORT = definePort<DataSerializer>(
  "redaction.data_serializer",
);

export const REDACTION_CHECK_OP = "redaction.check";

export const redactionCheck = defineWorker({
  resource: "redaction",
  method: "check",
  name: REDACTION_CHECK_OP,
  input: redactionInputSchema,
  output: redactionResultSchema,
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: ["invalid_input", "unavailable"],
});

export const REDACTION_PIPE_OPS = [redactionCheck] as const;
