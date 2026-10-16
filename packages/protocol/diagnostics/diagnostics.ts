import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { ACTOR_KINDS, defineMemory, defineRead } from "../base/route.ts";
import { redactionResultSchema } from "../base/redaction.ts";
import { atSchema } from "../base/values.ts";

// domain-model platform/diagnostics. 등록 component·code 목록은 아직 정하지 않았다.
const DIAGNOSTIC_RECORD_KINDS = ["log", "crash", "health"] as const;

const diagnosticRecordKindSchema = z.enum(DIAGNOSTIC_RECORD_KINDS);

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

export const DIAGNOSTIC_ROUTES = [diagnosticsList] as const;

// core가 점검하는 구성 요소만이다. 터미널은 shell main이 안다.
export const DIAGNOSTIC_COMPONENTS = [
  "core",
  "ledger",
  "events",
  "app-runtime",
  "sandbox",
  "agent-runtime",
] as const;

const componentStatusSchema = z.strictObject({
  component: z.enum(DIAGNOSTIC_COMPONENTS),
  available: z.boolean(),
  // 경로·key·값을 담지 않는다.
  reason: z.string().min(1).optional(),
  checked_at: atSchema,
}).refine((value) => value.available || value.reason !== undefined, {
  message: "unavailable component needs a safe reason",
});
export type ComponentStatus = z.infer<typeof componentStatusSchema>;

// 호출할 때마다 지금 점검한다.
export const diagnosticsStatus = defineMemory({
  resource: "diagnostics",
  method: "status",
  name: "DiagnosticsStatus",
  input: z.strictObject({}),
  output: z.strictObject({
    checked_at: atSchema,
    components: z.array(componentStatusSchema),
  }),
  actors: ACTOR_KINDS,
  errors: readErrors,
});

export const DIAGNOSTIC_STATUS_ROUTES = [diagnosticsStatus] as const;
