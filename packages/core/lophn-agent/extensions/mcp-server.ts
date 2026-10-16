import { canonicalize } from "../../../base/mod.ts";
import type {
  AgentPlace,
  McpServer,
  McpServerConfig,
} from "../../../protocol/lophn-agent/mod.ts";
import { mcpTokenRef } from "./mcp-oauth-vault.ts";

// 연결이 쓰는 MCP 서버 한 대다(concern lophn-agent/extensions). 층에서 온 설정(`McpServer`, secret은 이름 참조
// `{secret}`)과 전역 설정 값(`McpServerConfig`, secret은 `sec:` 참조)을 연결, OAuth, secret 부착이 읽는 한 모양으로
// 옮긴다. 값은 없고 참조뿐이다. 서버는 이름만으로 하나가 정해지지 않는다: 같은 이름도 층의 place가 다르면 따로이고,
// OAuth token의 참조가 그 place에서 정해진다.

export type RuntimeValue =
  | { kind: "value"; value: string }
  | { kind: "secret_ref"; secret_ref: string };

export type RuntimeAuth =
  | { kind: "none" }
  | { kind: "bearer"; secret_ref: string }
  | { kind: "api_key"; secret_ref: string; header_name: string }
  | {
    kind: "oauth2";
    issuer: string;
    client_id: string;
    client_secret_ref: string | null;
    scopes: string[];
    // 이 서버(place와 이름)의 token 보관을 가리키는 참조다. 로그인했는지는 보관이 말한다.
    token_ref: string;
  };

type Common = {
  name: string;
  enabled: boolean;
  call_timeout_ms: number;
  // 설정이 바뀌면 달라지는 지문이다. 같은 연결을 이어 쓸지 가른다.
  fingerprint: string;
};

export type McpRuntimeServer =
  & Common
  & (
    | {
      transport: "stdio";
      stdio: {
        executable: string;
        args: string[];
        cwd: string | null;
        env: Record<string, RuntimeValue>;
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

const secretRef = (name: string): string => `sec:${name}`;

function layerValue(
  value: { value: string } | { secret: string },
): RuntimeValue {
  return "secret" in value
    ? { kind: "secret_ref", secret_ref: secretRef(value.secret) }
    : { kind: "value", value: value.value };
}

function layerValues(
  values: Record<string, { value: string } | { secret: string }>,
): Record<string, RuntimeValue> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, layerValue(value)]),
  );
}

// 전역, project, agent 층의 서버다. place는 그 층이 놓인 곳이고 전역은 null이다.
export function runtimeServerOfLayer(
  server: McpServer,
  place: AgentPlace | null,
): McpRuntimeServer {
  const common = {
    name: server.name,
    enabled: server.enabled,
    call_timeout_ms: server.call_timeout_ms,
    fingerprint: canonicalize([place?.id ?? null, server]),
  };
  if (server.transport === "stdio") {
    return {
      ...common,
      transport: "stdio",
      stdio: {
        executable: server.stdio.executable,
        args: [...server.stdio.args],
        cwd: server.stdio.cwd,
        env: layerValues(server.stdio.env),
      },
    };
  }
  const auth = server.http.auth;
  const tokenRef = mcpTokenRef({ place, name: server.name });
  return {
    ...common,
    transport: "http",
    http: {
      url: server.http.url,
      headers: layerValues(server.http.headers),
      auth: auth.kind === "none"
        ? { kind: "none" }
        : auth.kind === "bearer"
        ? { kind: "bearer", secret_ref: secretRef(auth.credential.secret) }
        : auth.kind === "api_key"
        ? {
          kind: "api_key",
          secret_ref: secretRef(auth.credential.secret),
          header_name: auth.header_name,
        }
        : {
          kind: "oauth2",
          issuer: auth.issuer,
          client_id: auth.client_id,
          client_secret_ref: auth.client_credential === null
            ? null
            : secretRef(auth.client_credential.secret),
          scopes: [...auth.scopes],
          token_ref: tokenRef,
        },
    },
  };
}

// 전역 설정(`lophn-agent.extensions.mcp_servers`)의 값이다. 값의 모양이 층의 서버와 달라 같은 모양으로 옮긴다.
export function runtimeServerOfSetting(
  config: McpServerConfig,
): McpRuntimeServer {
  const common = {
    name: config.name,
    enabled: config.enabled,
    call_timeout_ms: config.call_timeout_ms,
    fingerprint: canonicalize([null, config]),
  };
  if (config.transport === "stdio") {
    return {
      ...common,
      transport: "stdio",
      stdio: {
        executable: config.stdio.executable,
        args: [...config.stdio.args],
        cwd: config.stdio.cwd,
        env: { ...config.stdio.env },
      },
    };
  }
  const auth = config.http.auth;
  return {
    ...common,
    transport: "http",
    http: {
      url: config.http.url,
      headers: { ...config.http.headers },
      auth: auth.kind === "none"
        ? { kind: "none" }
        : auth.kind === "bearer"
        ? { kind: "bearer", secret_ref: auth.secret_ref }
        : auth.kind === "api_key"
        ? {
          kind: "api_key",
          secret_ref: auth.secret_ref,
          header_name: auth.header_name,
        }
        : {
          kind: "oauth2",
          issuer: auth.issuer,
          client_id: auth.client_id,
          client_secret_ref: auth.client_secret_ref,
          scopes: [...auth.scopes],
          token_ref: mcpTokenRef({ place: null, name: config.name }),
        },
    },
  };
}

export type McpLayer = {
  servers: readonly McpRuntimeServer[];
  // 이 층이 끈 아래 층의 서버 이름이다. 지금 없는 이름은 아무 일도 하지 않는다.
  off: readonly string[];
};

// 층 순서(전역, project, agent)로 서버를 합친다. 같은 이름은 마지막 층이 덮고 이름이 다르면 모두 쓴다.
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
