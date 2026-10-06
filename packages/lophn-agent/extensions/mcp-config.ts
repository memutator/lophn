import { err, ok, type Result } from "../../base/mod.ts";
import type { McpServerConfig } from "../../contracts/lophn-agent/mod.ts";

// 바깥 MCP 연결 설정 검사(concern lophn-agent/extensions, requirements
// lophn-agent/extensions#R12, R15). 계약 schema(mcpServerConfigSchema)가 이미
// 전송 방식·값 모양을 거르고, 이 모듈은 그 밖의 누락·상충을 서버별로 본다.
// 잘못된 서버 하나만 연결하지 않고 고칠 항목을 알리며 다른 서버와 lophn 자체
// 도구는 그대로다(R12). TLS 검증을 끄는 설정은 없다(R15).

// 사람에게 알릴 서버별 고칠 항목이다(R12). 서버 이름과 원문 값 외의 자유
// 원문은 담지 않는다.
export type McpConfigProblem = {
  server: string;
  reason: string;
};

export type McpConfigCheck = {
  // 연결 대상 서버다. 문제가 있는 서버는 빠진다(R12: 그 서버만 연결 안 함).
  valid: readonly McpServerConfig[];
  problems: readonly McpConfigProblem[];
};

// HTTP 목적지를 본다(R15). HTTPS가 기본이고 평문 HTTP는 loopback뿐이다.
// redirect·TLS는 연결할 때 adapter가 본다.
export function httpEndpointReason(
  url: unknown,
): string | null {
  if (typeof url !== "string" || url.length === 0) {
    return "http url이 없다";
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "http url이 URL이 아니다";
  }
  if (parsed.protocol === "https:") return null;
  if (parsed.protocol !== "http:") {
    return "http url의 전송이 http·https가 아니다";
  }
  const host = parsed.hostname;
  if (host === "127.0.0.1" || host === "::1" || host === "localhost") {
    return null;
  }
  return "평문 http는 loopback 주소에만 허용한다. https url로 고친다";
}

// stdio 실행 파일 검사다(R12). 절대 경로는 계약 schema가 이미 본다.
function stdioReason(server: McpServerConfig): string | null {
  if (server.transport !== "stdio") return null;
  const stdio = server.stdio;
  if (typeof stdio.executable !== "string" || stdio.executable.length === 0) {
    return "stdio executable이 없다";
  }
  if (
    !stdio.executable.startsWith("/") && !/^[A-Za-z]:\\/.test(stdio.executable)
  ) {
    return "stdio executable은 절대 경로다";
  }
  return null;
}

// HTTP 서버 검사다(R12, R15).
function httpReason(server: McpServerConfig): string | null {
  if (server.transport !== "http") return null;
  const endpoint = httpEndpointReason(server.http.url);
  if (endpoint !== null) return endpoint;
  // 인증 방식은 계약이 이미 골랐다(mcpAuthSchema). 여기서는 auth 헤더와 추가
  // 헤더의 이름 상충만 본다(R12).
  if (server.http.auth.kind === "api_key") {
    const name = server.http.auth.header_name.toLowerCase();
    if (server.http.headers[name.toLowerCase()] !== undefined) {
      return `http headers에 auth와 같은 이름의 헤더가 있다: ${server.http.auth.header_name}`;
    }
  }
  return null;
}

// 서버 한 대의 누락·상충을 본다(R12). 계약 schema를 지난 값이다.
export function serverConfigReason(server: McpServerConfig): string | null {
  const nameProblem = typeof server.name !== "string" ||
      server.name.length === 0
    ? "server name이 없다"
    : null;
  if (nameProblem !== null) return nameProblem;
  return stdioReason(server) ?? httpReason(server);
}

// 서버 목록 전체를 검사한다(R12). 문제 서버는 valid에서 빠지고 문제 사유를
// problems로 알린다. 정상 서버는 그대로다.
export function checkMcpConfig(
  servers: readonly McpServerConfig[],
): Result<McpConfigCheck> {
  if (!Array.isArray(servers)) {
    return err({
      code: "invalid_input",
      message: "server 목록이 배열이 아니다",
    });
  }
  const seen = new Set<string>();
  const valid: McpServerConfig[] = [];
  const problems: McpConfigProblem[] = [];
  for (const server of servers) {
    const reason = serverConfigReason(server);
    if (reason !== null) {
      problems.push({
        server: typeof server.name === "string" && server.name.length > 0
          ? server.name
          : "(이름 없음)",
        reason,
      });
      continue;
    }
    // 같은 이름이 둘이면 뒤 것을 상충으로 본다(R12). 등록 자체가 unique를
    // 보장하므로(계약) 방어적 확인이다.
    if (seen.has(server.name)) {
      problems.push({
        server: server.name,
        reason: "같은 이름의 server 설정이 둘이다",
      });
      continue;
    }
    seen.add(server.name);
    valid.push(server);
  }
  return ok({ valid, problems });
}

// `--allow-run` 목록이다(architecture §2.3). 사람이 enabled로 등록한 MCP stdio
// executable만 둔다. shell 해석·model이 고른 프로그램은 없다.
export function allowRunList(
  servers: readonly McpServerConfig[],
): string[] {
  const names = new Set<string>();
  for (const server of servers) {
    if (!server.enabled) continue;
    if (server.transport !== "stdio") continue;
    if (
      !server.stdio.executable.startsWith("/") &&
      !/^[A-Za-z]:\\/.test(server.stdio.executable)
    ) {
      continue;
    }
    names.add(server.stdio.executable);
  }
  return [...names].sort();
}
