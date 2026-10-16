// 확장 설정(skill 폴더·MCP server 목록)을 settings route로 읽고 바꾸는 부분. 일반 설정 통로
// (core-source.ts)와 Agents 통로(agents/core-source.ts)가 같이 쓴다. 모양은 contract
// (`lophn-agent.extensions.skill_folders`·`lophn-agent.extensions.mcp_servers` 설정 정의)에서
// 이 화면이 읽는 field만 옮긴 것이다. credential 값은 어디에도 없고 보관 이름과 저장 여부만 있다.
import type { CoreSource } from "../../connection/connection.ts";
import { call } from "./core-call.ts";
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
  transport: "stdio" | "http";
  stdio?: { executable: string };
  http?: {
    url: string;
    auth: {
      kind: ServerAuth;
      secret_ref?: string;
      client_id?: string;
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

function nameOf(ref: string | null | undefined): string | null {
  return ref !== undefined && ref !== null && ref.startsWith("sec:")
    ? ref.slice(4)
    : null;
}

/** 값을 넣을 credential 보관 이름(bearer·API key). 설정의 참조(`sec:<이름>`)에서 이름만 뗀다. */
export function secretOf(server: McpServerValue): string | null {
  return nameOf(server.http?.auth.secret_ref);
}

/** core가 읽어 준 로그인 상태 하나. 이름으로 찾는다. */
export interface AuthStateValue {
  readonly state: Exclude<ServerSignInState, "unknown">;
  readonly reason: ServerSignInReason | null;
}

/** 로그인이 필요한 방식(OAuth)으로 켜져 있는 server. 로그인 상태를 묻는 대상이다. */
export function signsIn(server: McpServerValue): boolean {
  return server.enabled && server.http?.auth.kind === "oauth2";
}

/**
 * 켜진 OAuth server의 로그인 상태를 이름과 자리(이 목록은 전역 server뿐이라 null)로 한 번에 묻는다. 끝난
 * 세션의 기억이 아니라 core가 지금 쥔 상태(진행 중·보관한 token이 설정과 맞는지·마지막 실패)다. OAuth server가
 * 없으면 묻지 않고, 읽지 못하면 null이다. token 값도 token 이름도 묻지 않는다.
 */
export async function authStates(
  core: CoreSource,
  servers: readonly McpServerValue[],
): Promise<Map<string, AuthStateValue> | null> {
  const asked = servers.filter(signsIn);
  if (asked.length === 0) return new Map();
  const read = await call<{
    servers: {
      name: string;
      state: AuthStateValue["state"];
      reason: ServerSignInReason | null;
    }[];
  }>(core, "memory", "agent-mcp-auth", "state", {
    servers: asked.map((server) => ({ name: server.name, place: null })),
  });
  if (!read.ok) return null;
  return new Map(
    read.value.servers.map((
      entry,
    ) => [entry.name, { state: entry.state, reason: entry.reason }]),
  );
}

/** 이름별 credential 저장 여부. 읽지 못하면 null이다. 값은 읽지 않는다. */
export async function secretStates(
  core: CoreSource,
  names: readonly string[],
): Promise<Map<string, "set" | "missing"> | null> {
  if (names.length === 0) return new Map();
  const read = await call<{
    secrets: { name: string; configured: boolean }[];
  }>(core, "read", "secrets", "list", { names });
  if (!read.ok) return null;
  return new Map(
    read.value.secrets.map((
      status,
    ) => [status.name, status.configured ? "set" : "missing"]),
  );
}

/** 확장 설정 두 줄을 `settings/list` 한 번으로 읽는다. */
export async function readExtensionSettings(
  core: CoreSource,
): Promise<SourceResult<ExtensionSettings>> {
  const got = await readEffective(core, [SKILL_FOLDERS, MCP_SERVERS]);
  if (!got.ok) return got;
  const folders = got.value.get(SKILL_FOLDERS);
  const servers = got.value.get(MCP_SERVERS);
  return {
    ok: true,
    value: {
      folders: Array.isArray(folders) ? folders as string[] : [],
      servers: Array.isArray(servers) ? servers as McpServerValue[] : [],
    },
  };
}
