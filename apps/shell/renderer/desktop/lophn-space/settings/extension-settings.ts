// 확장 설정(skill 폴더·MCP server 목록)을 settings route로 읽고 바꾸는 부분. 일반 설정 통로
// (core-source.ts)와 Agents 통로(agents/core-source.ts)가 같이 쓴다. 모양은 contract
// (`lophn-agent.extensions.skill_folders`·`lophn-agent.extensions.mcp_servers` 설정 정의)에서
// 이 화면이 읽는 field만 옮긴 것이다. credential 값은 어디에도 없고 보관 이름과 저장 여부만 있다.
import type { CoreSource } from "../../connection/connection.ts";
import { call, command } from "./core-call.ts";
import type { ApplyAt, ServerAuth, SourceResult } from "./source.ts";

export const SKILL_FOLDERS = "lophn-agent.extensions.skill_folders";
export const MCP_SERVERS = "lophn-agent.extensions.mcp_servers";

export interface EffectiveValue {
  key: string;
  resolved: boolean;
  value: unknown;
  source_layer: "builtin" | "common" | null;
  apply_at: ApplyAt;
}

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
      token_ref?: string | null;
      client_id?: string;
      scopes?: string[];
    };
  };
}

/** 설정을 바꿀 때의 비교 기준. 읽은 때의 값이다. */
export interface SettingsCompare {
  readonly revision: number;
  readonly defaultsRevision: string;
}

export interface ExtensionSettings extends SettingsCompare {
  readonly folders: readonly string[];
  readonly servers: readonly McpServerValue[];
}

/** 설정 한 줄의 값을 바꾼다(common 층). 비교 기준이 달라졌으면 conflict다. */
export async function applySetting(
  core: CoreSource,
  compare: SettingsCompare,
  key: string,
  value: unknown,
  random: () => string,
): Promise<SourceResult<null>> {
  const result = await command(core, "settings", "apply", {
    input: { changes: [{ layer: "common", key, action: "set", value }] },
    compare: {
      revision: compare.revision,
      defaults_revision: compare.defaultsRevision,
    },
    key: `settings-${key}-${random()}`,
  });
  return result.ok ? { ok: true, value: null } : result;
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

/** 로그인 방식(OAuth)이 저장한 token의 보관 이름. 아직 로그인하지 않았으면 null이다. */
export function tokenOf(server: McpServerValue): string | null {
  return nameOf(server.http?.auth.token_ref);
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

/** 확장 설정 두 줄과 비교 기준을 `settings/get` 한 번으로 읽는다. */
export async function readExtensionSettings(
  core: CoreSource,
): Promise<SourceResult<ExtensionSettings>> {
  const got = await call<{
    settings: EffectiveValue[];
    revision: number;
    defaults_revision: string;
  }>(core, "read", "settings", "get", {});
  if (!got.ok) return got;
  const effective = new Map(got.value.settings.map((s) => [s.key, s]));
  const folders = effective.get(SKILL_FOLDERS)?.value;
  const servers = effective.get(MCP_SERVERS)?.value;
  return {
    ok: true,
    value: {
      revision: got.value.revision,
      defaultsRevision: got.value.defaults_revision,
      folders: Array.isArray(folders) ? folders as string[] : [],
      servers: Array.isArray(servers) ? servers as McpServerValue[] : [],
    },
  };
}
