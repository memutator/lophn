// provider credential이 가리키는 secret 참조를 core의 알려진 값 registry에 등록하는 통로의 이
// concern 쪽(platform/secrets#R1, platform/redaction#R1). provider_credentials 표는 이 concern만
// 읽는다. core는 이 모양(SecretRefSource)만 받아 같은 keychain에서 값을 읽고 등록·회수한다.
// 값은 이 표에도 이 함수에도 없고 참조만 있다.
import { err, ok } from "../../../base/mod.ts";
import {
  changeProviderCredentials,
  refreshProviderCredential,
  registerProviderCredential,
} from "../../../contracts/lophn-agent/mod.ts";
import type { SecretRefSource } from "../../../contracts/platform/mod.ts";

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
