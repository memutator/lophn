// provider credential이 가리키는 secret 참조를 core의 알려진 값 registry에 등록하는 통로의 이
// concern 쪽(platform/secrets#R1, platform/redaction#R1). provider_credentials 표는 이 concern만
// 읽는다. core는 이 모양(SecretRefSource)만 받아 같은 keychain에서 값을 읽고 등록·회수한다.
// 값은 이 표에도 이 함수에도 없고 참조만 있다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  changeProviderCredentials,
  refreshProviderCredential,
  registerProviderCredential,
} from "../../../contracts/lophn-agent/mod.ts";
import type {
  SecretDestination,
  SecretRefSource,
  SecretUse,
  Sql,
} from "../../../contracts/platform/mod.ts";

export const PROVIDER_SECRET_OWNER = "lophn-agent/harness/provider";

export function createProviderSecretRefSource(): SecretRefSource {
  return {
    owner: PROVIDER_SECRET_OWNER,
    // credential의 secret 참조를 만들거나 바꾸거나 비우는 command다.
    commands: [
      registerProviderCredential.name,
      changeProviderCredentials.name,
      refreshProviderCredential.name,
    ],
    read(sql) {
      try {
        return ok(
          sql.all(
            `select provider, key, secret_sealed_ref from provider_credentials
             where secret_sealed_ref is not null order by provider, key`,
            [],
          ).map((row) => ({
            name: `${String(row["provider"])}/${String(row["key"])}`,
            sealedRef: String(row["secret_sealed_ref"]),
          })),
        );
      } catch {
        return err({
          code: "unavailable",
          message: "provider credential 참조를 읽지 못했다",
        });
      }
    },
  };
}

// provider endpoint가 credential 값을 받을 수 있는 고정 목적지. HTTPS origin이거나 같은 기계의
// loopback HTTP origin이고 그 밖(LAN·공개 주소의 HTTP, 모르는 형식)은 없다(provider#R5).
export function providerSecretDestination(
  endpoint: string,
): SecretDestination | undefined {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return undefined;
  }
  if (url.username !== "" || url.password !== "") return undefined;
  if (url.protocol === "https:") return { kind: "https", origin: url.origin };
  if (
    url.protocol === "http:" &&
    ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
  ) {
    return { kind: "loopback_http", origin: url.origin };
  }
  return undefined;
}

// 전송 직전에 secret 부착이 대조하는 현재 참조(platform/secrets#R5). ledger의 현재 provider·credential
// 기록만 보고 값은 보지 않는다. 참조·판이 현재와 다르면(교체·삭제된 옛 참조) conflict이고, 꺼진
// provider·credential과 회수한 credential, 고정할 수 없는 목적지는 forbidden이다(provider#R4).
export function lookupProviderSecretUse(
  sql: Pick<Sql, "all">,
  use: SecretUse,
): Result<{
  name: string;
  sealedRef: string;
  revision: number;
  purpose: SecretUse["purpose"];
  destination: SecretDestination;
}> {
  let rows: Record<string, unknown>[];
  try {
    rows = sql.all(
      `select c.secret_name, c.secret_sealed_ref, c.secret_revision,
              c.enabled as credential_enabled, c.state, p.endpoint,
              p.enabled as provider_enabled
         from provider_credentials c join providers p on p.id = c.provider
        where c.secret_sealed_ref = ?`,
      [use.sealed_ref],
    );
  } catch {
    return err({
      code: "unavailable",
      message: "provider credential 참조를 읽지 못했다",
    });
  }
  const row = rows[0];
  if (row === undefined) {
    return err({ code: "conflict", message: "현재 참조와 판이 다르다" });
  }
  const destination = providerSecretDestination(String(row["endpoint"]));
  if (
    destination === undefined || Number(row["provider_enabled"]) !== 1 ||
    Number(row["credential_enabled"]) !== 1 || row["state"] === "revoked"
  ) {
    return err({ code: "forbidden", message: "secret 전송을 허용하지 않는다" });
  }
  return ok({
    name: String(row["secret_name"]),
    sealedRef: String(row["secret_sealed_ref"]),
    revision: Number(row["secret_revision"]),
    purpose: "provider_credential",
    destination,
  });
}
