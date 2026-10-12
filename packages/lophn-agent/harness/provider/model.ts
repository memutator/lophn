import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type ProviderCredential,
  providerCredentialSchema,
  type ProviderDefinition,
  providerDefinitionSchema,
  providerProtocolSchema,
  type ProviderRecord,
  providerRecordSchema,
} from "../../../contracts/lophn-agent/mod.ts";
import type { SqlRow } from "../../../contracts/platform/mod.ts";

// 순수 함수만. IO 없다. row↔record, 상태 전이, 불변 조건을 여기 둔다.

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored provider" });
}

type Query = {
  all(query: string, params?: readonly unknown[]): SqlRow[];
};

// provider당 credential은 하나다. 읽을 때 model block을 함께 모은다.
export function credentialFromRow(
  sql: Query,
  provider: string,
): Result<ProviderCredential | null> {
  const row = sql.all(
    "select kind, secret_name, secret_sealed_ref, secret_revision, revision, state, unavailable_reason, until, expires_at, logged_in_at, refreshed_at from provider_credentials where provider = ?",
    [provider],
  )[0];
  if (row === undefined) return ok(null);
  const text = (value: unknown): string | null =>
    value === null ? null : String(value);
  const secretName = text(row["secret_name"]);
  const secretSealedRef = text(row["secret_sealed_ref"]);
  const secretRevision = row["secret_revision"] === null
    ? null
    : Number(row["secret_revision"]);
  const value: ProviderCredential = {
    kind: row["kind"] as ProviderCredential["kind"],
    secret_ref: secretName === null || secretSealedRef === null ||
        secretRevision === null
      ? null
      : {
        name: secretName,
        sealed_ref: secretSealedRef,
        revision: secretRevision,
      },
    revision: Number(row["revision"]),
    state: row["state"] as ProviderCredential["state"],
    unavailable_reason: row["unavailable_reason"] === null
      ? null
      : row["unavailable_reason"] as ProviderCredential["unavailable_reason"],
    until: text(row["until"]),
    expires_at: text(row["expires_at"]),
    logged_in_at: text(row["logged_in_at"]),
    refreshed_at: text(row["refreshed_at"]),
    model_blocks: modelBlocksFromRow(sql, provider),
  };
  return assertCredential(value);
}

export function modelBlocksFromRow(
  sql: Query,
  provider: string,
): ProviderCredential["model_blocks"] {
  return sql.all(
    "select model_name, reason, until from provider_credential_model_blocks where provider = ? order by model_name",
    [provider],
  ).map((row) => ({
    model_name: String(row["model_name"]),
    reason:
      row["reason"] as ProviderCredential["model_blocks"][number]["reason"],
    until: row["until"] === null ? null : String(row["until"]),
  }));
}

export function assertCredential(
  value: ProviderCredential,
): Result<ProviderCredential> {
  const parsed = providerCredentialSchema.safeParse(value);
  if (!parsed.success) return invalidStored();
  return ok(parsed.data);
}

export function assertDefinition(
  value: ProviderDefinition,
): Result<ProviderDefinition> {
  const parsed = providerDefinitionSchema.safeParse(value);
  if (!parsed.success) return invalidStored();
  return ok(parsed.data);
}

export function assertRecord(
  value: ProviderRecord,
): Result<ProviderRecord> {
  const parsed = providerRecordSchema.safeParse(value);
  if (!parsed.success) return invalidStored();
  return ok(parsed.data);
}

export function providerFromRow(
  sql: Query,
  row: SqlRow,
): Result<ProviderRecord | null> {
  if (row["id"] === undefined) return ok(null);
  let definition: unknown;
  try {
    definition = JSON.parse(String(row["definition"]));
  } catch {
    return invalidStored();
  }
  const parsedDefinition = providerDefinitionSchema.safeParse(definition);
  if (!parsedDefinition.success) return invalidStored();
  const protocolParsed = providerProtocolSchema.safeParse(row["protocol"]);
  if (!protocolParsed.success) return invalidStored();
  const credential = credentialFromRow(sql, String(row["id"]));
  if (!credential.ok) return credential;
  // credential 없는 provider는 저장될 수 없다.
  if (credential.value === null) return invalidStored();
  const parsed = providerRecordSchema.safeParse({
    id: String(row["id"]),
    name: String(row["name"]),
    definition: parsedDefinition.data,
    endpoint: String(row["endpoint"]),
    protocol: protocolParsed.data,
    credential: credential.value,
    revision: Number(row["revision"]),
  });
  if (!parsed.success) return invalidStored();
  return ok(parsed.data);
}

// rejected·usage_wait는 오가지만 revoked는 Disconnect 뒤 Connect(새 credential)로만 벗어난다.
// 가용 기록만으로 되살리지 않는다.
export function nextCredentialState(
  current: ProviderCredential["state"],
  next: ProviderCredential["state"],
): Result<ProviderCredential["state"]> {
  if (next === current) return ok(next);
  if (current === "revoked") {
    return err({
      code: "conflict",
      message: "a revoked credential comes back only by Disconnect and Connect",
    });
  }
  return ok(next);
}
