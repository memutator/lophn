// 설치된 Deno executable로 lophn-mcp를 띄워 initialize·tools/list를 확인하는
// 눈이다(coding-agent/harnesses#R10, T32). 요청은 loading.ts의 gate를 지난
// 것(설치 Deno executable과 좁은 권한 args)만 온다. stdin/stdout JSON-RPC 한
// 번을 주고받고 끝내며 server를 남겨 두지 않는다. stdout 원문·stderr는 반환하지
// 않고 안전한 분류와 exit code만 남긴다(R12). timeout을 성공이나 실패로 바꾸지
// 않는다(R3).
import type {
  McpProbePort,
  McpProbeRequest,
  McpProbeResult,
} from "./loading.ts";

export const MCP_PROBE_TIMEOUT_MS = 5_000;
const LINE_LIMIT_BYTES = 1_048_576;

// 시작 환경에 넘기는 이름이다. 그 밖의 process env는 server에 가지 않는다.
const AMBIENT = ["PATH", "HOME", "DENO_DIR", "LOPHN_HOME"] as const;

export type StdioProbeOptions = {
  timeout_ms?: number;
  // 호출 process의 env 값이다. 없는 이름은 넘기지 않는다.
  ambient?: (name: string) => string | undefined;
};

type Read =
  | { kind: "message"; value: unknown }
  | { kind: "closed" }
  | { kind: "timeout" }
  | { kind: "invalid" };

export function stdioMcpProbe(options: StdioProbeOptions = {}): McpProbePort {
  const timeout = options.timeout_ms ?? MCP_PROBE_TIMEOUT_MS;
  return {
    run: (request) => probe(request, timeout, options.ambient),
  };
}

async function probe(
  request: McpProbeRequest,
  timeout: number,
  ambient: ((name: string) => string | undefined) | undefined,
): Promise<McpProbeResult> {
  const env: Record<string, string> = {};
  for (const name of AMBIENT) {
    const value = ambient?.(name);
    if (value !== undefined) env[name] = value;
  }
  Object.assign(env, request.env);
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command(request.command, {
      args: [...request.args],
      env,
      clearEnv: true,
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
    }).spawn();
  } catch {
    return {
      kind: "failed",
      phase: "start",
      reason: "spawn_failed",
      detail: "실행 파일을 시작하지 못했다",
    };
  }
  const writer = child.stdin.getWriter();
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const deadline = Date.now() + timeout;
  let buffer = "";

  async function readMessage(): Promise<Read> {
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim() === "") continue;
        try {
          return { kind: "message", value: JSON.parse(line) };
        } catch {
          return { kind: "invalid" };
        }
      }
      if (buffer.length > LINE_LIMIT_BYTES) return { kind: "invalid" };
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { kind: "timeout" };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const raced = await Promise.race([
        reader.read().catch(() => ({ done: true, value: undefined })),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), remaining);
        }),
      ]);
      clearTimeout(timer);
      if (raced === "timeout") return { kind: "timeout" };
      if (raced.done) return { kind: "closed" };
      buffer += decoder.decode(raced.value, { stream: true });
    }
  }

  async function send(message: unknown): Promise<boolean> {
    try {
      await writer.write(encoder.encode(`${JSON.stringify(message)}\n`));
      return true;
    } catch {
      return false;
    }
  }

  // id가 맞는 응답 하나를 기다린다. 다른 줄(notification)은 건너뛴다.
  async function response(
    id: number,
    phase: "initialize" | "tools_list",
  ): Promise<
    | { ok: true; result: Record<string, unknown> }
    | { ok: false; result: McpProbeResult }
  > {
    while (true) {
      const read = await readMessage();
      if (read.kind === "timeout") {
        return { ok: false, result: { kind: "timeout", phase } };
      }
      if (read.kind === "invalid") {
        return {
          ok: false,
          result: failed(phase, "protocol", "JSON 줄이 아니다"),
        };
      }
      if (read.kind === "closed") {
        return {
          ok: false,
          result: failed(phase, "exited", await exitDetail(child)),
        };
      }
      const value = read.value;
      if (value === null || typeof value !== "object") {
        return {
          ok: false,
          result: failed(phase, "protocol", "JSON-RPC 객체가 아니다"),
        };
      }
      const message = value as Record<string, unknown>;
      if (message.id !== id) continue;
      if (message.error !== undefined && message.error !== null) {
        const code = (message.error as { code?: unknown }).code;
        return {
          ok: false,
          result: failed(
            phase,
            "rpc_error",
            typeof code === "number" ? `code ${code}` : "오류 응답",
          ),
        };
      }
      const result = message.result;
      if (result === null || typeof result !== "object") {
        return {
          ok: false,
          result: failed(phase, "protocol", "result가 없다"),
        };
      }
      return { ok: true, result: result as Record<string, unknown> };
    }
  }

  try {
    const sent = await send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "lophn-doctor", version: "0" },
      },
    });
    if (!sent) {
      return failed("initialize", "exited", await exitDetail(child));
    }
    const init = await response(1, "initialize");
    if (!init.ok) return init.result;
    const info = init.result.serverInfo;
    const server = info !== null && typeof info === "object" &&
        typeof (info as { name?: unknown }).name === "string"
      ? (info as { name: string }).name
      : null;
    await send({ jsonrpc: "2.0", method: "notifications/initialized" });
    await send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listed = await response(2, "tools_list");
    if (!listed.ok) return listed.result;
    const tools = listed.result.tools;
    if (!Array.isArray(tools)) {
      return failed("tools_list", "protocol", "tools 목록이 없다");
    }
    const names: string[] = [];
    for (const tool of tools) {
      const name = (tool as { name?: unknown } | null)?.name;
      if (typeof name !== "string") {
        return failed("tools_list", "protocol", "tool 이름이 없다");
      }
      names.push(name);
    }
    return { kind: "ok", server, tools: names };
  } finally {
    await writer.close().catch(() => {});
    try {
      child.kill("SIGKILL");
    } catch {
      // 이미 끝났으면 조용히 넘어간다.
    }
    await reader.cancel().catch(() => {});
    await child.status.catch(() => {});
  }
}

function failed(
  phase: "initialize" | "tools_list",
  reason: "exited" | "protocol" | "rpc_error",
  detail: string,
): McpProbeResult {
  return { kind: "failed", phase, reason, detail };
}

async function exitDetail(child: Deno.ChildProcess): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const status = await Promise.race([
      child.status,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 500);
      }),
    ]);
    return status === null ? "종료됨" : `exit code ${status.code}`;
  } catch {
    return "종료됨";
  } finally {
    clearTimeout(timer);
  }
}
