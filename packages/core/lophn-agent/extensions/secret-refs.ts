import { err, ok, type Result } from "../../../base/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type {
  SecretDestination,
  SecretRefSource,
  SecretUse,
} from "../../../protocol/secrets/mod.ts";

// 외부 MCP credential의 secret 참조다. MCP server 설정이
// 가리키는 `sec:` 참조를 ledger의 secrets 표에서 읽어 core의 알려진 값
// registry에 등록하는 통로다. 설정은 설정 파일(platform/config)에
// 있고 참조는 secrets 표에 있다. 값은 표에 없다(platform/secrets).

import type { McpServer } from "../../../protocol/lophn-agent/mod.ts";
import { createFileSettingsReader } from "../../config/mod.ts";
import { globalMcpServersSetting } from "./settings.ts";

const MCP_SECRET_OWNER = "lophn-agent/extensions";

// 전역 서버 설정에서 모든 secret 참조를 모은다(stdio env 값, http headers, auth). 참조는 `sec:<이름>`이다.
// oauth2의 token은 secrets 표가 아니라 OAuth token 보관(mcp-oauth-vault)을 가리키므로 여기 없다.
function secretRefsOf(servers: readonly McpServer[]): string[] {
  const names: string[] = [];
  const value = (one: { value: string } | { secret: string }) => {
    if ("secret" in one) names.push(one.secret);
  };
  for (const server of servers) {
    if (server.transport === "stdio") {
      Object.values(server.stdio.env).forEach(value);
      continue;
    }
    Object.values(server.http.headers).forEach(value);
    const auth = server.http.auth;
    if (auth.kind === "bearer" || auth.kind === "api_key") {
      names.push(auth.credential.secret);
    } else if (auth.kind === "oauth2" && auth.client_credential !== null) {
      names.push(auth.client_credential.secret);
    }
  }
  return names.map((name) => `sec:${name}`);
}

// ledger 파일이 있는 폴더가 data root다.
function rootOf(sql: Pick<Sql, "all">): Result<string> {
  const file = sql.all(
    "select file from pragma_database_list where name = 'main'",
    [],
  )[0]?.["file"];
  if (typeof file !== "string" || !file.includes("/")) {
    return err({ code: "unavailable", message: "ledger location is unknown" });
  }
  return ok(file.slice(0, file.lastIndexOf("/")));
}

// `sec:` 참조를 secrets 표의 이름으로 바꾼다. 참조는 `sec:<name>`이다.
function nameOf(ref: string): string | null {
  if (!ref.startsWith("sec:")) return null;
  const name = ref.slice(4);
  return name.length > 0 ? name : null;
}

// MCP server 설정이 가리키는 secret 참조를 읽는다.
// extra는 OAuth token 보관(mcp-oauth-vault)이 가진 참조다. 그 참조는 ledger 표가 아니라 keychain의 고정 meta가
// 가리키므로 보관이 읽거나 저장한 것만 나온다. 값은 어디에도 없다.
export function createMcpSecretRefSource(
  extra: () => readonly { name: string; sealedRef: string }[] = () => [],
): SecretRefSource {
  return {
    owner: MCP_SECRET_OWNER,
    // SetSecret·RemoveSecret은 core가 기본으로 다시 맞춘다(secret-store SECRET_COMMANDS).
    commands: [],
    read(sql: Pick<Sql, "all">): Result<{ name: string; sealedRef: string }[]> {
      const configured = configuredRefs(sql);
      if (!configured.ok) return configured;
      return ok([...configured.value, ...extra()]);
    },
  };
}

function configuredRefs(
  sql: Pick<Sql, "all">,
): Result<{ name: string; sealedRef: string }[]> {
  try {
    const root = rootOf(sql);
    if (!root.ok) return root;
    const servers = createFileSettingsReader(root.value).get(
      globalMcpServersSetting,
    ) ?? [];
    const names = new Set<string>();
    for (const ref of secretRefsOf(servers)) {
      const name = nameOf(ref);
      if (name === null) continue;
      names.add(name);
    }
    if (names.size === 0) return ok([]);
    // 참조가 있는 이름만 secrets 표에서 읽는다. 없는 이름은 설정이 참조를
    // 가리키지 않은 것이므로 건너뛴다.
    const placeholders = [...names].map(() => "?").join(", ");
    const secretRows = sql.all(
      `select name, sealed_ref from secrets where name in (${placeholders}) order by name`,
      [...names],
    );
    return ok(secretRows.map((row) => ({
      name: String(row["name"]),
      sealedRef: String(row["sealed_ref"]),
    })));
  } catch {
    return err({
      code: "unavailable",
      message: "MCP credential 참조를 읽지 못했다",
    });
  }
}

// runtime가 MCP HTTP 요청에 붙일 인증 비밀의 전송 부착 대조다.
// 설정은 `sec:<이름>`만 갖고 sealed_ref는 core 밖으로 나가지 않으므로 runtime은 그 이름을
// `use.sealed_ref`에 담아 청한다. 이 함수가 현재 설정과 secrets 표로 정확한 참조·판을 채운다.
// 그 이름을 참조하는 켜진 HTTP server가 있고 그 server URL의 origin이 청한 목적지와 같을 때만
// 허용한다(다른 목적지 forbidden). 값은 보지 않는다.
export function lookupMcpSecretUse(
  sql: Pick<Sql, "all">,
  use: SecretUse,
): Result<{
  name: string;
  sealedRef: string;
  revision: number;
  purpose: SecretUse["purpose"];
  destination: SecretDestination;
}> {
  const forbidden = {
    code: "forbidden" as const,
    message: "secret 전송을 허용하지 않는다",
  };
  const name = nameOf(use.sealed_ref);
  if (name === null || use.purpose !== "external_mcp_credential") {
    return err(forbidden);
  }
  let servers: readonly McpServer[];
  let secretRows: Record<string, unknown>[];
  try {
    const root = rootOf(sql);
    if (!root.ok) return root;
    servers = createFileSettingsReader(root.value).get(
      globalMcpServersSetting,
    ) ?? [];
    secretRows = sql.all(
      "select name, sealed_ref, revision from secrets where name = ?",
      [name],
    );
  } catch {
    return err({
      code: "unavailable",
      message: "MCP credential 참조를 읽지 못했다",
    });
  }
  const allowed = servers.some((server) =>
    server.enabled && server.transport === "http" &&
    sentRefsOf(server.http).includes(use.sealed_ref) &&
    sameOrigin(server.http.url, use.destination)
  );
  if (!allowed) return err(forbidden);
  const row = secretRows[0];
  if (row === undefined) {
    return err({ code: "conflict", message: "현재 참조와 판이 다르다" });
  }
  return ok({
    name,
    sealedRef: String(row["sealed_ref"]),
    revision: Number(row["revision"]),
    purpose: "external_mcp_credential",
    destination: use.destination,
  });
}

function sameOrigin(url: string, destination: SecretDestination): boolean {
  if (destination.kind !== "https" && destination.kind !== "loopback_http") {
    return false;
  }
  try {
    const parsed = new URL(url);
    const kind = parsed.protocol === "https:" ? "https" : "loopback_http";
    return kind === destination.kind && parsed.origin === destination.origin;
  } catch {
    return false;
  }
}

// 요청 헤더로 server에 가는 참조다(headers의 secret, bearer·api_key). oauth2의
// client secret은 server로 가지 않는다.
function sentRefsOf(
  http: Extract<McpServer, { transport: "http" }>["http"],
): string[] {
  const refs: string[] = [];
  for (const value of Object.values(http.headers)) {
    if ("secret" in value) refs.push(`sec:${value.secret}`);
  }
  if (http.auth.kind === "bearer" || http.auth.kind === "api_key") {
    refs.push(`sec:${http.auth.credential.secret}`);
  }
  return refs;
}
