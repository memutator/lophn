import { z } from "zod";
import { defineCommand, defineRead } from "../base/route.ts";
import { defineEvent } from "../events/events.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import {
  disconnectProviderInputSchema,
  loginBeginInputSchema,
  loginBeginOutputSchema,
  loginCancelInputSchema,
  loginCompleteInputSchema,
  loginCompleteOutputSchema,
  providerChangedPayloadSchema,
  providerDisconnectedPayloadSchema,
  providerListInputSchema,
  providerReadInputSchema,
  providerRegisteredPayloadSchema,
  providerRevisionCompareSchema,
  recordProviderAvailabilityInputSchema,
  refreshProviderCredentialInputSchema,
  registerProviderInputSchema,
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
const readActors = ["user", "agent", "machine", "coding_agent"] as const;

const providerOutput = z.object({ provider: providerRecordSchema });

export const registerProvider = defineCommand({
  resource: "providers",
  method: "register",
  name: "RegisterProvider",
  input: registerProviderInputSchema,
  output: providerOutput,
  actors: ["user"],
  errors: [...userErrors],
});

// Disconnect는 provider와 credential(secret)을 함께 지우므로 사람이 확인 창을 거쳐 결정한다.
export const disconnectProvider = defineCommand({
  resource: "providers",
  method: "disconnect",
  name: "DisconnectProvider",
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
  display_read: "/v1/providers/read",
});

export const refreshProviderCredential = defineCommand({
  resource: "provider-credentials",
  method: "refresh-result",
  name: "RefreshProviderCredential",
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
  input: recordProviderAvailabilityInputSchema,
  output: providerOutput,
  compare: providerRevisionCompareSchema,
  actors: ["machine"],
  errors: [...machineErrors, "not_found"],
});

export const providerRead = defineRead({
  resource: "providers",
  method: "read",
  name: "ReadProvider",
  input: providerReadInputSchema,
  output: withReadCommon(providerOutput),
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

export const loginBegin = defineCommand({
  resource: "providers",
  method: "login-begin",
  name: "BeginProviderLogin",
  input: loginBeginInputSchema,
  output: loginBeginOutputSchema,
  actors: ["user"],
  errors: [...userErrors, "not_found"],
});

export const loginComplete = defineCommand({
  resource: "providers",
  method: "login-complete",
  name: "CompleteProviderLogin",
  input: loginCompleteInputSchema,
  output: loginCompleteOutputSchema,
  actors: ["user"],
  errors: [...userErrors, "not_found"],
  confirmation: "required",
  confirmation_kind: "secret_input",
  binding: ["provider", "login", "submission"],
  display_read: "/v1/providers/read",
});

export const loginCancel = defineCommand({
  resource: "providers",
  method: "login-cancel",
  name: "CancelProviderLogin",
  input: loginCancelInputSchema,
  output: z.object({ cancelled: z.boolean() }),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "not_found"],
});

const providerSubject = idSchema("pvd");

export const providerRegistered = defineEvent("ProviderRegistered", {
  subject: providerSubject,
  payload: providerRegisteredPayloadSchema,
});
export const providerChanged = defineEvent("ProviderChanged", {
  subject: providerSubject,
  payload: providerChangedPayloadSchema,
});
export const providerDisconnected = defineEvent("ProviderDisconnected", {
  subject: providerSubject,
  payload: providerDisconnectedPayloadSchema,
});

export const PROVIDER_ROUTES = [
  registerProvider,
  disconnectProvider,
  providerRead,
  providerList,
  providerDefinitions,
  loginBegin,
  loginComplete,
  loginCancel,
  refreshProviderCredential,
  recordProviderAvailability,
] as const;

export const PROVIDER_EVENTS = [
  providerRegistered,
  providerChanged,
  providerDisconnected,
] as const;
