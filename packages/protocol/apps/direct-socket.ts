import { z } from "zod";
import { jsonValueSchema } from "../base/json-values.ts";
import { revisionSchema } from "../projects/values.ts";
import {
  confirmExecutionProofInputSchema,
  signedConfirmProofSchema,
} from "./channel.ts";
import {
  commandKeySchema,
  DIRECT_SOCKET_PATHS,
  invocationIdSchema,
  opaqueSchema,
  releaseIdSchema,
  runtimeModeSchema,
} from "./channel-values.ts";

export { DIRECT_SOCKET_PATHS };

// 읽기 결과의 원천 상태. 정상 0행과 미수집·부분 범위·신선도 부족을 구분한다.
// 값을 만드는 일은 앱 handler의 몫이다.
const READ_COVERAGE = ["complete", "partial", "uncollected"] as const;
const READ_FRESHNESS = ["fresh", "stale", "unknown"] as const;

const readSourceFields = {
  coverage: z.enum(READ_COVERAGE),
  freshness: z.enum(READ_FRESHNESS),
  // 이어 읽기 기준. 처음 조건·정렬·데이터 기준이 바뀌면 재사용을 거절한다.
  continuation: opaqueSchema.nullable(),
};
const readSourceStateSchema = z.object(readSourceFields);

// command.revert가 지원하는 write의 성공 결과(domain-model apps/blueprint).
const revertFields = {
  invocation: invocationIdSchema,
  receipt: opaqueSchema,
  expected_revision: revisionSchema,
};
const commandRevertResultSchema = z.object(revertFields);

const commandResultSchema = z.object({
  result: jsonValueSchema,
  revert: commandRevertResultSchema.optional(),
  source: readSourceStateSchema.optional(),
});

// 호출에 붙이는 confirm proof는 core가 서명한 envelope다.
// 서명 없는 payload는 받지 않는다.
const signedConfirmProofInputSchema = z.strictObject({
  payload: confirmExecutionProofInputSchema,
  signature: signedConfirmProofSchema.shape.signature,
});

const invokeFields = {
  request_key: opaqueSchema,
  release: releaseIdSchema.optional(),
  command: commandKeySchema,
  input: jsonValueSchema.optional(),
  proof: signedConfirmProofInputSchema.optional(),
};
const commandInvokeInputSchema = z.strictObject(invokeFields);
export type CommandInvokeInput = z.infer<typeof commandInvokeInputSchema>;

export const commandInvokeOutputSchema = z.object({
  result: commandResultSchema,
  invocation: invocationIdSchema.optional(),
  mode: runtimeModeSchema,
});
export type CommandInvokeOutput = z.infer<typeof commandInvokeOutputSchema>;

export const commandCancelOutputSchema = z.object({ accepted: z.boolean() });
export type CommandCancelOutput = z.infer<typeof commandCancelOutputSchema>;

const COMMAND_PROGRESS = [
  "running",
  "succeeded",
  "failed",
  "unknown",
] as const;
export const commandStatusOutputSchema = z.object({
  progress: z.enum(COMMAND_PROGRESS),
  result: commandResultSchema.optional(),
});
export type CommandStatusOutput = z.infer<typeof commandStatusOutputSchema>;

// bundle 내부 path. traversal·scheme·authority는 거절한다.

// release 없는 preview(준비 전 bundle)는 null이다. live 자식은 null이면 release 불일치로 거절한다.
// 화면 view가 닫히거나 교체됐다는 사실. 앱 프로세스가 그 view_session을 버리고 다시 열지 않는다.
