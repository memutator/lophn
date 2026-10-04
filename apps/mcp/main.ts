// lophn-mcp의 실행 entry다(code-map). 조립만 하고 업무 규칙을 두지 않는다.
// stdin/stdout으로 stdio transport를 열고, credential provider는 helper loader
// 자리다(coding-agent/harnesses). label·toolsets·connection은 argv와 환경 설정
// 순서로 찾는다(connection#R3). core RPC는 소유 route 하나로만 routing한다(R2).
import { ok, type Result } from "../../packages/base/mod.ts";
import type { LophnError } from "../../packages/base/mod.ts";
import {
  type ConnectionId,
  LOPHN_CONNECTION,
  parseToolsets,
  type Toolset,
} from "../../packages/contracts/coding-agent/mod.ts";
import { connectionFromRef } from "../../packages/coding-agent/connection/client/core.ts";
import type { CredentialProvider } from "../../packages/coding-agent/connection/credential/provider.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import {
  LOPHN_DAEMON_URL,
  resolveDaemonAddress,
} from "../../packages/coding-agent/connection/client/daemon.ts";
import { isEffectUnknown } from "../../packages/coding-agent/connection/client/core.ts";
import {
  createHandler,
  createMessageSink,
  resolveRoute,
  startLineReader,
  type StdioStreams,
} from "../../packages/coding-agent/mcp-server/mod.ts";

type Streams = {
  stdin: ReadableStream<Uint8Array>;
  stdout: WritableStream<Uint8Array>;
  stderr: WritableStream<Uint8Array>;
};

export type McpOptions = {
  streams?: Streams;
  // 테스트가 daemon 주소·client를 끼운다. 없으면 찾기 순서를 따른다.
  daemonUrl?: string;
  client?: ToolRunner;
  // argv다. 없으면 프로세스 argv다.
  args?: readonly string[];
  env?: Record<string, string | undefined>;
  redact?: (text: string) => string;
};

// tools/call의 실행이다. registry route 하나로만 routing된다(R2).
export type ToolRunner = (
  toolName: string,
  route: Parameters<typeof resolveRoute>[1] extends string | undefined ? {
      resource: string;
      method: string;
    }
    : never,
  input: unknown,
) => Promise<{ summary: string; data: unknown; next: string[] }>;

export type StartedMcp = {
  toolsets: readonly Toolset[];
  connection: ConnectionId | undefined;
  // label 표시 순서의 첫 항목이다. argv·환경 설정에서 찾은 값이며 권한과 관계없다.
  label: string | undefined;
  // clientInfo.name은 label 순서의 마지막 항목이다. 권한과 관계없다(connection#R3).
  clientName: string | undefined;
  done: Promise<void>;
};

// server를 띄운다. stdin이 닫히면 끝난다(R1).
export function startMcpServer(
  options: McpOptions = {},
): Promise<Result<StartedMcp, LophnError>> {
  const streams: Streams = options.streams ?? {
    stdin: Deno.stdin.readable,
    stdout: Deno.stdout.writable,
    stderr: Deno.stderr.writable,
  };
  const args = options.args ?? Deno.args;
  const source = options.env ?? Deno.env.toObject();
  const label = optionValue(args, "--label") ?? source["LOPHN_AGENT_LABEL"] ??
    undefined;
  const toolsets = parseToolsets(
    optionValue(args, "--toolsets") ??
      source["LOPHN_MCP_TOOLSETS"],
  );
  const connection = connectionFromRef(
    optionValue(args, "--connection") ?? source[LOPHN_CONNECTION],
  );
  const sink = createMessageSink(streams, options.redact);
  let clientName: string | undefined;
  const address = options.daemonUrl !== undefined
    ? ok({ url: options.daemonUrl })
    : resolveDaemonAddress({ env: source[LOPHN_DAEMON_URL] });
  const daemon = address.ok ? address.value.url : "";
  const runner = options.client;
  const caller = connection.ok && daemon !== "" && runner
    ? createCoreClient({
      baseUrl: daemon,
      // 실제 helper loader는 coding-agent/harnesses가 채운다. T11에서는 seam이다.
      provider: noopProvider,
      connection: connection.value,
    })
    : undefined;
  const handler = createHandler({
    toolsets,
    onClientInfo: (name) => {
      clientName = name;
    },
    callTool: (toolName, callArgs) => {
      // server가 route 표와 input을 검사한다. 여기는 연결 상태와 실행뿐이다.
      const params = (callArgs ?? {}) as { op?: unknown };
      const op = typeof params.op === "string" ? params.op : undefined;
      const resolved = resolveRoute(toolName, op);
      if (!resolved || !caller || !runner) {
        return Promise.resolve({
          summary: "tool 실행 준비가 안 됐다",
          data: { tool: toolName, op, connected: Boolean(caller) },
          next: ["lophn doctor로 연결과 credential을 확인한다"],
        });
      }
      return runner(toolName, resolved.route, callArgs);
    },
  });
  return Promise.resolve(ok({
    toolsets,
    connection: connection.ok ? connection.value : undefined,
    label,
    get clientName() {
      return clientName;
    },
    done: run(streams, handler, sink),
  }));
}

// provider seam이다. 실제 helper loader가 아니면 credential을 받지 못한다.
const noopProvider: CredentialProvider = () =>
  Promise.resolve({
    ok: false as const,
    error: "no_secret_service" as const,
  });

async function run(
  streams: StdioStreams,
  handler: (line: string) => Promise<unknown>,
  sink: ReturnType<typeof createMessageSink>,
): Promise<void> {
  const reader = startLineReader(streams.stdin);
  while (true) {
    const outcome = await reader.next();
    if (outcome.kind === "eof") break;
    if (outcome.kind === "oversize") {
      // 상한을 넘은 줄은 메시지가 성립하지 않는다. parse 오류 하나로 응답한다.
      await sink.send(JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "줄이 상한을 넘었다" },
      }));
      continue;
    }
    const response = await handler(outcome.line);
    if (response !== undefined) {
      await sink.send(JSON.stringify(response));
    }
  }
  await sink.close();
}

function optionValue(
  args: readonly string[],
  name: string,
): string | undefined {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

export { isEffectUnknown };

if (import.meta.main) {
  const started = await startMcpServer({});
  if (!started.ok) {
    console.error(`lophn-mcp: ${started.error.message}`);
    Deno.exit(1);
  }
  await started.value.done;
  Deno.exit(0);
}
