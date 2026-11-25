import { canonicalize } from "../../../base/mod.ts";
import type { SecretSlot } from "../../../protocol/lophn-agent/input-request.ts";
import type {
  AgentId,
  McpOwnerWorkspace,
  McpServer,
  McpTrust,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  type SecretDestination,
  secretDestinationOf,
} from "../../../protocol/secrets/mod.ts";
import { mcpOwnerScope, mcpTokenNames } from "./mcp-oauth-vault.ts";

// 연결이 쓰는 MCP 서버 한 대다. 층에서 온 설정(`McpServer`, secret은 `secrets.json`의 이름 `{secret}`)을 연결,
// OAuth, secret 부착이 읽는 한 모양으로 옮긴다. 값은 없고 이름뿐이다. 서버는 이름만으로 하나가 정해지지 않는다:
// 같은 이름도 층의 workspace가 다르면 따로이고, OAuth token의 이름이 그 workspace에서 정해진다.

type RuntimeValue =
  | { kind: "value"; value: string }
  | { kind: "secret"; secret: string };

type RuntimeAuth =
  | { kind: "none" }
  | { kind: "bearer"; secret: string }
  | { kind: "api_key"; secret: string; header_name: string }
  | {
      kind: "oauth2";
      issuer: string;
      client_id: string;
      // 사람이 넣은 client secret의 `secrets.json` 이름이다. 값은 OAuth 입구가 읽는다.
      client_secret: string | null;
      scopes: string[];
      // 이 서버(소유자와 이름)의 접근 token 이름이다. 로그인했는지는 보관이 말한다.
      token: string;
    };

type Common = {
  name: string;
  enabled: boolean;
  call_timeout_ms: number;
  trust: McpTrust;
  // 설정이 바뀌면 달라지는 지문이다. 같은 연결을 이어 쓸지 가른다.
  fingerprint: string;
};

export type McpRuntimeServer = Common &
  (
    | {
        transport: "stdio";
        stdio: {
          executable: string;
          args: string[];
          cwd: string | null;
          env: Record<string, string>;
        };
      }
    | {
        transport: "http";
        http: {
          url: string;
          headers: Record<string, RuntimeValue>;
          auth: RuntimeAuth;
        };
      }
  );

// 전역, Home·project·app, agent 정의 층의 서버다. 층의 소유자는 workspace(Home·project·app) 또는 agent(정의)이고 전역은 둘 다
// null이다. OAuth token의 이름과 설정 지문도 이 소유자에서 정해진다.
export function runtimeServerOfLayer(
  server: McpServer,
  workspace: McpOwnerWorkspace | null,
  agent: AgentId | null = null,
): McpRuntimeServer {
  const common = {
    name: server.name,
    enabled: server.enabled,
    call_timeout_ms: server.call_timeout_ms,
    trust: server.trust ?? "untrusted",
    fingerprint: canonicalize([mcpOwnerScope(workspace), agent, server]),
  };
  if (server.transport === "stdio") {
    return {
      ...common,
      transport: "stdio",
      stdio: {
        executable: server.stdio.executable,
        args: [...server.stdio.args],
        cwd: server.stdio.cwd,
        env: Object.fromEntries(
          Object.entries(server.stdio.env).map(([name, one]) => [
            name,
            one.value,
          ]),
        ),
      },
    };
  }
  const auth = server.http.auth;
  return {
    ...common,
    transport: "http",
    http: {
      url: server.http.url,
      headers: Object.fromEntries(
        Object.entries(server.http.headers).map(([name, one]) => [
          name,
          "secret" in one
            ? { kind: "secret", secret: one.secret }
            : { kind: "value", value: one.value },
        ]),
      ),
      auth:
        auth.kind === "none"
          ? { kind: "none" }
          : auth.kind === "bearer"
            ? { kind: "bearer", secret: auth.credential.secret }
            : auth.kind === "api_key"
              ? {
                  kind: "api_key",
                  secret: auth.credential.secret,
                  header_name: auth.header_name,
                }
              : {
                  kind: "oauth2",
                  issuer: auth.issuer,
                  client_id: auth.client_id,
                  client_secret:
                    auth.client_credential === null
                      ? null
                      : auth.client_credential.secret,
                  scopes: [...auth.scopes],
                  token: mcpTokenNames({ workspace, agent, name: server.name })
                    .access,
                },
    },
  };
}

// `mcp.` 이름의 값이 갈 수 있는 목적지: 그 이름을 header나 bearer·api_key로 보내는 켜진 http 서버의 URL origin
// 전부다. oauth2의 client credential은 서버로 가지 않아 목적지가 없다.
export function mcpSecretDestinations(
  servers: readonly McpRuntimeServer[],
  name: string,
): SecretDestination[] {
  const found: SecretDestination[] = [];
  for (const server of servers) {
    if (!server.enabled || server.transport !== "http") continue;
    const { headers, auth } = server.http;
    const sent =
      Object.values(headers).some(
        (one) => one.kind === "secret" && one.secret === name,
      ) ||
      ((auth.kind === "bearer" || auth.kind === "api_key") &&
        auth.secret === name);
    if (!sent) {
      continue;
    }
    const destination = secretDestinationOf(server.http.url);
    if (destination !== undefined) {
      found.push(destination);
    }
  }
  return found;
}

type McpLayer = {
  servers: readonly McpRuntimeServer[];
  // 이 층이 끈 아래 층의 서버 이름이다. 지금 없는 이름은 아무 일도 하지 않는다.
  off: readonly string[];
};

// 층 순서(전역, Home·project·app, agent)로 서버를 합친다. 같은 이름은 마지막 층이 덮고 이름이 다르면 모두 쓴다.
// 서버 자신의 enabled가 false인 것은 남는다. 연결하는 쪽이 거른다.
export function mergeMcpLayers(
  layers: readonly McpLayer[],
): McpRuntimeServer[] {
  const merged = new Map<string, McpRuntimeServer>();
  for (const layer of layers) {
    for (const name of layer.off) merged.delete(name);
    for (const server of layer.servers) merged.set(server.name, server);
  }
  return [...merged.values()];
}

// 연결하지 못한 이유가 값이 없음이거나 인증 거절이면 agent가 `lophn ask secret`에 그대로 넘길 빈 자리다. 이름은 설정에서 역산한
// 역할(`credential`, `sign_in`, `client`, `header:<이름>`)이고 agent가 정한 것도 서버가 쓴 글도 아니다.
export function mcpMissingSlot(
  server: McpRuntimeServer,
  connection: { state: string; missing_secret: string | null },
): SecretSlot | undefined {
  if (server.transport !== "http") return undefined;
  const { auth, headers } = server.http;
  const secret = connection.missing_secret;
  let part: string | undefined;
  if (secret !== null) {
    if (
      (auth.kind === "bearer" || auth.kind === "api_key") &&
      auth.secret === secret
    ) {
      part = "credential";
    } else if (auth.kind === "oauth2" && auth.token === secret) {
      part = "sign_in";
    } else if (auth.kind === "oauth2" && auth.client_secret === secret) {
      part = "client";
    } else {
      const header = Object.entries(headers).find(
        ([, value]) => value.kind === "secret" && value.secret === secret,
      );
      if (header !== undefined) part = `header:${header[0]}`;
    }
  } else if (connection.state === "failed_auth") {
    part =
      auth.kind === "bearer" || auth.kind === "api_key"
        ? "credential"
        : "sign_in";
  }
  return part === undefined ? undefined : { mcp: server.name, part };
}
