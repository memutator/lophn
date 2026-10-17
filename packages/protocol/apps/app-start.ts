import { z } from "zod";
import {
  appIdSchema,
  type ChannelMode,
  endpointSchema,
  processNonceSchema,
  releaseIdSchema,
  runtimeModeSchema,
  sha256Schema,
  SOCKET_HOST,
  SOCKET_PATH_MAX_BYTES,
} from "./channel-values.ts";

export { SOCKET_HOST, SOCKET_PATH_MAX_BYTES };

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

export const appStartInputSchema = z.strictObject(startFields).refine(
  startShape,
  { message: "live start needs a release" },
);

// 한 줄 JSON. 줄바꿈이 들어간 값은 시작 입력이 아니다.
