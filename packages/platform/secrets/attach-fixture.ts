import { err, ok, type Result } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  SecretSendInput,
  SecretStoreRefreshInput,
  SecretValue,
  Tx,
} from "../../contracts/platform/mod.ts";
import { defineCommand } from "../../contracts/platform/mod.ts";
import { z } from "zod";
import { defineSyncCommand } from "../ledger/mod.ts";
import { createFakeKeychain } from "./adapters/fake-keychain.ts";
import type { SecretReferenceLookup } from "./attach.ts";
import type { RefreshSubmission } from "./refresh.ts";
import { createSecretWork, type PreparationStore } from "./work.ts";
import { createKnownSecretRegistry } from "../redaction/mod.ts";

export const VALUE = "provider-token-value";

export function context(operations: string[]): AuthenticatedContext {
  return {
    principal: "provider-adapter",
    actor: "machine",
    scope: { operations, targets: { process: "process-a", task: "task-a" } },
    conditions: { process: "process-a", task: "task-a" },
    credential_ref: "credential-a",
  };
}

export const destination = {
  kind: "https" as const,
  origin: "https://provider.example",
};

export function use(
  over: Partial<SecretSendInput["use"]> = {},
): SecretSendInput["use"] {
  return {
    sealed_ref: "sealed-1",
    revision: 1,
    purpose: "provider_credential",
    destination,
    ...over,
  };
}

export function refreshInput(
  over: Partial<SecretStoreRefreshInput> = {},
): SecretStoreRefreshInput {
  return {
    context: context(["secret.store-refresh"]),
    owner: "provider-a",
    sealed_ref: "sealed-1",
    revision: 1,
    purpose: "provider_credential",
    destination,
    ...over,
  };
}

export function references(current = use()): SecretReferenceLookup {
  return {
    current: () =>
      Promise.resolve(ok({
        name: "provider-a",
        sealedRef: current.sealed_ref,
        revision: current.revision,
        purpose: current.purpose,
        destination: current.destination,
      })),
  };
}

export const granted = () => ok(undefined);
export const alive = () => true;

export function storeValue(keychain: ReturnType<typeof createFakeKeychain>) {
  return keychain.store({
    name: "provider-a",
    purpose: "provider_credential",
    owner: "provider-a",
    value: new TextEncoder().encode(VALUE),
  });
}

export function text(value: SecretValue): string {
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}

export function work(keychain = createFakeKeychain()) {
  const preparations: PreparationStore = {
    record: () => Promise.resolve(ok(undefined)),
    orphans: () => Promise.resolve(ok([])),
  };
  return createSecretWork({
    keychain,
    preparations,
    registry: createKnownSecretRegistry(),
    processes: { ended: () => Promise.resolve(true) },
    preparationId: () => "prep-1",
  });
}

const ownerInputSchema = z.strictObject({
  owner: z.string(),
  preparation: z.object({
    preparation: z.string(),
    sealed_ref: z.string(),
    purpose: z.string(),
    owner: z.string(),
  }),
});

export function ownerCommand() {
  const route = defineCommand({
    resource: "providers",
    method: "refresh-credential",
    name: "RefreshProviderCredential",
    input: ownerInputSchema,
    output: z.object({
      sealed_ref: z.string(),
      revision: z.number(),
      configured: z.literal(true),
    }),
    compare: z.strictObject({ sealed_ref: z.string(), revision: z.number() }),
    actors: ["machine"],
    errors: ["conflict", "unavailable"],
  });
  return defineSyncCommand(
    route,
    () => err({ code: "unavailable", message: "테스트 대역" }),
  );
}

export function submission(
  command: RefreshSubmission["command"] = ownerCommand(),
): RefreshSubmission {
  return {
    current: () =>
      Promise.resolve(ok({
        sealedRef: "sealed-1",
        revision: 1,
        purpose: "provider_credential",
        destination,
      })),
    command,
    input: (owner, preparation) => ({ owner, preparation }),
  };
}

export function fakeTx(
  call: (
    route: { name: string },
    input: unknown,
    compare: unknown,
  ) => Result<unknown> = () =>
    ok({ sealed_ref: "sealed-2", revision: 2, configured: true }),
): Tx {
  return { call } as unknown as Tx;
}
