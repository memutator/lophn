import { z } from "zod";
import { ipcPathLimit } from "../../base/mod.ts";
import {
  appIdSchema,
  type ChannelMode,
  processNonceSchema,
  releaseIdSchema,
  runtimeModeSchema,
  SOCKET_HOST,
  sha256Schema,
} from "./channel-values.ts";

export { SOCKET_HOST };

// 앱 자식은 부모와 같은 OS에서 뜨므로 이 process의 platform이 socket 경로의 한도다. 화면(renderer)에는
// process가 없고 거기서는 검사가 돌지 않는다.
const SOCKET_PATH_LIMIT = ipcPathLimit(globalThis.process?.platform ?? "linux");
const endpointSchema = z
  .string()
  .min(1)
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= SOCKET_PATH_LIMIT,
    { message: `socket path must be at most ${SOCKET_PATH_LIMIT} UTF-8 bytes` },
  );

// stdin JSON 한 줄. token과 secret은 여기에도 argv·환경에도 없다.
const startFields = {
  app: appIdSchema,
  release: releaseIdSchema.nullable(),
  bundle_hash: sha256Schema,
  mode: runtimeModeSchema,
  process_nonce: processNonceSchema,
  broker_socket: endpointSchema,
  direct_socket: endpointSchema,
  data_path: z.string().min(1),
  // 해당 자식의 broker credential. secret 값이 아니다.
  broker_credential: z.string().min(1),
};

function startShape(value: {
  mode: ChannelMode;
  release: string | null;
}): boolean {
  return value.mode !== "live" || value.release !== null;
}

export const appStartInputSchema = z
  .strictObject(startFields)
  .refine(startShape, { message: "live start needs a release" });

// 한 줄 JSON. 줄바꿈이 들어간 값은 시작 입력이 아니다.
