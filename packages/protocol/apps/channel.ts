import { z } from "zod";
import { canonicalize } from "@lophn/base";

function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

import {
  actorSchema,
  APP_CALL_DEPTH_LIMIT,
  appApiKeySchema,
  appIdSchema,
  atSchema,
  type ChannelMode,
  grantIdSchema,
  invocationIdSchema,
  opaqueSchema,
  processNonceSchema,
  releaseIdSchema,
  runtimeModeSchema,
  screenKeySchema,
  screenSizeSchema,
  sha256Schema,
  toolCallIdSchema,
  turnIdSchema,
} from "./channel-values.ts";

// 다른 앱 호출의 인증된 출처. 본문 주장은 받지 않는다.
const appCallOriginSchema = z.strictObject({
  kind: z.literal("app"),
  app: appIdSchema,
  release: releaseIdSchema,
  process_nonce: processNonceSchema,
  grant: grantIdSchema,
  parent_invocation: invocationIdSchema.nullable(),
  path: z.array(appIdSchema).max(APP_CALL_DEPTH_LIMIT - 1),
}).refine((value) => unique(value.path), { message: "duplicate app in path" })
  .refine(
    (value) => value.path.length === 0 || value.path.at(-1) === value.app,
    { message: "path ends at the calling app" },
  );

// 인증된 agent runtime 연결에서만 만든다.
const agentCallOriginSchema = z.strictObject({
  kind: z.literal("agent"),
  turn: turnIdSchema,
  tool_call: toolCallIdSchema,
});

const callOriginSchema = z.discriminatedUnion("kind", [
  appCallOriginSchema,
  agentCallOriginSchema,
]);

// AppCallOrigin에서 감사 caller로 남기는 것만. path·nonce·credential은 복제하지 않는다.
const invocationCallerBranches = [
  z.strictObject({ kind: z.literal("direct") }),
  z.strictObject({
    kind: z.literal("app"),
    app: appIdSchema,
    release: releaseIdSchema,
    parent_invocation: invocationIdSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("agent"),
    turn: turnIdSchema,
    tool_call: toolCallIdSchema,
  }),
  z.strictObject({ kind: z.literal("system") }),
] as const;
export const invocationCallerSchema = z.discriminatedUnion(
  "kind",
  invocationCallerBranches,
);

// 서명된 일시 값. 서명·TTL은 core가 정한다.
const confirmProofFields = {
  invocation: invocationIdSchema,
  process_nonce: processNonceSchema,
  release: releaseIdSchema,
  command: appApiKeySchema,
  input_hash: sha256Schema,
  caller: invocationCallerSchema,
  expires_at: atSchema,
};
export const confirmExecutionProofSchema = z.object(confirmProofFields);

const screenSizesSchema = z.record(
  screenKeySchema,
  z.array(screenSizeSchema).min(1).refine(unique, {
    message: "duplicate screen size",
  }),
);

const connectionFields = {
  app: appIdSchema,
  release: releaseIdSchema.nullable(),
  bundle_hash: sha256Schema,
  mode: runtimeModeSchema,
  process_nonce: processNonceSchema,
  actor: actorSchema,
  credential_ref: opaqueSchema,
  screens: z.array(screenKeySchema).refine(unique, {
    message: "duplicate screen",
  }),
  screen_sizes: screenSizesSchema,
  caller: callOriginSchema.nullable(),
  app_api: z.array(appApiKeySchema).refine(unique, {
    message: "duplicate app-api",
  }),
  expires_at: atSchema.nullable(),
};

function connectionShape(value: {
  mode: ChannelMode;
  release: string | null;
  screens: readonly string[];
  screen_sizes: Record<string, readonly string[]>;
}): boolean {
  if (value.mode === "live" && value.release === null) return false;
  // screen_sizes는 요청한 screen의 부분집합이다. 선언 대조는 supervisor가 한다.
  return Object.keys(value.screen_sizes).every((screen) =>
    value.screens.includes(screen)
  );
}

// core가 서명하는 제한 credential. live는 release가 필수다.
const appConnectionSchema = z.object(connectionFields).refine(
  connectionShape,
  { message: "connection does not match its mode, screens, or caller" },
);
export type AppConnection = z.infer<typeof appConnectionSchema>;

// core read 경로 밖 제어 요청. endpoint·nonce는 ledger에 저장하지 않는다.

// Authorization과 confirm proof가 싣는 서명 envelope의 서명. 서명 대상은 payload의 RFC 8785
// canonical JSON UTF-8이고 signature는 raw 64byte Ed25519의 base64url이다.
const signatureSchema = z.string().regex(/^[A-Za-z0-9_-]{86}$/);

// core가 서명한 connection이다. 앱 direct 요청의 Authorization은 `{payload: connection, signature}`다.

// Authorization과 confirm proof가 싣는 서명 envelope.
export const signedConnectionSchema = z.strictObject({
  payload: appConnectionSchema,
  signature: signatureSchema,
});
export type SignedConnection = z.infer<typeof signedConnectionSchema>;

export const signedConfirmProofSchema = z.strictObject({
  payload: confirmExecutionProofSchema,
  signature: signatureSchema,
});

export function connectionSigningBytes(connection: AppConnection): string {
  return canonicalize(connection);
}

// core read 경로 밖 제어 어댑터. ledger queue를 거치지 않는다.

// shell main이 폐기하거나 다른 앱으로 교체한 화면 view를 그 앱의 지금 live 프로세스에 알린다.
// shell은 앱 machine 연결이 없으므로 core 제어 어댑터가 `control/view-closed`로 중계한다. 그 뒤
// 앱 runtime은 그 view_session의 context 조회·주석 쓰기를 받지 않는다.
// ledger를 거치지 않는다. relayed는 지금 받을 live 프로세스가 있었는지다.

// path는 최초 caller부터 현재 caller까지다. 다음 대상을 더한 앱 수가 8을 넘거나
// 현재 path에 이미 있으면 handler 전에 거절한다.
