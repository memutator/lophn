import { z } from "zod";
import {
  appIdSchema,
  CONFIRM_MARKER_LIMIT,
  endpointSchema,
  processNonceSchema,
  READY_TIMEOUT_MS,
  releaseIdSchema,
  runtimeModeSchema,
  sha256Schema,
  SHUTDOWN_GRACE_MS,
  SOCKET_HOST,
  SOCKET_PATH_MAX_BYTES,
} from "./channel-values.ts";

export {
  CONFIRM_MARKER_LIMIT,
  READY_TIMEOUT_MS,
  SHUTDOWN_GRACE_MS,
  SOCKET_HOST,
  SOCKET_PATH_MAX_BYTES,
};

// stdin JSON 한 줄. token과 secret은 여기에도 argv·환경에도 없다(apps/runtime#R7).
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
  mode: "live" | "preview";
  release: string | null;
}): boolean {
  return value.mode !== "live" || value.release !== null;
}

export const appStartInputSchema = z.strictObject(startFields).refine(
  startShape,
  { message: "live start needs a release" },
);
export type AppStartInput = z.infer<typeof appStartInputSchema>;

// 한 줄 JSON. 줄바꿈이 들어간 값은 시작 입력이 아니다.
export function encodeAppStartInput(input: AppStartInput): string {
  const parsed = appStartInputSchema.parse(input);
  const line = JSON.stringify(parsed);
  if (line.includes("\n")) {
    throw new Error("app start input must be one line");
  }
  return `${line}\n`;
}

export function decodeAppStartInput(line: string): AppStartInput {
  const trimmed = line.endsWith("\n") ? line.slice(0, -1) : line;
  if (trimmed.includes("\n")) {
    throw new Error("app start input must be one line");
  }
  return appStartInputSchema.parse(JSON.parse(trimmed));
}
