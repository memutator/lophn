import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type ProviderCredential,
  providerCredentialSchema,
  type ProviderDefinition,
  providerDefinitionSchema,
  providerProtocolSchema,
  type ProviderRecord,
  providerRecordSchema,
} from "../../../protocol/lophn-agent/mod.ts";
import type { SqlRow } from "../../../protocol/server/mod.ts";

// 순수 함수만. IO 없다. row↔record, 상태 전이, 불변 조건을 여기 둔다.

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored provider" });
}

type Query = {
  all(query: string, params?: readonly unknown[]): SqlRow[];
};

// provider에 등록된 모든 credential을 읽는다. active가 먼저 오고, 각 credential의 model block을 함께 모은다.
function credentialsFromRow(
  sql: Query,
  provider: string,
): Result<ProviderCredential[]> {
  const rows = sql.all(
    `select id, active, kind, secret_name, label, key_hint, revision, state, unavailable_reason,
            until, expires_at, logged_in_at, refreshed_at, reported_models, reported_model_limits, account
       from provider_credentials
      where provider = ?
      order by active desc, logged_in_at asc, id asc`,
    [provider],
  );
  if (rows.length === 0) return ok([]);
  const text = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value);
  const result: ProviderCredential[] = [];
  for (const row of rows) {
    const id = String(row["id"]);
    const secretName = text(row["secret_name"]);
    let reportedModels: unknown = null;
    let reportedModelLimits: unknown = null;
    let account: unknown = null;
    try {
      if (row["reported_models"] !== null) {
        reportedModels = JSON.parse(String(row["reported_models"]));
      }
      if (row["reported_model_limits"] !== null) {
        reportedModelLimits = JSON.parse(String(row["reported_model_limits"]));
      }
      if (row["account"] !== null) account = JSON.parse(String(row["account"]));
    } catch {
      return invalidStored();
    }
    const value: ProviderCredential = {
      id: id as ProviderCredential["id"],
      active: Number(row["active"]) === 1,
      kind: row["kind"] as ProviderCredential["kind"],
      secret_ref: secretName === null ? null : { name: secretName },
      label: text(row["label"]),
      key_hint: text(row["key_hint"]),
      revision: Number(row["revision"]),
      state: row["state"] as ProviderCredential["state"],
      unavailable_reason:
        row["unavailable_reason"] === null
          ? null
          : (row[
              "unavailable_reason"
            ] as ProviderCredential["unavailable_reason"]),
      until: text(row["until"]),
      expires_at: text(row["expires_at"]),
      logged_in_at: text(row["logged_in_at"]),
      refreshed_at: text(row["refreshed_at"]),
      model_blocks: modelBlocksFromRow(sql, id),
      reported_models: reportedModels as ProviderCredential["reported_models"],
      ...(reportedModelLimits === null
        ? {}
        : {
            reported_model_limits:
              reportedModelLimits as ProviderCredential["reported_model_limits"],
          }),
      account: account as ProviderCredential["account"],
    };
    const checked = assertCredential(value);
    if (!checked.ok) return checked;
    result.push(checked.value);
  }
  return ok(result);
}

function modelBlocksFromRow(
  sql: Query,
  credentialId: string,
): ProviderCredential["model_blocks"] {
  return sql
    .all(
      "select model_name, reason, until from provider_credential_model_blocks where credential = ? order by model_name",
      [credentialId],
    )
    .map((row) => ({
      model_name: String(row["model_name"]),
      reason: row[
        "reason"
      ] as ProviderCredential["model_blocks"][number]["reason"],
      until: row["until"] === null ? null : String(row["until"]),
    }));
}

// ChatGPT OAuth(Codex backend)와 OpenAI API key(api.openai.com/v1)처럼 활성 credential kind에 따라
// 호출 주소가 달라지는 provider의 endpoint를 계산한다.
export function endpointForCredential(
  definition: ProviderDefinition,
  currentEndpoint: string,
  kind: ProviderCredential["kind"],
): string {
  if (definition.oauth?.product !== "chatgpt") return currentEndpoint;
  if (kind === "oauth") return definition.oauth.inference_endpoint;
  if (definition.models_endpoint !== null) {
    const cut = definition.models_endpoint.lastIndexOf("/");
    if (cut > "https://".length) {
      return definition.models_endpoint.slice(0, cut);
    }
  }
  return currentEndpoint;
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

export function assertRecord(value: ProviderRecord): Result<ProviderRecord> {
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
  const credentials = credentialsFromRow(sql, String(row["id"]));
  if (!credentials.ok) return credentials;
  const active = credentials.value.find((item) => item.active);
  // 활성 credential 없는 provider는 저장될 수 없다.
  if (active === undefined) return invalidStored();
  const parsed = providerRecordSchema.safeParse({
    id: String(row["id"]),
    name: String(row["name"]),
    definition: parsedDefinition.data,
    endpoint: String(row["endpoint"]),
    protocol: protocolParsed.data,
    credential: active,
    credentials: credentials.value,
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
