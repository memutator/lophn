import { z } from "zod";
import { ERROR_CODES } from "../../base/mod.ts";
import {
  confirmationHandleRegisteredSchema,
  confirmationHandleRegisterSchema,
} from "../base/confirmation-handle.ts";
import { diagnosticSchema, START_FAILURE_REASONS } from "./supervision.ts";

// core가 시작하지 못한 이유. detached 시작의 첫 줄과 ensure의 실패가 이 값을 쓴다.
export type StartFailureReason = (typeof START_FAILURE_REASONS)[number];

// core control socket의 계약. 한 연결에 JSON 한 줄 요청 하나와 Result 응답 하나다.
// 경계는 socket 자리(같은 사용자, POSIX 0700 폴더, win32 named pipe)이고 OS peer 신원 검증은 하지 않는다.
// 그래서 credential과 shell capability는 이 socket 밖으로 나가는 길이 따로 없다.
export const CORE_CONTROL_PROTOCOL_VERSION = "1";

const opaque = z.string().min(1);

// shell connect의 결과에만 실린다. 응답을 받은 shell main 메모리에만 있고 argv·env·file·renderer·log로 내지 않는다.
export const shellCapabilitySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const CORE_CONTROL_CLIENTS = ["cli", "shell"] as const;

const controlClientSchema = z.enum(CORE_CONTROL_CLIENTS);

// main이 지금 보내는 안전 진단 둘만 control로도 받는다. 진단 schema의 나머지 kind는 받지 않는다.
const CONTROL_DIAGNOSTIC_KINDS: Readonly<Record<string, true>> = {
  shell_view_lifetime: true,
  lophn_internal: true,
};
export const controlDiagnosticSchema = diagnosticSchema.refine(
  (diagnostic) => CONTROL_DIAGNOSTIC_KINDS[diagnostic.kind] === true,
);

export const controlIdentifyRequestSchema = z.strictObject({
  type: z.literal("identify"),
});

export const controlConnectRequestSchema = z.strictObject({
  type: z.literal("connect"),
  client: controlClientSchema,
});

export const controlStopRequestSchema = z.strictObject({
  type: z.literal("stop"),
});

// 등록 payload는 main↔core pipe의 것 그대로이고 capability만 더한다.
export const controlConfirmationRegisterRequestSchema = z.strictObject({
  ...confirmationHandleRegisterSchema.shape,
  shell_capability: shellCapabilitySchema,
});

// 창 하나를 닫는 요청. 그 창의 handle만 무효로 한다.
export const controlConfirmationCloseWindowRequestSchema = z.strictObject({
  type: z.literal("confirmation_handle_close_window"),
  shell_capability: shellCapabilitySchema,
  window_id: z.string().min(1),
});

export const controlRequestSchema = z.union([
  controlIdentifyRequestSchema,
  controlConnectRequestSchema,
  controlStopRequestSchema,
  controlDiagnosticSchema,
  controlConfirmationRegisterRequestSchema,
  controlConfirmationCloseWindowRequestSchema,
]);
export type ControlRequest = z.infer<typeof controlRequestSchema>;
export type ControlClient = z.infer<typeof controlClientSchema>;

export const controlStateSchema = z.enum(["starting", "ready", "stopping"]);
export type ControlState = z.infer<typeof controlStateSchema>;

export const controlIdentifySchema = z.strictObject({
  product_version: opaque,
  protocol_version: opaque,
  core_epoch: opaque,
  // starting·stopping에는 API가 아직 또는 이미 없다.
  api_url: z.string().min(1).nullable(),
  state: controlStateSchema,
});
export type ControlIdentify = z.infer<typeof controlIdentifySchema>;

export const controlConnectSchema = z.strictObject({
  user_token: opaque,
  api_url: z.string().min(1),
  core_epoch: opaque,
  // `client: shell`의 결과에만 있다. CLI는 이 칸을 받지 않는다.
  shell_capability: shellCapabilitySchema.optional(),
});
export type ControlConnect = z.infer<typeof controlConnectSchema>;

// 기존 등록 결과에서 type만 뺀다. handle 참조와 기한뿐이다.
export const controlConfirmationSchema =
  confirmationHandleRegisteredSchema.omit({ type: true });
export type ControlConfirmation = z.infer<typeof controlConfirmationSchema>;

export const controlErrorSchema = z.strictObject({
  code: z.enum(ERROR_CODES),
  message: z.string(),
});

// Result 하나. 값의 모양은 요청마다 다르므로 부르는 쪽이 자기 schema로 다시 본다.
export const controlResponseSchema = z.union([
  z.strictObject({ ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ ok: z.literal(false), error: controlErrorSchema }),
]);
