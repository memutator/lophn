// secret 사용 대역(apps/preview#R4). 실제 keychain·전송부·redaction 등록에 닿지 않고 값도 어디에도
// 없다. 선언한 secret 이름과 선언한 목적지만 받고 사용 요청만 메모리에 남긴다. 같은 규칙의 앱 쪽
// 대역은 packages/sdk/cap-secret의 createSecretStandIn이고, 앱 프로세스는 live가 아닌 mode에서 그것을
// 쓴다. 이 대역은 broker 통로로 직접 온 요청을 같은 규칙으로 받는 server 쪽이다.
import { ok } from "../../../../base/mod.ts";
import { brokerSecretUseInputSchema } from "../../../../protocol/apps/mod.ts";
import type { SecretUseService } from "../../permissions/mod.ts";
import type { PreviewScope } from "../model.ts";
import { invalid, refuse, standInOnly } from "./refusal.ts";

export type PreviewSecretUse = {
  name: string;
  destination: { host: string; port: number };
  command: string;
};

export type PreviewSecretService = SecretUseService & {
  readonly uses: readonly PreviewSecretUse[];
};

export function createPreviewSecretService(
  scope: Pick<PreviewScope, "secrets" | "net">,
): PreviewSecretService {
  const uses: PreviewSecretUse[] = [];
  return {
    uses,
    use(child, body) {
      const parsed = brokerSecretUseInputSchema.safeParse(body);
      if (!parsed.success) {
        return Promise.resolve(invalid("secret use input is invalid"));
      }
      const input = parsed.data;
      const refused = standInOnly(child, "secret.use", { name: input.name });
      if (refused) return Promise.resolve(refused);
      if (!scope.secrets.includes(input.name)) {
        return Promise.resolve(refuse("secret.use", { name: input.name }));
      }
      const host = input.destination.host.toLowerCase();
      const port = input.destination.port;
      if (
        !scope.net.some((entry) => entry.host === host && entry.port === port)
      ) {
        return Promise.resolve(refuse("net.fetch", { host, port }));
      }
      uses.push({
        name: input.name,
        destination: { host, port },
        command: input.command,
      });
      return Promise.resolve(ok({ used: true as const }));
    },
  };
}
