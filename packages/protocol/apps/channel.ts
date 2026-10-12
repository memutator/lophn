import { z } from "zod";
import { canonicalize } from "@lophn/base";

function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

import { defineMemory } from "../base/route.ts";
import {
  actorSchema,
  APP_CALL_DEPTH_LIMIT,
  appIdSchema,
  atSchema,
  type ChannelMode,
  commandKeySchema,
  endpointSchema,
  grantIdSchema,
  invocationIdSchema,
  opaqueSchema,
  processNonceSchema,
  releaseIdSchema,
  runIdSchema,
  runtimeModeSchema,
  screenKeySchema,
  screenSizeSchema,
  sha256Schema,
  toolCallIdSchema,
} from "./channel-values.ts";

// 다른 앱 호출의 인증된 출처. 본문 주장은 받지 않는다(domain-model apps/connections).
export const appCallOriginSchema = z.strictObject({
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
export type AppCallOrigin = z.infer<typeof appCallOriginSchema>;

// 인증된 agent runtime 연결에서만 만든다(domain-model apps/invocations).
export const agentCallOriginSchema = z.strictObject({
  kind: z.literal("agent"),
  run: runIdSchema,
  tool_call: toolCallIdSchema,
});
export type AgentCallOrigin = z.infer<typeof agentCallOriginSchema>;

export const callOriginSchema = z.discriminatedUnion("kind", [
  appCallOriginSchema,
  agentCallOriginSchema,
]);
export type CallOrigin = z.infer<typeof callOriginSchema>;

// AppCallOrigin에서 감사 caller로 남기는 것만. path·nonce·credential은 복제하지 않는다.
const invocationCallerBranches = [
  z.strictObject({ kind: z.literal("direct") }),
  z.strictObject({ kind: z.literal("automation"), key: commandKeySchema }),
  z.strictObject({
    kind: z.literal("app"),
    app: appIdSchema,
    release: releaseIdSchema,
    parent_invocation: invocationIdSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("agent"),
    run: runIdSchema,
    tool_call: toolCallIdSchema,
  }),
  z.strictObject({ kind: z.literal("system") }),
] as const;
export const invocationCallerSchema = z.discriminatedUnion(
  "kind",
  invocationCallerBranches,
);
export type InvocationCaller = z.infer<typeof invocationCallerSchema>;

// 서명된 일시 값. 서명·TTL은 platform/identity가 정한다.
const confirmProofFields = {
  invocation: invocationIdSchema,
  process_nonce: processNonceSchema,
  release: releaseIdSchema,
  command: commandKeySchema,
  input_hash: sha256Schema,
  caller: invocationCallerSchema,
  expires_at: atSchema,
};
export const confirmExecutionProofInputSchema = z.strictObject(
  confirmProofFields,
);
export const confirmExecutionProofSchema = z.object(confirmProofFields);
export type ConfirmExecutionProof = z.infer<typeof confirmExecutionProofSchema>;

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
  commands: z.array(commandKeySchema).refine(unique, {
    message: "duplicate command",
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

// core가 서명하는 제한 credential. live는 release가 필수다(domain-model apps/runtime).
export const appConnectionInputSchema = z.strictObject(connectionFields).refine(
  connectionShape,
  { message: "connection does not match its mode, screens, or caller" },
);
export const appConnectionSchema = z.object(connectionFields).refine(
  connectionShape,
  { message: "connection does not match its mode, screens, or caller" },
);
export type AppConnection = z.infer<typeof appConnectionSchema>;

export const appScreenRequestSchema = z.strictObject({
  screen: screenKeySchema,
  size: screenSizeSchema,
  view_session: opaqueSchema,
});
export type AppScreenRequest = z.infer<typeof appScreenRequestSchema>;

// core read 경로 밖 제어 요청. endpoint·nonce는 ledger에 저장하지 않는다.
const connectFields = {
  app: appIdSchema,
  mode: runtimeModeSchema,
  screens: z.array(screenKeySchema).min(1).refine(unique, {
    message: "duplicate screen",
  }),
  screen_sizes: screenSizesSchema,
  commands: z.array(commandKeySchema).refine(unique, {
    message: "duplicate command",
  }),
  caller: callOriginSchema.optional(),
  preview_nonce: processNonceSchema.optional(),
};

function connectShape(value: {
  mode: ChannelMode;
  screens: readonly string[];
  screen_sizes: Record<string, readonly string[]>;
  preview_nonce?: string;
}): boolean {
  if (value.mode === "test") return false;
  return Object.keys(value.screen_sizes).every((screen) =>
    value.screens.includes(screen)
  ) && (value.mode === "preview") === (value.preview_nonce !== undefined);
}

export const appConnectInputSchema = z.strictObject(connectFields).refine(
  connectShape,
  { message: "connect request does not match its mode or caller" },
);
export type AppConnectInput = z.infer<typeof appConnectInputSchema>;

// Authorization과 confirm proof가 싣는 서명 envelope의 서명. 서명 대상은 payload의 RFC 8785
// canonical JSON UTF-8이고 signature는 raw 64byte Ed25519의 base64url이다(apps Q5).
const signatureSchema = z.string().regex(/^[A-Za-z0-9_-]{86}$/);

// core가 서명한 connection이다. 앱 direct 요청의 Authorization은 `{payload: connection, signature}`다.
export const appConnectOutputSchema = z.object({
  endpoint: endpointSchema,
  connection: appConnectionSchema,
  signature: signatureSchema,
});
export type AppConnectOutput = z.infer<typeof appConnectOutputSchema>;

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
export type SignedConfirmProof = z.infer<typeof signedConfirmProofSchema>;

export function connectionSigningBytes(connection: AppConnection): string {
  return canonicalize(connection);
}

export function confirmProofSigningBytes(proof: ConfirmExecutionProof): string {
  return canonicalize(proof);
}

// core read 경로 밖 제어 어댑터. ledger queue를 거치지 않는다(architecture/apps 5.1).
export const appConnect = defineMemory({
  resource: "apps",
  method: "connect",
  name: "app.connect",
  input: appConnectInputSchema,
  output: appConnectOutputSchema,
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: [
    "unauthorized",
    "forbidden",
    "invalid_input",
    "conflict",
    "unavailable",
    "not_found",
  ],
});

// shell main이 폐기하거나 다른 앱으로 교체한 화면 view를 그 앱의 지금 live 프로세스에 알린다.
// shell은 앱 machine 연결이 없으므로 core 제어 어댑터가 `control/view-closed`로 중계한다. 그 뒤
// 앱 runtime은 그 view_session의 context 조회·주석 쓰기를 받지 않는다(apps/agent-context#R2, R5).
// ledger를 거치지 않는다. relayed는 지금 받을 live 프로세스가 있었는지다.
export const appViewClosedInputSchema = z.strictObject({
  app: appIdSchema,
  view_session: opaqueSchema,
});
export type AppViewClosedInput = z.infer<typeof appViewClosedInputSchema>;
export const appViewClosedOutputSchema = z.object({ relayed: z.boolean() });

export const appViewClosed = defineMemory({
  resource: "apps",
  method: "view_closed",
  name: "app.view_closed",
  input: appViewClosedInputSchema,
  output: appViewClosedOutputSchema,
  actors: ["user"],
  errors: ["unauthorized", "invalid_input", "not_found", "unavailable"],
});

// path는 최초 caller부터 현재 caller까지다. 다음 대상을 더한 앱 수가 8을 넘거나
// 현재 path에 이미 있으면 handler 전에 거절한다(apps/connections#R7).
export function appCallDepthAllowed(
  path: readonly string[],
  target: string,
): boolean {
  return path.length < APP_CALL_DEPTH_LIMIT && !path.includes(target);
}
