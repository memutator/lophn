import { z } from "zod";
import { defineMemory } from "../platform/route.ts";
import { agentAppScopeSchema } from "../lophn-agent/scope.ts";
import {
  actorSchema,
  APP_CALL_PATH_MAX,
  appIdSchema,
  atSchema,
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
  unique,
} from "./channel-values.ts";

// 다른 앱 호출의 인증된 출처. 본문 주장은 받지 않는다(domain-model apps/connections).
export const appCallOriginSchema = z.strictObject({
  kind: z.literal("app"),
  app: appIdSchema,
  release: releaseIdSchema,
  process_nonce: processNonceSchema,
  grant: grantIdSchema,
  parent_invocation: invocationIdSchema.nullable(),
  path: z.array(appIdSchema).max(APP_CALL_PATH_MAX),
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
  mode: "live" | "preview";
  release: string | null;
  screens: readonly string[];
  screen_sizes: Record<string, readonly string[]>;
  caller: { kind: string } | null;
}): boolean {
  if (value.mode === "live" && value.release === null) return false;
  const sizes = Object.keys(value.screen_sizes);
  return sizes.every((screen) => value.screens.includes(screen)) &&
    value.screens.every((screen) => sizes.includes(screen)) &&
    (value.mode === "preview" || value.caller === null ||
      value.caller.kind === "app" || value.caller.kind === "agent");
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
  // agent 연결은 역할·assignment 범위와 교집합으로 발급한다(T26 AgentAppScope).
  agent_scope: agentAppScopeSchema.optional(),
};

function connectShape(value: {
  mode: "live" | "preview";
  screens: readonly string[];
  screen_sizes: Record<string, readonly string[]>;
  caller?: { kind: string };
  preview_nonce?: string;
  agent_scope?: unknown;
}): boolean {
  const sizes = Object.keys(value.screen_sizes);
  return value.screens.every((screen) => sizes.includes(screen)) &&
    sizes.every((screen) => value.screens.includes(screen)) &&
    (value.mode === "preview") === (value.preview_nonce !== undefined) &&
    (value.caller?.kind === "agent") === (value.agent_scope !== undefined);
}

export const appConnectInputSchema = z.strictObject(connectFields).refine(
  connectShape,
  { message: "connect request does not match its mode or caller" },
);
export type AppConnectInput = z.infer<typeof appConnectInputSchema>;

export const appConnectOutputSchema = z.object({
  endpoint: endpointSchema,
  connection: appConnectionSchema,
});
export type AppConnectOutput = z.infer<typeof appConnectOutputSchema>;

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

// 다음 대상이 path에 이미 있거나 추가 뒤 8개 앱을 넘으면 handler 전에 거절한다.
export function appCallDepthAllowed(
  path: readonly string[],
  target: string,
): boolean {
  return path.length < APP_CALL_PATH_MAX && !path.includes(target);
}
