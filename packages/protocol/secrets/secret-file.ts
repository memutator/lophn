import { z } from "zod";
import type { Result } from "../../base/mod.ts";
import { defineMemory, defineUpload } from "../base/route.ts";
import {
  SECRET_INPUT_MAX_BYTES,
  secretAdapterContextSchema,
  secretDestinationSchema,
  secretNameSchema,
  type SecretSendOutput,
  type SecretValue,
} from "./secrets.ts";

// core가 `<data root>/secrets.json`(0600)을 직접 읽고 쓴다. 이름이 곧 key이고 값은 문자열이다.
export const SECRET_FILE_NAME = "secrets.json";

const secretFileStatusSchema = z.strictObject({
  name: secretNameSchema,
  configured: z.boolean(),
});
export type SecretFileStatus = z.infer<typeof secretFileStatusSchema>;

const errors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "unavailable",
] as const;

// 권한 밖 이름과 없는 이름은 구별되지 않는다.
export const secretStatus = defineMemory({
  resource: "secrets",
  method: "status",
  name: "SecretStatus",
  input: z.strictObject({ names: z.array(secretNameSchema).optional() }),
  output: z.strictObject({ secrets: z.array(secretFileStatusSchema) }),
  actors: ["user", "agent", "app", "machine"],
  errors,
});

// 사람 token을 가진 shell main이 secret 보호 입력 창의 제출을 받아서만 부른다.
// renderer의 core 호출 통로에는 upload kind가 없어 값이 renderer 일반 통로를 지나지 않는다.
export const secretPut = defineUpload({
  resource: "secrets",
  method: "put",
  name: "SecretPut",
  changes: [{ name: "secrets", id: (input) => input.name }],
  input: z.strictObject({
    name: secretNameSchema,
    bytes: z.number().int().min(1).max(SECRET_INPUT_MAX_BYTES),
  }),
  output: secretFileStatusSchema,
  actors: ["user"],
  errors,
  max_bytes: SECRET_INPUT_MAX_BYTES,
});

export const secretDelete = defineMemory({
  resource: "secrets",
  method: "delete",
  name: "SecretDelete",
  changes: [{ name: "secrets", id: (input) => input.name }],
  input: z.strictObject({ name: secretNameSchema }),
  output: secretFileStatusSchema,
  actors: ["user"],
  errors,
});

export const SECRET_FILE_ROUTES = [
  secretStatus,
  secretPut,
  secretDelete,
] as const;

// 전송 부착은 이름과 목적지만 싣는다. 용도는 core가 이름의 앞머리(`provider.`, `mcp.`, `mcp-oauth.`)로 정한다.
export const secretFileUseSchema = z.strictObject({
  name: secretNameSchema,
  destination: secretDestinationSchema,
});
export type SecretFileUse = z.infer<typeof secretFileUseSchema>;
const secretFileSendInputSchema = z.strictObject({
  context: secretAdapterContextSchema,
  use: secretFileUseSchema,
  operation: z.string().min(1),
  body: z.json(),
});
export type SecretFileSendInput = z.infer<typeof secretFileSendInputSchema>;

// core 안에서 부른다. 값은 transmit 인자로만 가고 결과에는 전송 여부뿐이다.
export interface SecretAttachPort {
  send(
    input: SecretFileSendInput,
    transmit: (value: SecretValue) => Promise<Result<SecretSendOutput>>,
  ): Promise<Result<SecretSendOutput>>;
}

// 파일 전체를 임시 파일에 쓰고 rename으로 바꾼다. 실패하면 이전 값이 그대로다. get·delete는 값을 스스로 관리하는
// core 안의 소유 concern(MCP OAuth token)이 쓴다. 없는 이름의 get은 not_found다.
export interface SecretStorePort {
  put(name: string, value: SecretValue): Promise<Result<SecretFileStatus>>;
  get(name: string): Result<string>;
  delete(name: string): Promise<Result<SecretFileStatus>>;
}
