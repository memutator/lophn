import { z } from "zod";
import {
  FIELD_PATH_PATTERN,
  OMISSION_REASONS,
  type RedactedItem,
  REDACTION_AUDIENCES,
  REDACTION_REPLACEMENT,
  REDACTION_STATUSES,
  type RedactionContent,
  type RedactionFieldDeclaration,
  type RedactionInput,
  type RedactionOmission,
  type RedactionResult,
  type RedactionSource,
} from "../../base/redaction/mod.ts";
import { definePort } from "./ports.ts";
import { defineWorker } from "./route.ts";
import { sha256Schema } from "./values.ts";

// 한도·모양의 정의는 base/redaction에 있다. 아래 schema는 그 모양을 검사한다.
export const redactionAudienceSchema = z.enum(REDACTION_AUDIENCES);

export const redactionStatusSchema = z.enum(REDACTION_STATUSES);

export const omissionReasonSchema = z.enum(OMISSION_REASONS);

export const fieldPathSchema = z.string().regex(FIELD_PATH_PATTERN);

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

export const redactionInputSchema = z.strictObject({
  source: redactionSourceSchema,
  media_type: z.string().min(1),
  audience: redactionAudienceSchema,
  safe_fields: fieldPathsSchema,
  private_fields: fieldPathsSchema,
});

// 검출한 값·길이·원문 일부를 담지 않는다(platform/redaction#R6, R7, R17).
export const redactedItemSchema = z.object({
  location: z.string().min(1),
});

export const redactionOmissionSchema = z.object({
  location: z.string().min(1),
  reason: omissionReasonSchema,
  message: z.string().min(1),
});

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

// schema가 base의 모양과 어긋나면 type 검사에서 걸린다.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type MustBeTrue<T extends true> = T;
export type RedactionShapeChecks = [
  MustBeTrue<Equal<z.infer<typeof redactionSourceSchema>, RedactionSource>>,
  MustBeTrue<Equal<z.infer<typeof redactionInputSchema>, RedactionInput>>,
  MustBeTrue<Equal<z.infer<typeof redactedItemSchema>, RedactedItem>>,
  MustBeTrue<Equal<z.infer<typeof redactionOmissionSchema>, RedactionOmission>>,
  MustBeTrue<Equal<z.infer<typeof redactionContentSchema>, RedactionContent>>,
  MustBeTrue<Equal<z.infer<typeof redactionResultSchema>, RedactionResult>>,
  MustBeTrue<
    Equal<
      z.infer<typeof redactionFieldDeclarationSchema>,
      RedactionFieldDeclaration
    >
  >,
];

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
