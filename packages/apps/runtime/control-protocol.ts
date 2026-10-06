// core ↔ supervisor 제어 protocol의 op와 입출력(apps 안쪽). platform 감독 pipe의
// worker_request·worker_response envelope 위에서 오가므로 envelope는 platform이 정하고,
// 여기는 op 이름과 payload 모양만 정한다. core는 앱 코드를 import하지 않고 supervisor와
// 이 모양으로만 말한다.
import { z } from "zod";
import { LIMIT_KEYS } from "../permissions/mod.ts";

export const SUPERVISOR_OPS = {
  // 원하는 앱 상태를 알린다. 접수만 답하고 시작은 비동기다(관측으로 따라간다).
  reconcile: "apps.reconcile",
  // 앱 하나의 현재 프로세스 관측.
  observe: "apps.observe",
  // 앱의 최근 log 조각.
  logs: "apps.logs",
  // 그 nonce의 프로세스를 새 nonce로 다시 띄운다.
  restart: "apps.restart",
  // 그 앱의 broker 연결을 새 요청부터 막는다. 이미 한 전송은 취소하지 않는다(apps/permissions#R20).
  block: "apps.block",
  // preview 프로세스(운영 자식과 따로 한 앱에 많아야 하나)의 시작·관측·종료. 운영 상태와
  // 활성 참조를 건드리지 않는다(apps/preview).
  previewStart: "apps.preview_start",
  previewObserve: "apps.preview_observe",
  previewStop: "apps.preview_stop",
} as const;

export type SupervisorOp = (typeof SUPERVISOR_OPS)[keyof typeof SUPERVISOR_OPS];

const appId = z.string().regex(/^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
const releaseId = z.string().regex(/^rel_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const screenSize = z.enum(["full", "panel", "card"]);

const flagsSchema = z.strictObject({
  args: z.array(z.string()),
  limits: z.array(z.enum(LIMIT_KEYS)),
});

export const desiredAppSchema = z.strictObject({
  app: z.string().min(1),
  release: z.string().min(1),
  bundleHash: sha256,
  runEnabled: z.boolean(),
  archived: z.boolean(),
  commands: z.array(z.string().min(1)),
  screens: z.record(z.string().min(1), z.array(screenSize).min(1)).optional(),
  dataSchema: z.number().int().nonnegative(),
  flags: flagsSchema,
  entry: z.string().min(1),
  importMap: z.string().min(1),
  dataPath: z.string().min(1),
});
export const reconcileInputSchema = desiredAppSchema;
export const reconcileOutputSchema = z.strictObject({
  accepted: z.literal(true),
});

export const observeInputSchema = z.strictObject({ app: appId });
const reasonSchema = z.strictObject({
  code: z.string().min(1),
  summary: z.string().min(1),
});
// supervisor가 지금 쥔 프로세스 하나. 자식이 없으면(멈춤·crash loop) nonce·endpoint가 빈 값이다.
export const observationWireSchema = z.strictObject({
  app: appId,
  release: releaseId.nullable(),
  mode: z.enum(["live", "preview"]),
  bundle_hash: sha256.nullable(),
  process_nonce: z.string(),
  endpoint: z.string(),
  commands: z.array(z.string()),
  screens: z.record(z.string(), z.array(screenSize)),
  ready: z.boolean(),
  accepting: z.boolean(),
  reason: reasonSchema.optional(),
  record_failed: z.string().optional(),
});
export type ObservationWire = z.infer<typeof observationWireSchema>;
export const observeOutputSchema = z.strictObject({
  observation: observationWireSchema.nullable(),
});

export const logsInputSchema = z.strictObject({
  app: appId,
  invocation: z.string().optional(),
  limit: z.number().int().min(1).max(200),
  max_bytes: z.number().int().positive().optional(),
  cursor: z.string().regex(/^[0-9]+$/).optional(),
});
export const logsOutputSchema = z.strictObject({
  state: z.enum(["none", "off", "timeout", "ok"]),
  lines: z.array(z.string().max(300)).max(200),
  collected_at: z.string().nullable(),
  truncated: z.boolean(),
  next_cursor: z.string().nullable().optional(),
});
export type LogsWire = z.infer<typeof logsOutputSchema>;

export const restartInputSchema = z.strictObject({
  app: appId,
  process_nonce: z.string().min(1),
});
export const restartOutputSchema = z.strictObject({ restarted: z.boolean() });

export const blockInputSchema = z.strictObject({ app: appId });
export const blockOutputSchema = z.strictObject({
  blocked: z.number().int().min(0),
});

// preview 프로세스 하나의 시작 입력이다. core가 nonce와 disposable 영역(dataPath)을 먼저 만들고
// 운영 DesiredApp과 같은 모양으로 알린다. release는 준비 전 bundle이면 null이다.
export const previewNonceSchema = z.string().regex(/^[0-9A-Za-z-]{8,64}$/);
export const previewLaunchSchema = z.strictObject({
  app: appId,
  nonce: previewNonceSchema,
  release: releaseId.nullable(),
  bundleHash: sha256,
  commands: z.array(z.string().min(1)),
  screens: z.record(z.string().min(1), z.array(screenSize).min(1)).optional(),
  dataSchema: z.number().int().nonnegative(),
  flags: flagsSchema,
  entry: z.string().min(1),
  importMap: z.string().min(1),
  dataPath: z.string().min(1),
});
export type PreviewLaunch = z.infer<typeof previewLaunchSchema>;
export const previewStartOutputSchema = z.strictObject({
  accepted: z.literal(true),
});
export const previewObserveInputSchema = z.strictObject({
  app: appId,
  process_nonce: previewNonceSchema,
});
export const previewStopInputSchema = previewObserveInputSchema;
export const previewStopOutputSchema = z.strictObject({
  stopped: z.boolean(),
});
