// provider endpoint가 credential을 받을 수 있는 고정 목적지.
import type { Sql } from "../../../protocol/server/mod.ts";
import {
  type SecretDestination,
  secretDestinationOf,
} from "../../../protocol/secrets/mod.ts";

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
    const destination = secretDestinationOf(String(row["endpoint"]));
    if (destination !== undefined) found.push(destination);
  }
  return found;
}
