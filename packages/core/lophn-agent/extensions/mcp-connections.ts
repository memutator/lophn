import { err, ok, type Result } from "../../../base/mod.ts";
import { sha256Hex } from "../../../base/mod.ts";
import type { McpServerConfig } from "../../../protocol/lophn-agent/mod.ts";
import type {
  SecretDestination,
  SecretSendInput,
} from "../../../protocol/platform/mod.ts";
import { authHeaders } from "./mcp-auth.ts";
import type { StdioSpawn, StdioSpawnInput } from "./adapters/mcp-stdio.ts";
import {
  endpointReason,
  type HttpFetch,
  initializeBody,
  redirectOriginRejected,
  rpcResultOf,
} from "./adapters/mcp-http.ts";

// 바깥 MCP 연결 관리(concern lophn-agent/extensions, requirements
// lophn-agent/extensions#R18–R22, R25). 연결은 assignment와 서버 이름의
// 조합마다 하나다(R18). 같은 assignment의 여러 run이 같은 연결을 쓰고 다른
// assignment와는 공유하지 않는다. 시계·대기·process 시작·HTTP는 주입한다.
// 테스트는 가짜 MCP child와 로컬 HTTP server를 끼운다.

// 연결+initialize 합산 기한이다(R19).
export const CONNECT_TIMEOUT_MS = 30_000;
// 전체 tools/list page와 검증의 합산 기한이다(R19).
export const LIST_TIMEOUT_MS = 30_000;
// 재연결 대기이다(R20). 1초·2초·4초, 최대 세 번.
export const RECONNECT_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000];

// 도구 목록 상한이다(질문 Q14). 넘으면 그 서버 목록 전체를 거절한다.
export const LIST_PAGE_MAX = 100;
export const LIST_TOOLS_MAX = 2048;
export const LIST_BYTES_MAX = 10 * 1024 * 1024;
export const SCHEMA_DEPTH_MAX = 32;

export type OwnerKey = readonly [assignment: string, server: string];

// 연결 상태다(domain model McpConnection).
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "failed_temporary"
  | "failed_auth";

// 목록 검증에 실패한 이유다(R22). 사람용 진단이고 server 자유 원문은 없다.
export type ListFailure =
  | "protocol"
  | "repeated_cursor"
  | "duplicate_name"
  | "invalid_definition"
  | "over_page_limit"
  | "over_tool_limit"
  | "over_bytes_limit"
  | "over_depth_limit";

export type McpToolView = {
  server: string;
  // 서버가 알려준 원래 tool 이름이다.
  original: string;
  description: string | null;
  // JSON Schema 객체다.
  schema: Record<string, unknown>;
};

// 검증을 모두 지난 도구 목록이다(R22). tool_list_hash는 목록 내용의 sha256이다.
export type ToolList = {
  tools: readonly McpToolView[];
  hash: string;
  protocol_version: string;
};

export type ConnectionView = {
  owner: OwnerKey;
  server_revision: number;
  state: ConnectionState;
  protocol_version: string | null;
  tool_list_hash: string | null;
  retry_count: 0 | 1 | 2 | 3;
  error: string | null;
};

// JSON-RPC over transport 눈이다. stdio·HTTP가 같은 모양을 낸다.
export type McpTransport = {
  // 요청 하나를 보내고 응답을 기다린다. 이미 전달한 요청은 재전송하지 않는다(R20).
  request(
    method: string,
    params: unknown,
    signal: AbortSignal,
  ): Promise<Result<Record<string, unknown>>>;
  // 알림을 보낸다(notifications/cancelled 등). 응답은 없다.
  notify(method: string, params: unknown): Promise<void>;
  // 서버가 보낸 역방향 요청이다. 없으면 null을 기다린다.
  reverseRequests(): ReadableStream<{ id: unknown; method: string }>;
  close(): Promise<void>;
};

// process·HTTP를 여는 눈이다. runtime이 실제 연결을, 테스트가 가짜를 끼운다.
export type McpTransportOpener = (
  server: McpServerConfig,
  signal: AbortSignal,
) => Promise<Result<McpTransport>>;

// 대기다. 신호가 중단되면 "aborted"로 일찍 돌아온다.
export type WaitFn = (
  ms: number,
  signal: AbortSignal,
) => Promise<"elapsed" | "aborted">;

// 기한 timer다. progress로 늘지 않는 단조 시계 기한이다(R19).
export type DeadlineFn = (
  ms: number,
  signal: AbortSignal,
) => Promise<"elapsed" | "aborted">;

// secret 전송 부착 port다(platform/secrets#R5, extensions#R17). 값은 transmit callback의
// 인자로만 오고 결과에는 전송 여부뿐이다. provider 전송 부착과 같은 모양이다.
export type McpSecretAttach = {
  send(
    input: SecretSendInput,
    transmit: (
      value: Uint8Array | string,
    ) => Promise<Result<{ sent: boolean }>>,
  ): Promise<Result<{ sent: boolean }>>;
};

export type McpConnectionsDeps = {
  nowMs(): number;
  wait: WaitFn;
  deadline: DeadlineFn;
  // stdio 연결 열기다. 테스트가 가짜 child를 끼운다.
  openStdio(
    server: McpServerConfig,
    input: StdioSpawnInput,
    signal: AbortSignal,
  ): Promise<Result<StdioSpawn>>;
  // HTTP 연결 열기다. 테스트가 로컬 fake server fetch를 끼운다.
  fetch?: HttpFetch;
  // HTTP 인증 비밀(bearer·api_key·secret_ref 헤더)의 전송 부착이다(R17). 값은 요청 하나를
  // 보내는 callback 안에서만 쥐고 연결·log·오류에 남지 않는다. 없으면 인증 비밀이 필요한
  // 서버에 요청을 보내지 않는다.
  secrets?: McpSecretAttach;
  // 서버가 notifications/tools/list_changed를 보냈다(Q16). 조립이 그 server의
  // 도구 목록을 다시 읽을 때까지 새 호출을 막는다. 없으면 알림은 버려진다.
  onListChanged?(server: string): void;
};

export type McpDisconnectReason =
  | "assignment_ended"
  | "server_detached"
  | "daemon_shutdown";

export type CallOutcome =
  | { kind: "success"; result: unknown }
  | { kind: "failure"; code: string; message: string }
  | { kind: "uncertain"; message: string }
  | { kind: "not_executed"; code: string }
  | { kind: "no_connection"; code: string };

export type McpConnections = {
  // (assignment, server) 연결을 얻거나 만든다(R18). 다른 assignment에는
  // 별도 연결이 생긴다.
  acquire(
    assignment: string,
    server: McpServerConfig,
    signal: AbortSignal,
  ): Promise<Result<ConnectionView>>;
  // 이 assignment의 도구 목록이다. 검증을 모두 지난 목록만 온다(R22).
  toolList(
    assignment: string,
    server: string,
  ): Promise<Result<ToolList>>;
  // 도구 호출이다. detach 뒤 새 호출은 not_executed이고 연결이 없으면
  // no_connection이다(R20, R21).
  call(
    assignment: string,
    server: string,
    tool: string,
    args: unknown,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<CallOutcome>;
  // 뜻하지 않은 끊김 다시 연결이다(R20).
  reconnect(
    assignment: string,
    server: string,
  ): Promise<Result<ConnectionView>>;
  // 서버를 떼거나 설정을 회수했다. 새 호출을 막고 진행 호출에 취소를 요청한
  // 뒤 연결을 닫는다(R21).
  detach(assignment: string, server: string): Promise<void>;
  // assignment 사용이 끝났다. 이 assignment의 연결을 모두 닫는다(R18).
  endAssignment(assignment: string): Promise<void>;
  // 데몬 종료다(R18). 모든 연결을 닫는다.
  endAll(): Promise<void>;
  views(): readonly ConnectionView[];
};

type Entry = {
  owner: OwnerKey;
  server: McpServerConfig;
  state: ConnectionState;
  transport: McpTransport | null;
  protocolVersion: string | null;
  toolListHash: string | null;
  retryCount: 0 | 1 | 2 | 3;
  error: string | null;
  // detach 뒤 새 호출을 막는다(R21).
  acceptingCalls: boolean;
  // 이미 전달하고 응답을 기다리는 요청이다(R20). 재전송 하지 않는다.
  pending: Set<number>;
  nextId: number;
};

function keyOf(assignment: string, server: string): string {
  return `${assignment}\0${server}`;
}

// assignment 사용이 끝나면 연결을 닫는다(R18). views는 사람용 진단이다.
type SecretHeader = {
  ref: string;
  headers(token: string): Record<string, string>;
};

// 인증 비밀이 갈 수 있는 고정 목적지다. HTTPS origin이거나 같은 기계의 loopback HTTP origin이다.
function secretDestinationOf(url: string): SecretDestination | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") {
      return { kind: "https", origin: parsed.origin };
    }
    if (parsed.protocol === "http:") {
      return { kind: "loopback_http", origin: parsed.origin };
    }
  } catch {
    return null;
  }
  return null;
}

// 비밀 헤더를 하나씩 전송 부착으로 받아 모두 모이면 send를 부른다. 값은 callback 호출 틀 안에만 있다.
function attachHeaders(
  secrets: McpSecretAttach,
  destination: SecretDestination,
  url: string,
  rest: readonly SecretHeader[],
  collected: Record<string, string>,
  send: (headers: Record<string, string>) => Promise<Result<{ sent: boolean }>>,
): Promise<Result<{ sent: boolean }>> {
  const [head, ...others] = rest;
  if (head === undefined) return send(collected);
  return secrets.send({
    // context는 caller 주장을 믿지 않는다. supervisor가 주입하고 core가 재검사한다.
    context: {} as never,
    // MCP 참조는 이름(`sec:...`)으로 가리키고 판은 core가 현재 판으로 채운다.
    use: {
      sealed_ref: head.ref,
      revision: 1,
      purpose: "external_mcp_credential",
      destination,
    },
    operation: "mcp.request",
    body: { url, method: "POST" },
  }, (value) => {
    const text = typeof value === "string"
      ? value
      : new TextDecoder().decode(value);
    return attachHeaders(secrets, destination, url, others, {
      ...collected,
      ...head.headers(text),
    }, send);
  });
}

export function createMcpConnections(
  deps: McpConnectionsDeps,
): McpConnections {
  const entries = new Map<string, Entry>();

  function entryOf(assignment: string, server: string): Entry | undefined {
    return entries.get(keyOf(assignment, server));
  }

  function view(entry: Entry): ConnectionView {
    return {
      owner: entry.owner,
      server_revision: entry.server.revision,
      state: entry.state,
      protocol_version: entry.protocolVersion,
      tool_list_hash: entry.toolListHash,
      retry_count: entry.retryCount,
      error: entry.error,
    };
  }

  // HTTP transport opener다.
  async function openHttp(
    server: McpServerConfig,
  ): Promise<Result<McpTransport>> {
    if (server.transport !== "http") {
      return err({ code: "invalid_input", message: "http 서버가 아니다" });
    }
    const reason = endpointReason(server.http.url);
    if (reason !== null) {
      return err({ code: "invalid_input", message: reason });
    }
    const fetch = deps.fetch;
    if (fetch === undefined) {
      return err({ code: "unavailable", message: "HTTP 연결 눈이 없다" });
    }
    const headers: Record<string, string> = {};
    // 값이 필요한 헤더다. 값은 요청마다 전송 부착이 callback으로만 준다(R17).
    const secretHeaders: SecretHeader[] = [];
    for (const [name, value] of Object.entries(server.http.headers)) {
      if (value.kind === "value") headers[name] = value.value;
      else {
        secretHeaders.push({
          ref: value.secret_ref,
          headers: (token) => ({ [name]: token }),
        });
      }
    }
    const auth = server.http.auth;
    if (auth.kind === "bearer") {
      secretHeaders.push({
        ref: auth.secret_ref,
        headers: (token) => authHeaders({ kind: "bearer", token }).headers,
      });
    } else if (auth.kind === "api_key") {
      secretHeaders.push({
        ref: auth.secret_ref,
        headers: (token) =>
          authHeaders({
            kind: "api_key",
            token,
            header_name: auth.header_name,
          }).headers,
      });
    } else if (auth.kind === "oauth2") {
      // 로그인 전에는 token 참조가 없다. 도구 호출이 막히도록 요청을 보내지 않는다(R16). 로그인한 서버는 설정이
      // 가리키는 token 참조를 요청마다 부착으로 청한다: 교환·갱신은 이 연결이 아니라 core의 몫이고(R17) 갱신된
      // 값도 다음 요청에 그대로 붙는다.
      if (auth.token_ref === null) {
        return err({ code: "forbidden", message: "로그인이 필요하다" });
      }
      secretHeaders.push({
        ref: auth.token_ref,
        headers: (token) => authHeaders({ kind: "bearer", token }).headers,
      });
    }
    const destination = secretDestinationOf(server.http.url);
    const secrets = deps.secrets;
    if (
      secretHeaders.length > 0 &&
      (secrets === undefined || destination === null)
    ) {
      return err({ code: "unavailable", message: "인증 비밀을 붙일 수 없다" });
    }
    const closed: { done: boolean } = { done: false };
    const reverse = new TransformStream<{ id: unknown; method: string }>();
    // HTTP 전송은 요청에 응답하는 단방향이므로 역방향 요청이 흐르지 않는다(R25).
    // 자동 주입도 없다(R25). reverse stream은 빈 채로 닫힌다.
    let nextId = 1;
    const post: HttpFetch = fetch;
    const url = server.http.url;
    async function request(
      method: string,
      params: unknown,
      requestSignal: AbortSignal,
    ): Promise<Result<Record<string, unknown>>> {
      const id = nextId++;
      const body = {
        jsonrpc: "2.0",
        id,
        method,
        params: params ?? {},
      };
      // 요청 하나를 보낸다. 인증 헤더는 값이 든 callback 안에서만 붙는다.
      async function exchange(
        extra: Record<string, string>,
      ): Promise<Result<Record<string, unknown>>> {
        try {
          const response = await post(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "accept": "application/json",
              ...headers,
              ...extra,
            },
            body: JSON.stringify(body),
            signal: requestSignal,
            // 다른 origin으로 인증 헤더를 옮기지 않는다(R16).
            redirect: "manual",
          });
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (location !== null) {
              const rejected = redirectOriginRejected(url, location);
              if (rejected !== null) {
                return err({ code: "unavailable", message: rejected });
              }
            }
          }
          if (response.status === 401) {
            return err({ code: "forbidden", message: "서버가 401로 답했다" });
          }
          if (response.status !== 200) {
            return err({
              code: "unavailable",
              message: `서버가 ${response.status}로 답했다`,
            });
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          const parsed = rpcResultOf(bytes);
          if (!parsed.ok) return parsed;
          return ok(parsed.value.result);
        } catch {
          return err({ code: "unavailable", message: "서버에 닿지 못했다" });
        }
      }
      if (secretHeaders.length === 0 || secrets === undefined) {
        return await exchange({});
      }
      let outcome: Result<Record<string, unknown>> | undefined;
      const attached = await attachHeaders(
        secrets,
        destination!,
        url,
        secretHeaders,
        {},
        async (extra) => {
          outcome = await exchange(extra);
          return ok({ sent: true });
        },
      );
      if (outcome !== undefined) return outcome;
      if (attached.ok) {
        return err({ code: "unavailable", message: "서버에 닿지 못했다" });
      }
      // 부착이 거절한 이유(오류 원문)는 값이 없어도 옮기지 않는다.
      return err(
        attached.error.code === "forbidden" ||
          attached.error.code === "conflict"
          ? { code: "forbidden", message: "인증 비밀을 붙이지 못했다" }
          : { code: "unavailable", message: "인증 비밀을 읽지 못했다" },
      );
    }
    return await ok({
      async request(method, params, requestSignal) {
        return await request(method, params, requestSignal);
      },
      async notify() {
        // Streamable HTTP의 알림은 응답 없는 POST다. 취소 알림은 close가 보낸다(R21).
      },
      reverseRequests() {
        return reverse.readable;
      },
      async close() {
        if (closed.done) return;
        closed.done = true;
        // 역방향 요청이 흐르지 않으므로 stream을 닫는다(R25).
        await reverse.readable.cancel();
      },
    });
  }

  // 연결 열기다. stdio는 deps.openStdio로, http는 openHttp로 연다(R13).
  async function openTransport(
    server: McpServerConfig,
    signal: AbortSignal,
  ): Promise<Result<McpTransport>> {
    if (server.transport === "http") return await openHttp(server);
    if (server.transport !== "stdio") {
      return err({
        code: "invalid_input",
        message: "전송 방식이 stdio·http가 아니다",
      });
    }
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(server.stdio.env)) {
      // secret ref는 부착 경계에서 풀린다. 여기서는 결정된 값만 온다(R14).
      if (value.kind !== "value") continue;
      env[name] = value.value;
    }
    const spawn = await deps.openStdio(
      server,
      {
        executable: server.stdio.executable,
        args: server.stdio.args,
        cwd: server.stdio.cwd,
        env,
      },
      signal,
    );
    if (!spawn.ok) return spawn;
    return ok(stdioTransport(spawn.value, server.name));
  }

  // stdio transport다. 줄 단위 JSON-RPC다. 요청 id는 transport마다 센다.
  // server 이름은 list_changed 알림을 조립에 알릴 때 쓴다(Q16).
  function stdioTransport(spawn: StdioSpawn, server: string): McpTransport {
    let nextRequestId = 1;
    const pending = new Map<
      number,
      (result: Result<Record<string, unknown>>) => void
    >();
    const reverse = new TransformStream<{ id: unknown; method: string }>();
    let buffer = "";
    const decoder = new TextDecoder();
    let reading: Promise<void> | null = null;
    function startReading() {
      if (reading !== null) return;
      reading = (async () => {
        const reader = spawn.stdout.getReader();
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            for (;;) {
              const at = buffer.indexOf("\n");
              if (at < 0) break;
              const line = buffer.slice(0, at);
              buffer = buffer.slice(at + 1);
              if (line.trim() === "") continue;
              let parsed: unknown;
              try {
                parsed = JSON.parse(line);
              } catch {
                continue;
              }
              if (parsed === null || typeof parsed !== "object") continue;
              const message = parsed as Record<string, unknown>;
              if (
                typeof message.method === "string" && message.id !== undefined
              ) {
                // 서버의 역방향 요청이다(R25).
                const writer = reverse.writable.getWriter();
                try {
                  await writer.write({
                    id: message.id,
                    method: message.method,
                  });
                } finally {
                  writer.releaseLock();
                }
                continue;
              }
              // 서버의 알림이다. 도구 목록이 바뀌면 조립이 재조회할 때까지 그
              // server의 새 호출을 막는다(Q16). 다른 알림은 버려진다.
              if (
                typeof message.method === "string" && message.id === undefined
              ) {
                if (
                  message.method === "notifications/tools/list_changed"
                ) {
                  deps.onListChanged?.(server);
                }
                continue;
              }
              const id = message.id;
              if (typeof id !== "number") continue;
              const settle = pending.get(id);
              if (settle === undefined) continue;
              pending.delete(id);
              if (message.error !== undefined && message.error !== null) {
                const error = message.error as {
                  code?: unknown;
                  message?: unknown;
                };
                settle(err({
                  code: "unavailable",
                  message: `서버가 오류로 답했다: ${
                    typeof error.code === "number"
                      ? `code ${error.code}`
                      : "오류"
                  }`,
                }));
                continue;
              }
              const result = message.result;
              settle(
                result !== null && typeof result === "object"
                  ? ok(result as Record<string, unknown>)
                  : err({ code: "unavailable", message: "result가 없다" }),
              );
            }
          }
        } catch { /* 끊긴 pipe다 */ }
        // pipe가 끊겼다다. 기다리던 요청은 응답이 오지 않는다. 재전송은
        // reconnect가 결정하고(R20) 여기서는 답을 마쳐야 pending에 남지 않는다.
        for (const [, settle] of pending) {
          settle(err({ code: "unavailable", message: "pipe가 끊겼다" }));
        }
        pending.clear();
      })();
    }
    const encoder = new TextEncoder();
    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    async function writeLine(message: unknown): Promise<boolean> {
      if (writer === null) writer = spawn.stdin.getWriter();
      try {
        await writer.write(encoder.encode(`${JSON.stringify(message)}\n`));
        return true;
      } catch {
        return false;
      }
    }
    return {
      async request(method, params, signal) {
        startReading();
        const id = nextRequestId++;
        const request = { jsonrpc: "2.0", id, method, params: params ?? {} };
        return await new Promise<Result<Record<string, unknown>>>((resolve) => {
          pending.set(id, resolve);
          const sent = { done: false };
          void writeLine(request).then((okSent) => {
            if (!okSent && !sent.done) {
              sent.done = true;
              pending.delete(id);
              resolve(err({
                code: "unavailable",
                message: "서버에 닿지 못했다",
              }));
            }
          });
          const onAbort = () => {
            if (sent.done) return;
            sent.done = true;
            pending.delete(id);
            // 이미 전달했을 수 있으므로 uncertain이다(R20).
            resolve(err({ code: "unavailable", message: "중단됐다" }));
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        });
      },
      async notify(method, params) {
        await writeLine({ jsonrpc: "2.0", method, params: params ?? {} });
      },
      reverseRequests() {
        return reverse.readable;
      },
      async close() {
        // 잠긴 writer가 stdin.close를 막으므로 먼저 놓는다(그림 ad·ah).
        if (writer !== null) writer.releaseLock();
        writer = null;
        await spawn.close();
      },
    };
  }

  // 도구 목록 한 page를 읽고 검증한다(R22).
  function toolReason(tool: unknown): string | null {
    if (tool === null || typeof tool !== "object") {
      return "tool이 객체가 아니다";
    }
    const record = tool as Record<string, unknown>;
    if (typeof record["name"] !== "string" || record["name"].length === 0) {
      return "tool 이름이 없다";
    }
    if (
      typeof record["description"] !== "string" &&
      record["description"] !== null &&
      record["description"] !== undefined
    ) return "tool 설명이 문자열이 아니다";
    // JSON Schema 객체다. 원격 $ref는 없다(R22: 원격 fetch 금지).
    const schema = record["inputSchema"];
    if (
      schema === null || typeof schema !== "object" || Array.isArray(schema)
    ) {
      return "tool 입력 설명이 JSON Schema 객체가 아니다";
    }
    const depth = schemaDepth(schema, 0);
    if (depth > SCHEMA_DEPTH_MAX) {
      return "tool 입력 설명이 깊이 상한을 넘는다";
    }
    return null;
  }

  // schema 깊이다(질문 Q14).
  function schemaDepth(value: unknown, depth: number): number {
    if (depth > SCHEMA_DEPTH_MAX) return depth;
    if (value === null || typeof value !== "object") return depth;
    let max = depth;
    for (const child of Object.values(value)) {
      const childDepth = schemaDepth(child, depth + 1);
      if (childDepth > max) max = childDepth;
    }
    return max;
  }

  return {
    async acquire(assignment, server, signal) {
      const key = keyOf(assignment, server.name);
      const existing = entries.get(key);
      // 같은 assignment의 연결이 살아 있으면 같은 연결을 쓴다(R18).
      if (existing !== undefined && existing.state === "connected") {
        // 설정 판이 바뀌면 옛 연결을 쓰지 않는다(domain model).
        if (existing.server.revision === server.revision) {
          return ok(view(existing));
        }
        await closeEntry(existing);
      }
      const entry: Entry = {
        owner: [assignment, server.name],
        server,
        state: "connecting",
        transport: null,
        protocolVersion: null,
        toolListHash: null,
        retryCount: 0,
        error: null,
        acceptingCalls: true,
        pending: new Set(),
        nextId: 1,
      };
      entries.set(key, entry);
      const deadlineSignal = new AbortController();
      const connected = await connectOnce(entry, deadlineSignal.signal, signal);
      if (connected.ok) {
        entry.state = "connected";
        entry.error = null;
        deadlineSignal.abort();
        return ok(view(entry));
      }
      // 인증 거절에는 자동 재연결하지 않는다(R20).
      entry.state = connected.error.code === "forbidden"
        ? "failed_auth"
        : "failed_temporary";
      entry.error = connected.error.message;
      deadlineSignal.abort();
      return err(connected.error);
    },

    async toolList(assignment, server) {
      const entry = entryOf(assignment, server);
      if (
        entry === undefined || entry.state !== "connected" ||
        entry.transport === null
      ) {
        return err({ code: "not_found", message: "연결이 살아 있지 않다" });
      }
      return await listAll(entry);
    },

    async call(assignment, server, tool, args, signal, timeoutMs) {
      const entry = entryOf(assignment, server);
      if (entry === undefined) {
        return { kind: "no_connection", code: "no_connection" };
      }
      if (!entry.acceptingCalls) {
        // detach 뒤 새 호출이다. 서버에 닿지 않는다(R21).
        return { kind: "not_executed", code: "configuration_revoked" };
      }
      if (entry.state !== "connected" || entry.transport === null) {
        // 연결이 살아 있지 않으면 서버에 닿지 않는다(R20).
        return { kind: "no_connection", code: "no_connection" };
      }
      const transport = entry.transport;
      const id = entry.nextId++;
      entry.pending.add(id);
      const hard = new AbortController();
      // 기한은 progress로 늘지 않는다(R19). 전달 뒤 기한 초과는 uncertain이다(R19).
      const timer = deps.deadline(timeoutMs, hard.signal);
      void timer.then((how) => {
        if (how === "elapsed") hard.abort();
      });
      const onOuterAbort = () => hard.abort();
      if (signal.aborted) hard.abort();
      else signal.addEventListener("abort", onOuterAbort, { once: true });
      let outcome: CallOutcome;
      try {
        const response = await transport.request(
          "tools/call",
          { name: tool, arguments: args ?? {} },
          hard.signal,
        );
        if (response.ok) {
          const result = response.value as {
            content?: unknown;
            isError?: unknown;
          };
          if (result["isError"] === true) {
            outcome = {
              kind: "failure",
              code: "tool_error",
              message: "tool이 오류로 답했다",
            };
          } else {
            outcome = { kind: "success", result: response.value };
          }
        } else {
          // 이미 전달했을 수 있으므로 모두 uncertain이다(R19, R20).
          outcome = { kind: "uncertain", message: response.error.message };
        }
      } finally {
        hard.abort();
        signal.removeEventListener("abort", onOuterAbort);
        entry.pending.delete(id);
      }
      return outcome;
    },

    async reconnect(assignment, server) {
      const entry = entryOf(assignment, server);
      if (entry === undefined) {
        return err({ code: "not_found", message: "연결이 없다" });
      }
      // 인증 거절에는 자동 재연결하지 않는다(R20).
      if (entry.state === "failed_auth") {
        return err({
          code: "forbidden",
          message: "인증 거절이다. 다시 로그인해야 한다",
        });
      }
      // 최대 세 번이다(R20). 네 번째는 시도하지 않는다.
      if (entry.retryCount >= 3) {
        return err({
          code: "unavailable",
          message:
            "재연결 한도에 닿았다. 사람이 다시 연결하거나 설정을 고쳐야 한다",
        });
      }
      const ms = RECONNECT_DELAYS_MS[Math.min(entry.retryCount, 2)];
      const stall = new AbortController();
      await deps.wait(ms, stall.signal);
      stall.abort();
      // 시도는 성공·실패와 무관하게 센다(R20: 1·2·4초 세 번).
      entry.retryCount = (entry.retryCount + 1) as 0 | 1 | 2 | 3;
      entry.state = "connecting";
      entry.acceptingCalls = true;
      const outer = new AbortController();
      const connected = await connectOnce(entry, outer.signal, outer.signal);
      if (!connected.ok) {
        entry.state = connected.error.code === "forbidden"
          ? "failed_auth"
          : "failed_temporary";
        entry.error = connected.error.message;
        outer.abort();
        return err(connected.error);
      }
      entry.state = "connected";
      entry.error = null;
      outer.abort();
      return ok(view(entry));
    },

    async detach(assignment, server) {
      const entry = entryOf(assignment, server);
      if (entry === undefined) return;
      await closeEntry(entry);
    },

    async endAssignment(assignment) {
      for (const [key, entry] of entries) {
        if (entry.owner[0] !== assignment) continue;
        await closeEntry(entry);
        entries.delete(key);
      }
    },

    async endAll() {
      for (const [key, entry] of entries) {
        await closeEntry(entry);
        entries.delete(key);
      }
    },

    views() {
      return [...entries.values()].map(view);
    },
  };

  // 한 번의 연결+initialize다(R19). 합산 30초 기한이다.
  async function connectOnce(
    entry: Entry,
    deadlineSignal: AbortSignal,
    outerSignal: AbortSignal,
  ): Promise<Result<void>> {
    const opened = await openTransport(entry.server, outerSignal);
    if (!opened.ok) return opened;
    const transport = opened.value;
    const hard = new AbortController();
    const timer = deps.deadline(CONNECT_TIMEOUT_MS, hard.signal);
    void timer.then((how) => {
      if (how === "elapsed") hard.abort();
    });
    const merged = mergeSignals(deadlineSignal, hard.signal, outerSignal);
    try {
      const init = await transport.request(
        "initialize",
        initializeBody().params ?? {},
        merged,
      );
      if (!init.ok) {
        // 인증 거절은 transport가 err code로 옮긴다. HTTP 401은 unavailable로
        // 감싸서 온다. 여기서 실패 이유를 구별한다(R20).
        const authFailed = init.error.code === "forbidden" ||
          init.error.message.includes("401");
        await transport.close();
        return err({
          code: authFailed ? "forbidden" : "unavailable",
          message: authFailed ? "인증 거절이다" : init.error.message,
        });
      }
      const result = init.value as { protocolVersion?: unknown };
      if (typeof result["protocolVersion"] !== "string") {
        await transport.close();
        return err({ code: "unavailable", message: "protocol version이 없다" });
      }
      entry.protocolVersion = result["protocolVersion"];
      entry.transport = transport;
      await transport.notify("notifications/initialized", {});
      return ok(undefined);
    } finally {
      hard.abort();
    }
  }

  // 전체 tools/list page다(R22). 모든 page를 받아 검증한 뒤에만 목록을 준다.
  async function listAll(entry: Entry): Promise<Result<ToolList>> {
    const transport = entry.transport;
    if (transport === null) {
      return err({ code: "not_found", message: "연결이 살아 있지 않다" });
    }
    const hard = new AbortController();
    const timer = deps.deadline(LIST_TIMEOUT_MS, hard.signal);
    void timer.then((how) => {
      if (how === "elapsed") hard.abort();
    });
    const tools: McpToolView[] = [];
    const seenNames = new Set<string>();
    const seenCursors = new Set<string>();
    let bytes = 0;
    let cursor: string | undefined = undefined;
    let pages = 0;
    try {
      for (;;) {
        if (pages >= LIST_PAGE_MAX) {
          return err({ code: "invalid_input", message: "page 상한을 넘었다" });
        }
        const response = await transport.request(
          "tools/list",
          cursor === undefined ? {} : { cursor },
          hard.signal,
        );
        if (!response.ok) {
          return err({ code: "unavailable", message: response.error.message });
        }
        const page = response.value as {
          tools?: unknown;
          nextCursor?: unknown;
        };
        if (!Array.isArray(page["tools"])) {
          return err({ code: "invalid_input", message: "tools 목록이 없다" });
        }
        pages += 1;
        for (const tool of page["tools"]) {
          if (tools.length >= LIST_TOOLS_MAX) {
            return err({
              code: "invalid_input",
              message: "tool 수 상한을 넘었다",
            });
          }
          const reason = toolReason(tool);
          if (reason !== null) {
            // 잘못된 tool 하나면 그 서버 목록 전체를 내지 않는다(R22).
            return err({ code: "invalid_input", message: reason });
          }
          const record = tool as Record<string, unknown>;
          const name = record["name"] as string;
          if (seenNames.has(name)) {
            // 중복 원래 이름이다(R22).
            return err({
              code: "invalid_input",
              message: "중복 tool 이름이다",
            });
          }
          seenNames.add(name);
          bytes += JSON.stringify(record).length;
          if (bytes > LIST_BYTES_MAX) {
            return err({
              code: "invalid_input",
              message: "누적 바이트 상한을 넘었다",
            });
          }
          tools.push({
            server: entry.owner[1],
            original: name,
            description: typeof record["description"] === "string"
              ? record["description"]
              : null,
            schema: record["inputSchema"] as Record<string, unknown>,
          });
        }
        const next = page["nextCursor"];
        if (next === undefined || next === null) break;
        if (typeof next !== "string") {
          return err({
            code: "invalid_input",
            message: "cursor가 문자열이 아니다",
          });
        }
        if (seenCursors.has(next)) {
          // 반복 cursor다(R22). 목록 전체를 내지 않는다.
          return err({ code: "invalid_input", message: "반복 cursor다" });
        }
        seenCursors.add(next);
        cursor = next;
      }
    } finally {
      hard.abort();
    }
    // 모든 page·검증이 끝난 뒤에만 hash를 둔다(domain model tool_list_hash).
    const hash = await sha256Hex(JSON.stringify(tools.map((tool) => [
      tool.server,
      tool.original,
      tool.description,
      tool.schema,
    ])));
    entry.toolListHash = hash;
    return ok({ tools, hash, protocol_version: entry.protocolVersion ?? "" });
  }

  // 떼기다(R21). 새 호출을 막고 진행 호출에 취소를 알린 뒤 닫는다.
  async function closeEntry(entry: Entry) {
    if (!entry.acceptingCalls) return;
    entry.acceptingCalls = false;
    const transport = entry.transport;
    if (transport !== null) {
      // 진행 호출에 MCP 취소를 요청한다(R21).
      for (const id of entry.pending) {
        await transport.notify("notifications/cancelled", {
          requestId: id,
          reason: "owner detached",
        });
      }
      entry.pending.clear();
      await transport.close();
      entry.transport = null;
    }
    entry.state = "disconnected";
  }
}

// 여러 신호를 하나로 묶는다.
function mergeSignals(
  ...sources: readonly AbortSignal[]
): AbortSignal {
  const control = new AbortController();
  for (const source of sources) {
    if (source.aborted) control.abort();
    else {source.addEventListener("abort", () => control.abort(), {
        once: true,
      });}
  }
  return control.signal;
}
