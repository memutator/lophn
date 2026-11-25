// 확장 설정(skill 폴더·MCP server 목록)과 그 server의 credential·로그인 상태를 푸는 부분. Tools and skills 화면이
// useCoreRead로 읽은 답을 풀고, Agents 통로(agents/core-source.ts)가 쓰기 직전에 다시 읽는다. 모양은 contract
// (`lophn-agent.extensions.skill_folders`·`lophn-agent.extensions.mcp_servers` 설정 정의)에서
// 이 화면이 읽는 field만 옮긴 것이다. credential 값은 어디에도 없고 보관 이름과 저장 여부만 있다.
import type { McpTrust } from "../../../../protocol/lophn-agent/mcp-settings.ts";
import type { CoreSource } from "../connection/connection.ts";
import { chooseSetting, readEffective } from "./declared.ts";
import type {
  ServerAuth,
  ServerSignInReason,
  ServerSignInState,
  SourceResult,
} from "./source.ts";

export const SKILL_FOLDERS = "lophn-agent.extensions.skill_folders";
export const MCP_SERVERS = "lophn-agent.extensions.mcp_servers";

/** 등록한 MCP server 설정 하나. 바꿀 때 그대로 돌려보내므로 모르는 field도 지우지 않는다. */
export interface McpServerValue {
  name: string;
  enabled: boolean;
  trust?: McpTrust;
  transport: "stdio" | "http";
  stdio?: { executable: string };
  http?: {
    url: string;
    headers?: Record<string, { value?: string; secret?: string }>;
    auth: {
      kind: ServerAuth;
      credential?: { secret: string };
      client_id?: string;
      client_credential?: { secret: string } | null;
      scopes?: string[];
    };
  };
}

export interface ExtensionSettings {
  readonly folders: readonly string[];
  readonly servers: readonly McpServerValue[];
}

/**
 * 확장 설정 한 줄의 값을 바꾼다(skill 폴더, MCP server 목록, 끈 skill). 선언한 설정을 쓰는 `settings/update`로
 * 쓰고 틀린 값은 거절 이유(code)로 온다. `_random`은 옛 호출 모양이 남긴 것이고 쓰지 않는다.
 */
export function applySetting(
  core: CoreSource,
  key: string,
  value: unknown,
  _random?: () => string,
): Promise<SourceResult<null>> {
  return chooseSetting(core, key, value);
}

/** 값을 넣을 credential의 `secrets.json` 이름(bearer·API key). 상태 점이 이 값만 본다. */
export function secretOf(server: McpServerValue): string | null {
  return server.http?.auth.credential?.secret ?? null;
}

/** core가 읽어 준 로그인 상태 하나. 이름으로 찾는다. */
export interface AuthStateValue {
  readonly state: Exclude<ServerSignInState, "unknown">;
  readonly reason: ServerSignInReason | null;
}

/** 로그인이 필요한 방식(OAuth)으로 켜져 있는 server. 로그인 상태를 묻는 대상이다. */
function signsIn(server: McpServerValue): boolean {
  return server.enabled && server.http?.auth.kind === "oauth2";
}

/**
 * 켜진 OAuth server의 로그인 상태를 묻는 `agent-mcp-auth/state` 입력. 이 목록은 전역 server뿐이라 자리는 null이다.
 * token 값도 token 이름도 묻지 않는다.
 */
export function authStateInput(servers: readonly McpServerValue[]): {
  servers: { name: string; workspace: null; agent: null }[];
} {
  return {
    servers: servers
      .filter(signsIn)
      .map((server) => ({ name: server.name, workspace: null, agent: null })),
  };
}

/** 로그인 상태 답을 이름으로 찾게 한다. 끝난 세션의 기억이 아니라 core가 지금 쥔 상태다. */
export function authStatesOf(value: {
  servers: readonly {
    name: string;
    state: AuthStateValue["state"];
    reason: ServerSignInReason | null;
  }[];
}): Map<string, AuthStateValue> {
  return new Map(
    value.servers.map((entry) => [
      entry.name,
      { state: entry.state, reason: entry.reason },
    ]),
  );
}

/** `secrets/status`(이름 없이 읽은 것)의 답에서 이름별 credential 저장 여부. 값은 읽지 않는다. */
export function secretStatesOf(
  names: readonly string[],
  value: { secrets: readonly { name: string; configured: boolean }[] },
): Map<string, "set" | "missing"> {
  const set = new Set(
    value.secrets.filter((one) => one.configured).map((one) => one.name),
  );
  return new Map(
    names.map((name) => [name, set.has(name) ? "set" : "missing"]),
  );
}

/** key마다의 지금 값에서 확장 설정 두 줄. */
export function extensionSettingsOf(
  read: ReadonlyMap<string, unknown>,
): ExtensionSettings {
  const folders = read.get(SKILL_FOLDERS);
  const servers = read.get(MCP_SERVERS);
  return {
    folders: Array.isArray(folders) ? (folders as string[]) : [],
    servers: Array.isArray(servers) ? (servers as McpServerValue[]) : [],
  };
}

/** 쓰기 직전에 확장 설정 두 줄을 `settings/list` 한 번으로 다시 읽는다. */
export async function readExtensionSettings(
  core: CoreSource,
): Promise<SourceResult<ExtensionSettings>> {
  const got = await readEffective(core, [SKILL_FOLDERS, MCP_SERVERS]);
  return got.ok ? { ok: true, value: extensionSettingsOf(got.value) } : got;
}
