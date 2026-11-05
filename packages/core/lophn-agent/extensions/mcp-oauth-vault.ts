import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  AgentId,
  AgentWorkspace,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  type SecretDestination,
  secretDestinationOf,
} from "../../../protocol/secrets/mod.ts";

// MCP OAuth token 보관. `secrets.json`에 서버(소유자+이름)마다 세 이름을 둔다: `mcp-oauth.<scope>.<server>.access`,
// `.refresh`, `.meta`. scope는 agent 정의 층 서버면 그 agent id, 전역 서버면 `global`, 아니면 workspace id다. 같은
// 이름의 서버도 소유자가 다르면 따로다.
// - 접근 token과 갱신 token은 각자 이름이다. 알려진 값 registry가 값 전체로 맞추므로 JSON 하나로 합치면 token 하나를
//   redaction할 수 없다.
// - meta(만료, token endpoint, binding)는 비밀이 아니지만 저장소를 하나로 두려고 같은 파일에 JSON으로 둔다. binding
//   (발급자·서버 URL·client)이 지금 설정과 다르면 옛 token을 쓰지 않는다.
// - secret store의 put이 값을 알려진 값으로 먼저 올리고 지움이 회수한다. 여기서 따로 맞출 것이 없다.

// 한 서버의 식별이다. 전역 서버는 workspace와 agent가 모두 null이고, project·app 서버는 workspace만, agent
// 정의 층 서버는 agent만 있다.
export type McpAuthKey = {
  workspace: AgentWorkspace | null;
  agent: AgentId | null;
  name: string;
};

function scopeOf(key: McpAuthKey): string {
  if (key.agent !== null) return key.agent;
  return key.workspace === null ? "global" : key.workspace.id;
}

// 서버 하나를 가리키는 문자열이다(작업 메모리의 열쇠). 소유자가 다르면 같은 이름도 다르다.
export function mcpAuthKeyId(key: McpAuthKey): string {
  return `${scopeOf(key)}\0${key.name}`;
}

export type McpTokenNames = { access: string; refresh: string; meta: string };

// 서버 하나의 token 이름이다. 서버 이름과 소유자에서 정해진다: 설정 schema는 `mcp-oauth.` 이름을 받지 않으므로
// 설정이 다른 서버의 token을 가리킬 수 없다.
export function mcpTokenNames(key: McpAuthKey): McpTokenNames {
  const base = `mcp-oauth.${scopeOf(key)}.${key.name}`;
  return {
    access: `${base}.access`,
    refresh: `${base}.refresh`,
    meta: `${base}.meta`,
  };
}

// token이 묶인 조합이다. 이 중 하나라도 지금 설정과 다르면 token은 쓰지 않는다. MCP는 `{ issuer, server_url,
// client_id }`를 쓰고, 앱 OAuth는 자기 조합을 넣는다.
type McpGrantBinding = Record<string, string>;

export type McpGrant = {
  access_token: string;
  refresh_token: string | null;
  // 접근 token의 만료 시각(ms)이다. 발급자가 알리지 않았으면 null이다.
  expires_at_ms: number | null;
  // 갱신이 부를 token endpoint다.
  token_endpoint: string;
  binding: McpGrantBinding;
};

// secret store에서 vault가 쓰는 만큼이다. 없는 이름의 get은 not_found다.
export type McpVaultSecrets = {
  get(name: string): Result<string>;
  put(name: string, value: string): Promise<Result<unknown>>;
  delete(name: string): Promise<Result<unknown>>;
};

export type McpOAuthVault = {
  // 지금 벌을 읽는다. 보관한 것이 없으면 ok(null)이다. 저장소를 읽을 수 없으면 unavailable이다: 비어 있는 것으로
  // 꾸미지 않는다.
  load(key: McpAuthKey): Promise<Result<McpGrant | null>>;
  // 새 벌로 바꾼다. 접근 token, 갱신 token, meta 순서로 쓴다.
  save(key: McpAuthKey, grant: McpGrant): Promise<Result<void>>;
  // 벌을 지운다. 없어도 오류가 아니다.
  remove(key: McpAuthKey): Promise<Result<void>>;
};

type Meta = Pick<McpGrant, "expires_at_ms" | "token_endpoint" | "binding">;

function unavailable(): Result<never> {
  return err({
    code: "unavailable",
    message: "MCP OAuth token 보관을 쓸 수 없다",
  });
}

function metaOf(text: string): Meta | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const binding = record["binding"] as Record<string, unknown> | undefined;
  if (
    (record["expires_at_ms"] !== null &&
      typeof record["expires_at_ms"] !== "number") ||
    typeof record["token_endpoint"] !== "string" ||
    binding === undefined ||
    binding === null ||
    typeof binding !== "object" ||
    !Object.values(binding).every((v) => typeof v === "string")
  )
    return null;
  return {
    expires_at_ms: record["expires_at_ms"] as number | null,
    token_endpoint: record["token_endpoint"],
    binding: binding as Record<string, string>,
  };
}

// `mcp-oauth.` 이름의 값이 갈 수 있는 목적지: 접근 token만, 그 서버의 meta가 묶인 서버 URL origin으로 간다. 갱신
// token과 meta는 core 밖으로 보내지 않는다.
export function mcpOAuthSecretDestinations(
  secrets: Pick<McpVaultSecrets, "get">,
  name: string,
): SecretDestination[] {
  const suffix = ".access";
  if (!name.startsWith("mcp-oauth.") || !name.endsWith(suffix)) return [];
  const meta = secrets.get(`${name.slice(0, -suffix.length)}.meta`);
  if (!meta.ok) return [];
  const parsed = metaOf(meta.value);
  const serverUrl = parsed?.binding["server_url"];
  const destination =
    serverUrl === undefined ? undefined : secretDestinationOf(serverUrl);
  return destination === undefined ? [] : [destination];
}

export function createMcpOAuthVault(options: {
  secrets: McpVaultSecrets;
  // 보관 이름이다. 기본은 MCP 서버의 이름이다.
  names?: (key: McpAuthKey) => McpTokenNames;
}): McpOAuthVault {
  const { secrets } = options;
  const namesOf = options.names ?? mcpTokenNames;
  const queues = new Map<string, Promise<unknown>>();

  // 같은 서버의 보관 작업은 차례로 한다: 저장과 지움이 겹쳐 반쯤 지워진 벌을 읽지 않는다.
  function serial<T>(key: McpAuthKey, run: () => Promise<T>): Promise<T> {
    const id = mcpAuthKeyId(key);
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.then(run, run);
    const tail = next.catch(() => undefined);
    queues.set(id, tail);
    void tail.then(() => {
      if (queues.get(id) === tail) queues.delete(id);
    });
    return next;
  }

  function read(name: string): Result<string | null> {
    const got = secrets.get(name);
    if (got.ok) return got;
    return got.error.code === "not_found" ? ok(null) : unavailable();
  }

  function loadNow(key: McpAuthKey): Result<McpGrant | null> {
    const names = namesOf(key);
    const meta = read(names.meta);
    if (!meta.ok) return meta;
    const access = read(names.access);
    if (!access.ok) return access;
    const refresh = read(names.refresh);
    if (!refresh.ok) return refresh;
    const parsed = meta.value === null ? null : metaOf(meta.value);
    // meta나 접근 token이 없는 벌은 쓸 수 없다. 없는 것과 같다.
    if (parsed === null || access.value === null) return ok(null);
    return ok({
      ...parsed,
      access_token: access.value,
      refresh_token: refresh.value,
    });
  }

  return {
    load(key) {
      return serial(key, () => Promise.resolve(loadNow(key)));
    },

    save(key, grant) {
      return serial(key, async () => {
        const names = namesOf(key);
        const meta: Meta = {
          expires_at_ms: grant.expires_at_ms,
          token_endpoint: grant.token_endpoint,
          binding: grant.binding,
        };
        const steps = [
          () => secrets.put(names.access, grant.access_token),
          () =>
            grant.refresh_token === null
              ? secrets.delete(names.refresh)
              : secrets.put(names.refresh, grant.refresh_token),
          () => secrets.put(names.meta, JSON.stringify(meta)),
        ];
        for (const step of steps) {
          if (!(await step()).ok) return unavailable();
        }
        return ok(undefined);
      });
    },

    remove(key) {
      return serial(key, async () => {
        const names = namesOf(key);
        let failed = false;
        for (const name of [names.access, names.refresh, names.meta]) {
          if (!(await secrets.delete(name)).ok) failed = true;
        }
        return failed ? unavailable() : ok(undefined);
      });
    },
  };
}
