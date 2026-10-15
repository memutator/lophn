import { z } from "zod";
import { atSchema, sha256Schema } from "../base/values.ts";
import { defineCommand, defineRead, defineWorker } from "../base/route.ts";
import { defineEvent } from "../events/events.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import { appIdSchema } from "../projects/values.ts";
import {
  appCompareSchema,
  appInputSchema,
  appSchema,
  releaseIdSchema,
} from "./apps.ts";

export const RUNTIME_STATES = [
  "preparing",
  "stopped",
  "running",
  "unavailable",
] as const;
export const runtimeStateValueSchema = z.enum(RUNTIME_STATES);

const runtimeReasonFields = {
  code: z.string().min(1),
  summary: z.string().min(1),
};
export const runtimeReasonInputSchema = z.strictObject(runtimeReasonFields);
export const runtimeReasonSchema = z.object(runtimeReasonFields);
export type RuntimeReason = z.infer<typeof runtimeReasonSchema>;

// 화면 상태 projection. ledger에 저장하지 않는다(domain-model apps/runtime).
export const runtimeStateSchema = z.object({
  state: runtimeStateValueSchema,
  termination_pending: z.boolean(),
  reason: runtimeReasonSchema.optional(),
}).refine(
  (value) => value.state !== "unavailable" || value.reason !== undefined,
  { message: "unavailable state needs a reason" },
);
export type RuntimeState = z.infer<typeof runtimeStateSchema>;

export const RUNTIME_MODES = ["live", "preview"] as const;

// 현재 supervisor 연결의 메모리 값. 관측이 없으면 null이다.
// live는 release가 필수이고, ready가 아니면 reason이 필수다.
export const runtimeObservationSchema = z.object({
  app: appIdSchema,
  release: releaseIdSchema.nullable(),
  mode: z.enum(RUNTIME_MODES),
  process_nonce: z.string().min(1),
  endpoint: z.string().min(1).nullable(),
  ready: z.boolean(),
  accepting: z.boolean(),
  reason: runtimeReasonSchema.optional(),
}).refine(
  (value) => value.mode !== "live" || value.release !== null,
  { message: "live observation needs a release" },
).refine(
  (value) => value.ready || value.reason !== undefined,
  { message: "observation that is not ready needs a reason" },
);
export type RuntimeObservation = z.infer<typeof runtimeObservationSchema>;

const readyAttestationFields = {
  release: releaseIdSchema.nullable(),
  bundle_hash: sha256Schema,
  commands: z.array(z.string().min(1)),
  data_schema: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  process_nonce: z.string().min(1),
  connection_ok: z.literal(true),
};
export const readyAttestationInputSchema = z.strictObject(
  readyAttestationFields,
);
export const readyAttestationSchema = z.object(readyAttestationFields);
export type ReadyAttestation = z.infer<typeof readyAttestationSchema>;

export const appEnableExecution = defineCommand({
  resource: "apps",
  method: "enable_execution",
  name: "app.enable_execution",
  input: appInputSchema,
  output: appSchema,
  compare: appCompareSchema,
  actors: ["user"],
  errors: ["conflict", "invalid_input", "not_found"],
});
export const appDisableExecution = defineCommand({
  resource: "apps",
  method: "disable_execution",
  name: "app.disable_execution",
  input: appInputSchema,
  output: appSchema,
  compare: appCompareSchema,
  actors: ["user"],
  errors: ["conflict", "not_found"],
});

// record_*는 관측 사실의 기록이다. 사람 편집의 CAS(base_revision)가 필요 없고,
// 같은 관측의 중복은 (app, release, 자식 nonce, 시작 시각, 관측 종류)로 가린다.
// 자식이 없는 관측(crash loop로 멈춘 상태)은 nonce·시작 시각이 없다.
const observationIdentity = {
  process_nonce: z.string().min(1).optional(),
  started_at: atSchema.optional(),
};

export const appRecordStartedInputSchema = z.strictObject({
  app: appIdSchema,
  ...observationIdentity,
  attestation: readyAttestationInputSchema.refine(
    (value) => value.release !== null,
    { message: "AppStarted needs a live release" },
  ),
  // 앱 시작이 DB를 바꿨을 때의 changeset(base64). 앱 시작 invocation에 붙는다.
  start_changeset: z.string().nullable().optional(),
}).refine(
  (value) =>
    value.process_nonce === value.attestation.process_nonce &&
    value.started_at !== undefined,
  { message: "started observation needs its child identity" },
);
export const appRecordStoppedInputSchema = z.strictObject({
  app: appIdSchema,
  release: releaseIdSchema,
  process_nonce: z.string().min(1),
  started_at: atSchema,
  termination_confirmed: z.literal(true),
});
export const appRecordUnavailableInputSchema = z.strictObject({
  app: appIdSchema,
  release: releaseIdSchema,
  ...observationIdentity,
  reason: runtimeReasonInputSchema,
});

export const appRecordStarted = defineCommand({
  resource: "apps",
  method: "record_started",
  name: "app.record_started",
  input: appRecordStartedInputSchema,
  output: z.object({ app: appIdSchema, state: runtimeStateSchema }),
  actors: ["machine"],
  errors: ["conflict", "invalid_input"],
});
export const appRecordStopped = defineCommand({
  resource: "apps",
  method: "record_stopped",
  name: "app.record_stopped",
  input: appRecordStoppedInputSchema,
  output: z.object({ app: appIdSchema, state: runtimeStateSchema }),
  actors: ["machine"],
  errors: ["conflict", "invalid_input"],
});
export const appRecordUnavailable = defineCommand({
  resource: "apps",
  method: "record_unavailable",
  name: "app.record_unavailable",
  input: appRecordUnavailableInputSchema,
  output: z.object({ app: appIdSchema, state: runtimeStateSchema }),
  actors: ["machine"],
  errors: ["conflict", "invalid_input"],
});

const readActors = ["user", "coding_agent", "agent", "app"] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// 현재 supervisor 관측. 관측이 없으면 observation은 null이다.
export const appRuntime = defineRead({
  resource: "apps",
  method: "runtime",
  name: "app.runtime",
  input: appInputSchema,
  output: withReadCommon(z.object({
    app: appIdSchema,
    state: runtimeStateSchema,
    observation: runtimeObservationSchema.nullable(),
    observed_at: atSchema.nullable(),
  })),
  // machine은 agent runtime이 사람 허락 뒤 재검사할 때 프로세스 nonce를 읽는다.
  // 그 순간 run은 waiting_user라 agent credential이 없다.
  actors: [...readActors, "machine"],
  errors: readErrors,
});

export const LOG_LINE_MAX_COUNT = 200;
export const LOG_LINE_MAX_LENGTH = 300;
export const logLineSchema = z.string().max(LOG_LINE_MAX_LENGTH);
export const APP_LOG_STATES = ["none", "off", "timeout", "ok"] as const;
export const appLogStateSchema = z.enum(APP_LOG_STATES);
export type AppLogState = z.infer<typeof appLogStateSchema>;
export const appLogsInputSchema = z.strictObject({
  app: appIdSchema,
  invocation: idSchema("inv").optional(),
  limit: z.number().int().min(1).max(LOG_LINE_MAX_COUNT).optional(),
  // 이어 읽기다. 앞선 응답의 next_cursor만 받는다(더 오래된 줄 쪽으로 이어진다).
  cursor: z.string().regex(/^[0-9]+$/).optional(),
  max_bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
    .optional(),
});
// none=source 없음, off=수집 꺼짐, timeout=예산 초과, ok=조회 성공이다.
// 부분 확보와 cap은 truncated로 구별하므로 ok도 완전 수집을 뜻하지 않는다.
export const appLogsOutputSchema = withReadCommon(z.object({
  state: appLogStateSchema,
  lines: z.array(logLineSchema).max(LOG_LINE_MAX_COUNT),
  collected_at: atSchema.nullable(),
  truncated: z.boolean(),
}));
// machine은 problems report collector만 부른다. 그 credential의 scope가 operation `app.logs`와
// 대상 app을 함께 이름 짓는 경우에만 열리고(그 밖은 없는 앱과 같은 응답), 판정은 read handler가 한다.
export const appLogs = defineRead({
  resource: "apps",
  method: "logs",
  name: "app.logs",
  input: appLogsInputSchema,
  output: appLogsOutputSchema,
  actors: [...readActors, "machine"],
  errors: readErrors,
});

// 선언·실행 가능 여부·실제 관측을 구분해 보여 준다.
export const automationViewSchema = z.object({
  key: z.string().min(1),
  declared: z.boolean(),
  runnable: z.boolean(),
  observed: z.boolean(),
  release: releaseIdSchema.nullable(),
  reason: runtimeReasonSchema.optional(),
});
export type AutomationView = z.infer<typeof automationViewSchema>;
export const appAutomations = defineRead({
  resource: "apps",
  method: "automations",
  name: "app.automations",
  input: appInputSchema,
  output: withReadCommon(z.object({
    app: appIdSchema,
    automations: z.array(automationViewSchema),
    observed_at: atSchema.nullable(),
  })),
  actors: readActors,
  errors: readErrors,
});

// 단독 data worker가 준비한다. 준비 중·완성·실패를 구별한다.
export const EXPORT_STATES = ["preparing", "ready", "failed"] as const;
export const appExport = defineWorker({
  resource: "apps",
  method: "export",
  name: "app.export",
  input: appInputSchema,
  output: z.object({
    app: appIdSchema,
    state: z.enum(EXPORT_STATES),
    reason: runtimeReasonSchema.optional(),
    includes_external_data: z.boolean(),
  }).refine(
    (value) => value.state !== "failed" || value.reason !== undefined,
    { message: "failed export needs a reason" },
  ),
  actors: ["user"],
  errors: ["invalid_input", "not_found", "unavailable"],
});

export const appExecutionEnabled = defineEvent("AppExecutionEnabled", {
  subject: appIdSchema,
  payload: z.object({ run_enabled: z.literal(true) }),
});
export const appExecutionDisabled = defineEvent("AppExecutionDisabled", {
  subject: appIdSchema,
  payload: z.object({ run_enabled: z.literal(false) }),
});
export const appStarted = defineEvent("AppStarted", {
  subject: appIdSchema,
  payload: z.object({
    release: releaseIdSchema,
    process_nonce: z.string().min(1),
    data_schema: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
});
export const appStopped = defineEvent("AppStopped", {
  subject: appIdSchema,
  payload: z.object({
    release: releaseIdSchema,
    process_nonce: z.string().min(1),
  }),
});
export const appUnavailable = defineEvent("AppUnavailable", {
  subject: appIdSchema,
  payload: z.object({
    release: releaseIdSchema,
    reason: runtimeReasonSchema,
  }),
});
