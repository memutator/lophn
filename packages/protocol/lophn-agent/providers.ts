import { z } from "zod";
import {
  defineCommand,
  defineMemory,
  defineRead,
  defineUpload,
} from "../base/route.ts";
import { SECRET_INPUT_MAX_BYTES } from "../secrets/secrets.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import {
  connectLocalProviderInputSchema,
  connectProviderInputSchema,
  disconnectProviderInputSchema,
  loginCancelInputSchema,
  providerConnectTargetSchema,
  providerListInputSchema,
  providerReadInputSchema,
  providerRevisionCompareSchema,
  recordProviderAvailabilityInputSchema,
  recordProviderModelsInputSchema,
  refreshProviderCredentialInputSchema,
  refreshProviderModelsInputSchema,
  providerSignInCallbackInputSchema,
  providerSignInStateSchema,
  providerSignInInputSchema,
  providerSignInOutputSchema,
} from "./provider-inputs.ts";
import {
  providerDefinitionOutputSchema,
  providerRecordSchema,
} from "./provider-values.ts";

const userErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "conflict",
  "unavailable",
] as const;
const machineErrors = [
  "invalid_input",
  "unauthorized",
  "conflict",
  "unavailable",
] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;
const readActors = ["user", "agent", "machine"] as const;

const providerOutput = z.object({ provider: providerRecordSchema });

// 새 Connect. credential은 secret 이름 참조다.
export const connectProvider = defineCommand({
  resource: "providers",
  method: "connect",
  name: "ConnectProvider",
  changes: ["providers", "models"],
  input: connectProviderInputSchema,
  output: providerOutput,
  actors: ["user"],
  errors: [...userErrors],
});

// Disconnect는 provider와 credential(secret)을 함께 지우므로 사람이 확인 창을 거쳐 결정한다.
export const disconnectProvider = defineCommand({
  resource: "providers",
  method: "disconnect",
  name: "DisconnectProvider",
  changes: [
    { name: "providers", id: (input) => input.provider },
    "models",
    "secrets",
  ],
  input: disconnectProviderInputSchema,
  output: z.object({ provider: idSchema("pvd") }),
  compare: providerRevisionCompareSchema,
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "conflict",
    "not_found",
    "unavailable",
  ],
  confirmation: "required",
  confirmation_kind: "secret_input",
  binding: ["provider"],
  display_read: "/providers/read",
});

export const refreshProviderCredential = defineCommand({
  resource: "provider-credentials",
  method: "refresh-result",
  name: "RefreshProviderCredential",
  changes: ["providers"],
  input: refreshProviderCredentialInputSchema,
  output: providerOutput,
  compare: providerRevisionCompareSchema,
  actors: ["machine"],
  errors: [...machineErrors, "not_found"],
});

export const recordProviderAvailability = defineCommand({
  resource: "provider-credentials",
  method: "record-availability",
  name: "RecordProviderAvailability",
  changes: ["providers"],
  input: recordProviderAvailabilityInputSchema,
  output: providerOutput,
  compare: providerRevisionCompareSchema,
  actors: ["machine"],
  errors: [...machineErrors, "not_found"],
});

export const recordProviderModels = defineCommand({
  resource: "provider-credentials",
  method: "record-models",
  name: "RecordProviderModels",
  changes: ["providers", "models"],
  input: recordProviderModelsInputSchema,
  output: providerOutput,
  compare: providerRevisionCompareSchema,
  // user: login 처리기가 사람의 context로 부른다. executor가 writer에서도 actors를 검사한다.
  actors: ["user", "machine"],
  errors: [...machineErrors, "not_found"],
});

export const refreshProviderModels = defineCommand({
  resource: "providers",
  method: "refresh-models",
  name: "RefreshProviderModels",
  changes: ["providers", "models"],
  input: refreshProviderModelsInputSchema,
  output: providerOutput,
  actors: ["user"],
  errors: [...userErrors, "not_found"],
});

export const providerRead = defineRead({
  resource: "providers",
  method: "read",
  name: "ReadProvider",
  input: providerReadInputSchema,
  output: withReadCommon(providerOutput),
  reads: ["providers"],
  actors: readActors,
  errors: [...readErrors],
});

export const providerList = defineRead({
  resource: "providers",
  method: "list",
  name: "ListProviders",
  input: providerListInputSchema,
  output: withReadCommon(
    z.object({ providers: z.array(providerRecordSchema) }),
  ),
  reads: ["providers"],
  actors: readActors,
  errors: [...readErrors],
});

// lophn이 알아두는 연결 가능 provider의 내장 정의. ledger row가 아니라 product catalog다.
export const providerDefinitions = defineRead({
  resource: "providers",
  method: "definitions",
  name: "ListProviderDefinitions",
  input: z.strictObject({}),
  output: z.object({ definitions: z.array(providerDefinitionOutputSchema) }),
  actors: readActors,
  errors: [...readErrors],
});

export const loginCancel = defineCommand({
  resource: "providers",
  method: "login-cancel",
  name: "CancelProviderLogin",
  changes: ["providers"],
  input: loginCancelInputSchema,
  output: z.object({ cancelled: z.boolean() }),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "not_found"],
});

// 아래 넷은 사람이 provider를 잇는 순서를 core가 쥐는 입구다. 화면(desktop, 폰, 다른 기계의 창)은 id를 만들거나 값을
// 옮기지 않고 이것만 부른다. 안에서 부르는 ConnectProvider는 이 route를 부른 사람의 context로 writer에 간다.

// API key로 잇는다. body는 key의 UTF-8이다. core가 id를 정하고 값을 임시 이름에 올린 뒤 ConnectProvider를 보낸다.
// 모르는 정의는 not_found, 그 정의가 이미 이어져 있으면 conflict, custom 주소가 규칙(https나 이 기계의 http)에 맞지 않으면
// invalid_input이다. 어느 갈래로 실패해도 값은 남지 않는다.
export const providerConnectKey = defineUpload({
  resource: "providers",
  method: "connect-key",
  name: "ConnectProviderKey",
  changes: ["providers", "models", "secrets"],
  input: z.strictObject({
    target: providerConnectTargetSchema,
    bytes: z.number().int().min(1).max(SECRET_INPUT_MAX_BYTES),
  }),
  output: providerOutput,
  actors: ["user"],
  errors: [...userErrors, "not_found"],
  max_bytes: SECRET_INPUT_MAX_BYTES,
});

// 이 기계의 http 주소(인증 없음)에 Custom provider를 잇는다. https 주소는 key가 있어야 해서 invalid_input이다.
export const providerConnectLocal = defineMemory({
  resource: "providers",
  method: "connect-local",
  name: "ConnectLocalProvider",
  changes: ["providers", "models"],
  input: connectLocalProviderInputSchema,
  output: providerOutput,
  actors: ["user"],
  errors: [...userErrors],
});

// 구독 로그인을 시작한다. 시작한 뒤 발급자를 기다리는 것은 core다. 화면은 주소(와 device code)를 보이고
// `providers/sign-in-state`를 읽는다. OAuth가 없는 정의나 provider sign_in 요청이 아닌 request는 invalid_input,
// 이미 이어진 정의는 conflict, 모르는 정의나 열려 있지 않은 요청은 not_found다.
export const providerSignIn = defineMemory({
  resource: "providers",
  method: "sign-in",
  name: "SignInProvider",
  changes: [{ name: "providers", id: (_input, output) => output.provider }],
  input: providerSignInInputSchema,
  output: providerSignInOutputSchema,
  actors: ["user"],
  errors: [...userErrors, "not_found"],
});

// 로그인 하나의 상태. 상태가 바뀔 때마다 core가 `StateChanged{providers, <provider>}`를 낸다.
export const providerSignInState = defineMemory({
  resource: "providers",
  method: "sign-in-state",
  name: "ReadProviderSignIn",
  input: z.strictObject({ login: z.string().min(1).max(200) }),
  output: providerSignInStateSchema,
  reads: ["providers"],
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "not_found"],
});

// 다른 기기가 시작한 loopback 로그인(`callback_mode: remote_handoff`)의 callback을 건넨다. 받은 core가 state를 대조하고
// token 교환을 이 기계에서 한다. 기기가 시작한 로그인이 아니거나 이미 끝났으면 not_found·conflict, 주소가 이 시도의 것이
// 아니면 invalid_input이다.
export const providerSignInCallback = defineMemory({
  resource: "providers",
  method: "sign-in-callback",
  name: "DeliverProviderSignInCallback",
  changes: [{ name: "providers", id: (input) => input.provider }],
  input: providerSignInCallbackInputSchema,
  output: z.strictObject({ accepted: z.literal(true) }),
  actors: ["user"],
  errors: [...userErrors, "not_found", "conflict"],
});

export const PROVIDER_ROUTES = [
  disconnectProvider,
  providerRead,
  providerList,
  providerDefinitions,
  providerConnectLocal,
  providerSignIn,
  providerSignInState,
  providerSignInCallback,
  loginCancel,
  refreshProviderCredential,
  recordProviderAvailability,
  recordProviderModels,
  refreshProviderModels,
] as const;
