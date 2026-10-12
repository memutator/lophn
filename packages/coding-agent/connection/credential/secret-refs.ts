// connection credential(keychain의 token)을 core의 알려진 값 registry에 등록하는 통로의 이 concern
// 쪽이다(coding-agent/connection#R17, platform/secrets#R1, platform/redaction#R1). connection 표는 이
// concern만 읽는다. core는 이 모양(SecretRefSource)만 받아 같은 keychain에서 값을 읽고 등록·회수한다.
// 값은 이 표에도 이 함수에도 없고 고정 참조(`coding-agent/<cac>`)만 있다. 회수된 연결의 token도
// keychain에 참조가 남는 동안은 알려진 값으로 두어 문서·메시지 본문에 나오지 않게 한다.
import { err, ok } from "../../../base/mod.ts";
import {
  CODING_CREDENTIAL_REF_PREFIX,
  connectionCreate,
  connectionIdSchema,
  connectionRevoke,
} from "../../../protocol/coding-agent/mod.ts";
import type { SecretRefSource } from "../../../protocol/server/mod.ts";

export const CONNECTION_SECRET_OWNER = "coding-agent/connection";

export function createConnectionSecretRefSource(): SecretRefSource {
  return {
    owner: CONNECTION_SECRET_OWNER,
    // connection이 생기거나 회수되면 알려진 값을 다시 맞춘다.
    commands: [connectionCreate.name, connectionRevoke.name],
    read(sql) {
      try {
        const refs: { name: string; sealedRef: string }[] = [];
        for (
          const row of sql.all(
            "select id from coding_agent_connections order by id",
            [],
          )
        ) {
          const id = connectionIdSchema.safeParse(row["id"]);
          if (!id.success) continue;
          refs.push({
            name: id.data,
            sealedRef: `${CODING_CREDENTIAL_REF_PREFIX}${id.data}`,
          });
        }
        return ok(refs);
      } catch {
        return err({
          code: "unavailable",
          message: "connection credential 참조를 읽지 못했다",
        });
      }
    },
  };
}
