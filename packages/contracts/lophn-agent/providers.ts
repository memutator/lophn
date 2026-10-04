import { z } from "zod";
import {
  defineCommand,
  defineEvent,
  defineRead,
  idSchema,
  withReadCommon,
} from "../platform/mod.ts";
import {
  changeProviderCredentialsInputSchema,
  changeProviderInputSchema,
  connectionTestInputSchema,
  connectionTestOutputSchema,
  loginBeginInputSchema,
  loginBeginOutputSchema,
  loginCancelInputSchema,
  loginCompleteInputSchema,
  providerChangedPayloadSchema,
  providerCheckedPayloadSchema,
  providerCredentialListInputSchema,
  providerListInputSchema,
  providerReadInputSchema,
  providerRegisteredPayloadSchema,
  providerRevisionCompareSchema,
  recordProviderAvailabilityInputSchema,
  recordProviderCheckInputSchema,
  refreshProviderCredentialInputSchema,
  registerProviderCredentialInputSchema,
  registerProviderInputSchema,
} from "./provider-inputs.ts";
import {
  providerCredentialOutputSchema,
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

export const changeProvider = defineCommand({
  resource: "providers",
  method: "change",
  name: "ChangeProvider",
  input: changeProviderInputSchema,
  output: providerOutput,
  compare: providerRevisionCompareSchema,
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "conflict",
    "not_found",
  ],
});

export const registerProviderCredential = defineCommand({
  resource: "provider-credentials",
  method: "register",
  name: "RegisterProviderCredential",
  input: registerProviderCredentialInputSchema,
  output: providerOutput,
  compare: providerRevisionCompareSchema,
  actors: ["user"],
  errors: [...userErrors, "not_found"],
  confirmation: "required",
  confirmation_kind: "secret_input",
  binding: ["provider", "key", "preparation"],
  display_read: "/v1/providers/read",
});

export const changeProviderCredentials = defineCommand({
  resource: "provider-credentials",
  method: "change",
  name: "ChangeProviderCredentials",
  input: changeProviderCredentialsInputSchema,
  output: providerOutput,
  compare: providerRevisionCompareSchema,
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "conflict",
    "not_found",
  ],
  confirmation: "required",
  confirmation_kind: "secret_input",
  binding: ["provider", "credentials"],
  display_read: "/v1/provider-credentials/list",
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

export const recordProviderCheck = defineCommand({
  resource: "providers",
  method: "record-check",
  name: "RecordProviderCheck",
  input: recordProviderCheckInputSchema,
  output: providerOutput,
  compare: providerRevisionCompareSchema,
  actors: ["user", "machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "conflict",
    "not_found",
  ],
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

export const providerCredentialList = defineRead({
  resource: "provider-credentials",
  method: "list",
  name: "ListProviderCredentials",
  input: providerCredentialListInputSchema,
  output: withReadCommon(z.object({
    credentials: z.array(providerCredentialOutputSchema),
  })),
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
  output: providerOutput,
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

export const connectionTest = defineCommand({
  resource: "providers",
  method: "test",
  name: "TestProviderConnection",
  input: connectionTestInputSchema,
  output: connectionTestOutputSchema,
  actors: ["user"],
  errors: [...userErrors, "not_found"],
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
export const providerChecked = defineEvent("ProviderChecked", {
  subject: providerSubject,
  payload: providerCheckedPayloadSchema,
});

export const PROVIDER_ROUTES = [
  registerProvider,
  changeProvider,
  recordProviderCheck,
  providerRead,
  providerList,
  loginBegin,
  loginComplete,
  loginCancel,
  connectionTest,
  registerProviderCredential,
  changeProviderCredentials,
  refreshProviderCredential,
  recordProviderAvailability,
  providerCredentialList,
] as const;

export const PROVIDER_EVENTS = [
  providerRegistered,
  providerChanged,
  providerChecked,
] as const;
