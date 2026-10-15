import { z } from "zod";
import { dataChangeSchema } from "../releases.ts";
import {
  activationAttemptIdSchema,
  activationDataResultSchema,
} from "./activation.ts";

// data worker job 입력. migration·backup·restore 프로세스와 problems test runner가
// 같은 진입점으로 읽는다. inspect는 종료를 확인한 앱 DB의 실제 schema와 무결성을 읽기만 한다.
export const ACTIVATION_DATA_JOB_KINDS = [
  "inspect",
  "backup",
  "migrate",
  "restore",
  "test",
] as const;
export const activationDataJobKindSchema = z.enum(ACTIVATION_DATA_JOB_KINDS);

const jobFields = {
  kind: activationDataJobKindSchema,
  app: z.string().regex(/^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/),
  release: z.string().regex(/^rel_[0-7][0-9a-hjkmnp-tv-z]{25}$/),
  attempt: activationAttemptIdSchema,
  data_path: z.string().min(1),
  // migration은 data_changes의 script_hash를 bundle에서 찾는다.
  bundle_path: z.string().min(1).optional(),
  // backup·restore는 보호 blob 참조다.
  backup_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  data_schema: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  // migrate만 쓴다. 각 단계의 script는 bundle 안 `migrations/<from>-<to>.sql`이고
  // 그 byte의 sha256이 script_hash와 같아야 한다.
  data_changes: z.array(dataChangeSchema).optional(),
  // migrate 결과에 실리는 원래 migration 관측이다.
  invocation: z.string().regex(/^inv_[0-7][0-9a-hjkmnp-tv-z]{25}$/).optional(),
};

// stdin JSON 한 줄. token과 secret은 argv·환경에 없다.
export const activationDataJobInputSchema = z.strictObject(jobFields);
export type ActivationDataJobInput = z.infer<
  typeof activationDataJobInputSchema
>;

// migration 결과에는 invocation이 필수고 성공 제출은 integrity_ok true다.
export const activationDataJobOutputSchema = z.strictObject({
  result: activationDataResultSchema,
  // backup 작업이 만든 DB 파일 byte의 sha256이다.
  backup_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).refine(
  (value) => value.result.integrity_ok,
  { message: "successful data job result must have integrity_ok true" },
);
export type ActivationDataJobOutput = z.infer<
  typeof activationDataJobOutputSchema
>;

function encodeLine(schema: z.ZodType, value: unknown, what: string): string {
  const line = JSON.stringify(schema.parse(value));
  if (line.includes("\n")) throw new Error(`${what} must be one line`);
  return `${line}\n`;
}

function decodeLine(line: string, what: string): unknown {
  const trimmed = line.endsWith("\n") ? line.slice(0, -1) : line;
  if (trimmed.includes("\n")) throw new Error(`${what} must be one line`);
  return JSON.parse(trimmed);
}

export function encodeActivationDataJobInput(
  input: ActivationDataJobInput,
): string {
  return encodeLine(activationDataJobInputSchema, input, "data job input");
}

export function decodeActivationDataJobInput(
  line: string,
): ActivationDataJobInput {
  return activationDataJobInputSchema.parse(
    decodeLine(line, "data job input"),
  );
}

export function encodeActivationDataJobOutput(
  output: ActivationDataJobOutput,
): string {
  return encodeLine(activationDataJobOutputSchema, output, "data job output");
}

export function decodeActivationDataJobOutput(
  line: string,
): ActivationDataJobOutput {
  return activationDataJobOutputSchema.parse(
    decodeLine(line, "data job output"),
  );
}
