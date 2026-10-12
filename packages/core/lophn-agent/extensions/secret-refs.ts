import { err, ok, type Result } from "../../../base/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type {
  SecretDestination,
  SecretRefSource,
  SecretUse,
} from "../../../protocol/secrets/mod.ts";

// 외부 MCP credential의 secret 참조다. MCP server 설정이
// 가리키는 `sec:` 참조를 ledger의 secrets 표에서 읽어 core의 알려진 값
// registry에 등록하는 통로다. 설정은 setting_choices 행(platform/settings)에
// 있고 참조는 secrets 표에 있다. 값은 표에 없다(platform/secrets).

import { mcpServersSetting } from "../../../protocol/lophn-agent/mod.ts";

export const MCP_SECRET_OWNER = "lophn-agent/extensions";

// 설정 JSON에서 모든 secret ref를 모은다(stdio env 값·http headers·auth).
function secretRefsOf(value: unknown): string[] {
  const refs: string[] = [];
  if (value === null || typeof value !== "object") return refs;
  if (Array.isArray(value)) {
    for (const item of value) refs.push(...secretRefsOf(item));
    return refs;
  }
  const record = value as Record<string, unknown>;
  // plain-or-secret 값이다(contracts mcp-settings). auth bearer·api_key의
  // secret_ref도 같은 이름이다.
  if (typeof record["secret_ref"] === "string") {
    refs.push(record["secret_ref"]);
  }
  if (
    record["auth"] !== undefined && typeof record["auth"] === "object" &&
    record["auth"] !== null
  ) {
    // oauth2의 client_secret_ref다. token_ref는 secrets 표가 아니라 OAuth token 보관(mcp-oauth-vault)을 가리킨다.
    for (const field of ["client_secret_ref"]) {
      const ref = (record["auth"] as Record<string, unknown>)[field];
      if (typeof ref === "string") refs.push(ref);
    }
  }
  for (const child of Object.values(record)) {
    refs.push(...secretRefsOf(child));
  }
  return refs;
}

// `sec:` 참조를 secrets 표의 이름으로 바꾼다. 참조는 `sec:<name>`이다.
function nameOf(ref: string): string | null {
  if (!ref.startsWith("sec:")) return null;
  const name = ref.slice(4);
  return name.length > 0 ? name : null;
}

// MCP server 설정이 가리키는 secret 참조를 읽는다.
// provider credential과 같은 모양이다(contracts/platform/secrets SecretRefSource).
// extra는 OAuth token 보관(mcp-oauth-vault)이 가진 참조다. 그 참조는 ledger 표가 아니라 keychain의 고정 meta가
// 가리키므로 보관이 읽거나 저장한 것만 나온다. 값은 어디에도 없다.
export function createMcpSecretRefSource(
  extra: () => readonly { name: string; sealedRef: string }[] = () => [],
): SecretRefSource {
  return {
    owner: MCP_SECRET_OWNER,
    // 설정이 바뀌는 계기다(ApplySettings가 setting_choices를 쓴다). SetSecret·
    // RemoveSecret은 core가 기본으로 다시 맞춘다(secret-store SECRET_COMMANDS).
    commands: ["ApplySettings"],
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
    const rows = sql.all(
      "select layer, key, value from setting_choices where key = ?",
      [mcpServersSetting.key],
    );
    if (rows.length === 0) return ok([]);
    const parsed: unknown = JSON.parse(String(rows[0]["value"]));
    const names = new Set<string>();
    for (const ref of secretRefsOf(parsed)) {
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
  let setting: unknown;
  let secretRows: Record<string, unknown>[];
  try {
    const rows = sql.all(
      "select layer, key, value from setting_choices where key = ?",
      [mcpServersSetting.key],
    );
    if (rows.length === 0) return err(forbidden);
    setting = JSON.parse(String(rows[0]["value"]));
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
  const servers = mcpServersSetting.value_type.safeParse(setting);
  if (!servers.success) return err(forbidden);
  const allowed = servers.data.some((server) =>
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

// 요청 헤더로 server에 가는 참조다(headers의 secret_ref, bearer·api_key). oauth2의
// client secret은 server로 가지 않는다.
function sentRefsOf(http: {
  headers: Record<string, { kind: string; secret_ref?: string }>;
  auth: { kind: string; secret_ref?: string };
}): string[] {
  const refs: string[] = [];
  for (const value of Object.values(http.headers)) {
    if (value.kind === "secret_ref" && value.secret_ref !== undefined) {
      refs.push(value.secret_ref);
    }
  }
  if (
    (http.auth.kind === "bearer" || http.auth.kind === "api_key") &&
    http.auth.secret_ref !== undefined
  ) {
    refs.push(http.auth.secret_ref);
  }
  return refs;
}
