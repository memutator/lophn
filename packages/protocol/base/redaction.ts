import { z } from "zod";
import {
  OMISSION_REASONS,
  REDACTION_STATUSES,
} from "../../base/redaction/mod.ts";
import { sha256Schema } from "./values.ts";

// 한도·모양의 정의는 base/redaction에 있다. 아래 schema는 그 모양을 검사한다.

const redactionStatusSchema = z.enum(REDACTION_STATUSES);

const omissionReasonSchema = z.enum(OMISSION_REASONS);

// 원문 메모리 참조. 바이트 자체는 pipe payload에 넣지 않는다.

// 검출한 값·길이·원문 일부를 담지 않는다.
const redactedItemSchema = z.object({
  location: z.string().min(1),
});

const redactionOmissionSchema = z.object({
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

const redactionContentSchema = z.discriminatedUnion("kind", [
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

// 안전 필드·private 필드·표본 원값 경로. 표본 경로는 명시 경로만이다.

// schema가 base의 모양과 어긋나면 type 검사에서 걸린다.

// domain-model/platform/security.md TrustClass. 자료 문자열로 승격하지 않는다.
const TRUST_CLASSES = [
  "platform_rule",
  "user_request",
  "platform_fact",
  "data",
] as const;
const trustClassSchema = z.enum(TRUST_CLASSES);
type TrustClass = z.infer<typeof trustClassSchema>;

// 출처 불명은 data다. 구현은 platform이 entry로 받는다.
export type DataEnvelope = {
  trust: TrustClass;
  text: string;
  source?: string;
  revision?: string;
};

export type DataSerializer = (value: DataEnvelope) => string;

