import type { Result } from "../../base/mod.ts";
import type { SecretDestination } from "../../protocol/secrets/mod.ts";
import {
  mcpOAuthSecretDestinations,
  type McpRuntimeServer,
  mcpSecretDestinations,
  type McpVaultSecrets,
} from "./extensions/mod.ts";

// `secrets.json` 이름 공간마다 그 값이 갈 수 있는 목적지다. 파일 secret 부착(core/secrets/file-attach.ts)이 보낼
// 때마다 읽는다.
// - `provider.`: 그 이름을 가진 회수되지 않은 provider의 endpoint origin
// - `mcp.`: 그 이름을 header나 bearer·api_key로 보내는 켜진 http 서버(전역, Home·project·앱 층, agent 정의)의 URL origin
// - `mcp-oauth.`: 그 접근 token의 meta가 묶인 서버 URL origin
// 이름 공간마다 목적지를 따로 찾으므로 한 이름 공간의 값은 다른 이름 공간의 목적지로 가지 않는다.
export function createSecretDestinations(deps: {
  providers(name: string): readonly SecretDestination[];
  mcpServers(): Promise<Result<readonly McpRuntimeServer[]>>;
  secrets: Pick<McpVaultSecrets, "get">;
}): { allowed(name: string): Promise<readonly SecretDestination[]> } {
  return {
    async allowed(name) {
      if (name.startsWith("provider.")) return deps.providers(name);
      if (name.startsWith("mcp-oauth.")) {
        return mcpOAuthSecretDestinations(deps.secrets, name);
      }
      if (name.startsWith("mcp.")) {
        const servers = await deps.mcpServers();
        return servers.ok ? mcpSecretDestinations(servers.value, name) : [];
      }
      return [];
    },
  };
}
