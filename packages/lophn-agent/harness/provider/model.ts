import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type ProviderCheck,
  providerCredentialSchema,
  providerDefinitionSchema,
  providerProtocolSchema,
  type ProviderCredential,
  type ProviderDefinition,
  type ProviderRecord,
  providerRecordSchema,
  PROVIDER_AUTH_KINDS,
} from "../../../contracts/lophn-agent/mod.ts";
import type { SqlRow } from "../../../contracts/platform/mod.ts";

// 순수 함수만. IO 없다. row↔record, 상태 전이, 불변 조건을 여기 둔다.

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored provider" });
}

export type CredentialRow = {
  key: string;
  kind: ProviderCredential["kind"];
  label: string;
  secretName: string | null;
  secretSealedRef: string | null;
  secretRevision: number | null;
  revision: number;
  order: number;
  enabled: boolean;
  account: string | null;
  organization: string | null;
  plan: string | null;
  dedupFingerprint: string | null;
  dedupProduct: string | null;
  state: ProviderCredential["state"];
  unavailableReason: ProviderCredential["unavailable_reason"];
  until: string | null;
  expiresAt: string | null;
  loggedInAt: string | null;
  refreshedAt: string | null;
};

// setReadBigInts가 INTEGER 열을 bigint로 준다(platform/ledger#R9).
function bool(value: unknown): boolean {
  return value === 1 || value === 1n || value === true;
}

export function credentialFromRow(sql: {
  all(query: string, params?: readonly unknown[]): SqlRow[];
}, provider: string, key: string): Result<CredentialRow | null> {
  const rows = sql.all(
    "select key, kind, label, secret_name, secret_sealed_ref, secret_revision, revision, order_index, enabled, account, organization, plan, dedup_fingerprint, dedup_product, state, unavailable_reason, until, expires_at, logged_in_at, refreshed_at from provider_credentials where provider = ? and key = ?",
    [provider, key],
  );
  const row = rows[0];
  if (row === undefined) return ok(null);
  return ok({
    key: String(row["key"]),
    kind: row["kind"] as CredentialRow["kind"],
    label: String(row["label"]),
    secretName: row["secret_name"] === null ? null : String(row["secret_name"]),
    secretSealedRef: row["secret_sealed_ref"] === null
      ? null
      : String(row["secret_sealed_ref"]),
    secretRevision: row["secret_revision"] === null
      ? null
      : Number(row["secret_revision"]),
    revision: Number(row["revision"]),
    order: Number(row["order_index"]),
    enabled: bool(row["enabled"]),
    account: row["account"] === null ? null : String(row["account"]),
    organization: row["organization"] === null
      ? null
      : String(row["organization"]),
    plan: row["plan"] === null ? null : String(row["plan"]),
    dedupFingerprint: row["dedup_fingerprint"] === null
      ? null
      : String(row["dedup_fingerprint"]),
    dedupProduct: row["dedup_product"] === null
      ? null
      : String(row["dedup_product"]),
    state: row["state"] as CredentialRow["state"],
    unavailableReason: row["unavailable_reason"] === null
      ? null
      : row["unavailable_reason"] as CredentialRow["unavailableReason"],
    until: row["until"] === null ? null : String(row["until"]),
    expiresAt: row["expires_at"] === null ? null : String(row["expires_at"]),
    loggedInAt: row["logged_in_at"] === null
      ? null
      : String(row["logged_in_at"]),
    refreshedAt: row["refreshed_at"] === null
      ? null
      : String(row["refreshed_at"]),
  });
}

// model_blocks는 credential 옆의 별도 표다. credential을 읽을 때 함께 모은다.
export function modelBlocksFromRow(sql: {
  all(query: string, params?: readonly unknown[]): SqlRow[];
}, provider: string, key: string): ProviderCredential["model_blocks"] {
  return sql.all(
    "select model_name, reason, until from provider_credential_model_blocks where provider = ? and credential_key = ? order by model_name",
    [provider, key],
  ).map((row) => ({
    model_name: String(row["model_name"]),
    reason: row["reason"] as ProviderCredential["model_blocks"][number]["reason"],
    until: row["until"] === null ? null : String(row["until"]),
  }));
}

export function toCredentialValue(row: CredentialRow): ProviderCredential {
  return {
    key: row.key,
    kind: row.kind,
    label: row.label,
    secret_ref: row.secretName === null || row.secretSealedRef === null ||
        row.secretRevision === null
      ? null
      : {
        name: row.secretName,
        sealed_ref: row.secretSealedRef,
        revision: row.secretRevision,
      },
    revision: row.revision,
    order: row.order,
    enabled: row.enabled,
    account: row.account,
    organization: row.organization,
    plan: row.plan,
    dedup_fingerprint: row.dedupFingerprint,
    state: row.state,
    unavailable_reason: row.unavailableReason,
    until: row.until,
    expires_at: row.expiresAt,
    logged_in_at: row.loggedInAt,
    refreshed_at: row.refreshedAt,
    model_blocks: [],
  };
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

export function assertCheck(value: ProviderCheck): Result<ProviderCheck> {
  return ok(value);
}

export type ProviderRow = {
  id: string;
  name: string;
  definitionKey: string;
  definition: ProviderDefinition;
  endpoint: string;
  protocol: ProviderRecord["protocol"];
  enabled: boolean;
  lastCheck: ProviderCheck | null;
  revision: number;
};

export function providerFromRow(sql: {
  all(query: string, params?: readonly unknown[]): SqlRow[];
}, row: SqlRow): Result<ProviderRecord | null> {
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
  const credentialRows = sql.all(
    "select key from provider_credentials where provider = ? order by order_index",
    [String(row["id"])],
  );
  const credentials: ProviderCredential[] = [];
  for (const credentialRow of credentialRows) {
    const loaded = credentialFromRow(sql, String(row["id"]), String(
      credentialRow["key"],
    ));
    if (!loaded.ok) return loaded;
    if (loaded.value === null) return invalidStored();
    const value = toCredentialValue(loaded.value);
    value.model_blocks = modelBlocksFromRow(sql, String(row["id"]), loaded.value.key);
    const checked = assertCredential(value);
    if (!checked.ok) return checked;
    credentials.push(checked.value);
  }
  const parsed = providerRecordSchema.safeParse({
    id: String(row["id"]),
    name: String(row["name"]),
    definition: parsedDefinition.data,
    endpoint: String(row["endpoint"]),
    protocol: protocolParsed.data,
    enabled: bool(row["enabled"]),
    credentials,
    last_check: row["last_check"] === null
      ? null
      : JSON.parse(String(row["last_check"])),
    revision: Number(row["revision"]),
  });
  if (!parsed.success) return invalidStored();
  return ok(parsed.data);
}

// credential은 회수 대신 state로 남는다. 삭제 전이는 없다.
// revoked → available은 교체가 있을 때만 닫는다. 가용 기록만으로 되살리지 않는다.
export function nextCredentialState(
  current: ProviderCredential["state"],
  next: ProviderCredential["state"],
): Result<ProviderCredential["state"]> {
  if (next === current) return ok(next);
  if (current === "revoked") {
    return err({
      code: "conflict",
      message: "revoked credential needs a replacement to become available",
    });
  }
  return ok(next);
}

// none 인증은 loopback provider에만 있다. 원격 provider는 credential을 요구한다.
export function authKindAllowed(
  definition: ProviderDefinition,
  kind: ProviderCredential["kind"],
): boolean {
  return (PROVIDER_AUTH_KINDS as readonly string[]).includes(kind) &&
    definition.auth_kinds.includes(kind);
}
