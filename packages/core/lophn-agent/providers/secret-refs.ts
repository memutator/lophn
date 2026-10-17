// provider endpoint가 credential을 받을 수 있는 고정 목적지.
import type { Sql } from "../../../protocol/server/mod.ts";
import type { SecretDestination } from "../../../protocol/secrets/mod.ts";

// provider endpoint가 credential 값을 받을 수 있는 고정 목적지. HTTPS origin이거나 같은 기계의
// loopback HTTP origin이고 그 밖(LAN·공개 주소의 HTTP, 모르는 형식)은 없다.
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

// 파일 secret 부착이 대조하는 목적지. 이름이 `provider_credentials.secret_name`인 회수되지 않은
// credential의 provider endpoint origin 하나다. 모르는 이름·못 만드는 endpoint·revoked는 빈 목록이다.
export function providerSecretDestinations(
  sql: Pick<Sql, "all">,
  name: string,
): SecretDestination[] {
  let rows: Record<string, unknown>[];
  try {
    rows = sql.all(
      `select p.endpoint
         from provider_credentials c join providers p on p.id = c.provider
        where c.secret_name = ? and c.state != 'revoked'`,
      [name],
    );
  } catch {
    return [];
  }
  const found: SecretDestination[] = [];
  for (const row of rows) {
    const destination = providerSecretDestination(String(row["endpoint"]));
    if (destination !== undefined) found.push(destination);
  }
  return found;
}
