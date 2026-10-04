import { z } from "zod";
import { jsonValueSchema } from "../platform/mod.ts";
import { revisionSchema } from "../documents/values.ts";
import { readyAttestationSchema } from "./runtime.ts";
import {
  appConnectionSchema,
  appScreenRequestSchema,
  confirmExecutionProofInputSchema,
  invocationCallerSchema,
} from "./channel.ts";
import {
  commandKeySchema,
  DIRECT_SOCKET_PATHS,
  invocationIdSchema,
  opaqueSchema,
  processNonceSchema,
  releaseIdSchema,
  runtimeModeSchema,
  SHUTDOWN_GRACE_MS,
} from "./channel-values.ts";

export { DIRECT_SOCKET_PATHS };

// 읽기 결과의 원천 상태. 정상 0행과 미수집·부분 범위·신선도 부족을 구분한다
// (apps/invocations#R14). 값을 만드는 일은 앱 handler의 몫이다.
export const READ_COVERAGE = ["complete", "partial", "uncollected"] as const;
export const READ_FRESHNESS = ["fresh", "stale", "unknown"] as const;

const readSourceFields = {
  coverage: z.enum(READ_COVERAGE),
  freshness: z.enum(READ_FRESHNESS),
  // 이어 읽기 기준. 처음 조건·정렬·데이터 기준이 바뀌면 재사용을 거절한다.
  continuation: opaqueSchema.nullable(),
};
export const readSourceStateSchema = z.object(readSourceFields);
export type ReadSourceState = z.infer<typeof readSourceStateSchema>;

// command.revert가 지원하는 write의 성공 결과(domain-model apps/blueprint).
const revertFields = {
  invocation: invocationIdSchema,
  receipt: opaqueSchema,
  expected_revision: revisionSchema,
};
export const commandRevertResultSchema = z.object(revertFields);
export type CommandRevertResult = z.infer<typeof commandRevertResultSchema>;

export const commandResultSchema = z.object({
  result: jsonValueSchema,
  revert: commandRevertResultSchema.optional(),
  source: readSourceStateSchema.optional(),
});
export type CommandResult = z.infer<typeof commandResultSchema>;

const invokeFields = {
  request_key: opaqueSchema,
  release: releaseIdSchema.optional(),
  command: commandKeySchema,
  input: jsonValueSchema.optional(),
  proof: confirmExecutionProofInputSchema.optional(),
};
export const commandInvokeInputSchema = z.strictObject(invokeFields);
export type CommandInvokeInput = z.infer<typeof commandInvokeInputSchema>;

export const commandInvokeOutputSchema = z.object({
  result: commandResultSchema,
  invocation: invocationIdSchema.optional(),
  mode: runtimeModeSchema,
});
export type CommandInvokeOutput = z.infer<typeof commandInvokeOutputSchema>;

const commandReferenceFields = {
  request_key: opaqueSchema,
  invocation: invocationIdSchema,
};
export const commandCancelInputSchema = z.strictObject(commandReferenceFields);
export const commandCancelOutputSchema = z.object({ accepted: z.boolean() });
export type CommandCancelOutput = z.infer<typeof commandCancelOutputSchema>;

export const COMMAND_PROGRESS = [
  "running",
  "succeeded",
  "failed",
  "unknown",
] as const;
export const commandStatusInputSchema = z.strictObject(commandReferenceFields);
export const commandStatusOutputSchema = z.object({
  progress: z.enum(COMMAND_PROGRESS),
  result: commandResultSchema.optional(),
});
export type CommandStatusOutput = z.infer<typeof commandStatusOutputSchema>;

// bundle 내부 path. traversal·scheme·authority는 거절한다.
export const screenAssetPathSchema = z.string().min(1).refine(
  (value) =>
    !value.includes("\\") && !value.split("/").includes("..") &&
    !value.includes(":") && !value.startsWith("//"),
  { message: "screen asset path leaves the bundle" },
);
export const screenGetInputSchema = z.strictObject({
  screen: appScreenRequestSchema,
  path: screenAssetPathSchema,
});
export type ScreenGetInput = z.infer<typeof screenGetInputSchema>;

export const controlProbeInputSchema = z.strictObject({
  process_nonce: processNonceSchema,
});
export const controlProbeOutputSchema = readyAttestationSchema;
export const controlOpenInputSchema = z.strictObject({
  process_nonce: processNonceSchema,
  release: releaseIdSchema,
});
export const controlOpenOutputSchema = z.object({ accepting: z.literal(true) });
export const controlCloseInputSchema = z.strictObject({
  process_nonce: processNonceSchema,
  reason: z.string().min(1),
});
export const controlCloseOutputSchema = z.object({ closed: z.literal(true) });
export const controlShutdownInputSchema = z.strictObject({
  process_nonce: processNonceSchema,
  grace_ms: z.literal(SHUTDOWN_GRACE_MS),
});
export const controlShutdownOutputSchema = z.object({
  accepted: z.literal(true),
});

// direct 호출은 Authorization의 서명된 AppConnection으로 신원을 정한다.
export const directRequestSchema = z.strictObject({
  connection: appConnectionSchema,
  caller: invocationCallerSchema,
});
export type DirectRequest = z.infer<typeof directRequestSchema>;
