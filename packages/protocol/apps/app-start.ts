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

// protocol은 이식 가능해야 해서 platform을 읽지 않고 OS별 한도 중 가장 큰 값을 상한으로만 둔다. 정확한 한도는
// 경로를 만드는 core(`slotSockets`)와 받는 자식(`wire-check`)이 platform으로 검사한다.
const SOCKET_PATH_LIMIT = ipcPathLimit("win32");
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
