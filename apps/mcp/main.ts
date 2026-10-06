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
import {
  type AppDirect,
  uploadPrepareBytes,
} from "../../packages/coding-agent/connection/mod.ts";
import { createAppTool } from "../../packages/coding-agent/mcp-server/tools/app.ts";
import { createSdkTool } from "../../packages/coding-agent/mcp-server/tools/sdk.ts";
import { createContextTool } from "../../packages/coding-agent/mcp-server/tools/context.ts";
import { createDocumentTool } from "../../packages/coding-agent/mcp-server/tools/document.ts";
import { createIndexTool } from "../../packages/coding-agent/mcp-server/tools/index.ts";
import { createProjectTool } from "../../packages/coding-agent/mcp-server/tools/project.ts";
import { createReadTool } from "../../packages/coding-agent/mcp-server/tools/read.ts";
import { createFormatTool } from "../../packages/coding-agent/mcp-server/tools/format.ts";
import { createApprovalTool } from "../../packages/coding-agent/mcp-server/tools/approval.ts";
import { createQuestionTool } from "../../packages/coding-agent/mcp-server/tools/question.ts";
import { createSaveTool } from "../../packages/coding-agent/mcp-server/tools/save.ts";
import { createSeriesTool } from "../../packages/coding-agent/mcp-server/tools/series.ts";
import {
  createTicketTool,
  TICKET_TOOL_NAME,
} from "../../packages/coding-agent/mcp-server/tools/ticket.ts";

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
  // 제출 파일 root다. 없으면 작업 위치(--cwd <submission-root>)다.
  submissionRoot?: string;
  // 앱 통로(direct call)다. 실제 socket transport와 권한은 설치·loader 배선(coding-agent#T36)이
  // 끼운다. 없으면 lophn_app command는 unavailable이다.
  appDirect?: AppDirect;
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
  // 환경은 필요한 이름만 get한다. argv의 --allow-env가 이름 나열이므로 전체 읽기
  // toObject()는 NotCapable이다(connection#R16).
  const source = options.env ?? readEnv();
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
  // lophn_ticket의 실행이다(T20). claim·renew·release를 실제 core에 보내고
  // 응답에 connection·claim_seq·expires_at·반납 방법을 남긴다(mcp#R27).
  const ticketTool = caller
    ? createTicketTool({
      client: caller,
      now: () => new Date().toISOString(),
      idempotencyKey: () => `mcp-ticket-${crypto.randomUUID()}`,
    })
    : undefined;
  // 앱 개발 tool의 실행이다(T21). 소유 route로만 보내고 CLI와 같은 흐름을 쓴다.
  const appTool = caller
    ? createAppTool({
      client: caller,
      idempotencyKey: () => `mcp-app-${crypto.randomUUID()}`,
      direct: options.appDirect,
    })
    : undefined;
  // 문서 저장·format·series·context tool의 실행이다(T14·T17). 같은 core client로 소유 route만 부른다.
  const submission = {
    scope: { root: options.submissionRoot ?? Deno.cwd(), forbidden: [] },
    prepareBytes: caller === undefined ? undefined : uploadPrepareBytes(caller),
  };
  const documentTools = caller && submission.prepareBytes
    ? {
      lophn_save: createSaveTool({
        client: caller,
        scope: submission.scope,
        prepareBytes: submission.prepareBytes,
      }),
      lophn_format: createFormatTool({
        client: caller,
        scope: submission.scope,
        prepareBytes: submission.prepareBytes,
      }),
      lophn_series: createSeriesTool({ client: caller }),
      // 읽기는 소유 route, propose는 변경안 문서 저장뿐이다(T17).
      lophn_context: createContextTool({
        client: caller,
        prepareBytes: submission.prepareBytes,
      }),
    }
    : undefined;
  // 문서 읽기 tool의 실행이다(T13): 목차·검색·project·목록·이력·본문. 소유 읽기 route만 부른다.
  const readTools = caller
    ? {
      lophn_index: createIndexTool({ client: caller }),
      lophn_project: createProjectTool({ client: caller }),
      lophn_document: createDocumentTool({ client: caller }),
      lophn_read: createReadTool({ client: caller }),
      // SDK catalog·상세·exact version 안내(T22). source 쓰기 port는 주지 않는다(apply 거절).
      lophn_sdk: createSdkTool({ client: caller }),
    }
    : undefined;
  // 질문·approval 읽기 tool의 실행이다(T16). 읽기 route만 부르고 결정하지 않는다.
  const decisionTools = caller
    ? {
      lophn_question: createQuestionTool({ client: caller }),
      lophn_approval: createApprovalTool({ client: caller }),
    }
    : undefined;
  const handler = createHandler({
    toolsets,
    onClientInfo: (name) => {
      clientName = name;
    },
    notify: (message) => sink.send(JSON.stringify(message)),
    callTool: (toolName, callArgs, context) => {
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
      if (toolName === TICKET_TOOL_NAME) {
        return ticketTool === undefined
          ? Promise.resolve({
            summary: "tool 실행 준비가 안 됐다",
            data: { tool: toolName, op, connected: false },
            next: ["lophn doctor로 연결과 credential을 확인한다"],
          })
          : ticketTool(toolName, resolved.route, callArgs);
      }
      if (toolName === "lophn_app") {
        return appTool === undefined
          ? Promise.resolve({
            summary: "tool 실행 준비가 안 됐다",
            data: { tool: toolName, op, connected: false },
            next: ["lophn doctor로 연결과 credential을 확인한다"],
          })
          : appTool(toolName, resolved.route, callArgs, context);
      }
      const documentTool = documentTools !== undefined &&
          Object.hasOwn(documentTools, toolName)
        ? documentTools[toolName as keyof typeof documentTools]
        : undefined;
      if (documentTool !== undefined) {
        return documentTool(toolName, resolved.route, callArgs);
      }
      const readTool = readTools !== undefined &&
          Object.hasOwn(readTools, toolName)
        ? readTools[toolName as keyof typeof readTools]
        : undefined;
      if (readTool !== undefined) {
        return readTool(toolName, resolved.route, callArgs);
      }
      const decisionTool = decisionTools !== undefined &&
          Object.hasOwn(decisionTools, toolName)
        ? decisionTools[toolName as keyof typeof decisionTools]
        : undefined;
      if (decisionTool !== undefined) {
        return decisionTool(toolName, resolved.route, callArgs);
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

// 허용 목록의 이름만 get한다. 전체 읽기 toObject()는 NotCapable이다(connection#R16).
function readEnv(): Record<string, string | undefined> {
  const names = [
    "LOPHN_AGENT_LABEL",
    "LOPHN_MCP_TOOLSETS",
    LOPHN_CONNECTION,
    LOPHN_DAEMON_URL,
  ];
  const source: Record<string, string | undefined> = {};
  for (const name of names) {
    try {
      source[name] = Deno.env.get(name);
    } catch {
      source[name] = undefined;
    }
  }
  return source;
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
