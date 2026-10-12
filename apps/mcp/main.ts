// lophn-mcp의 실행 entry다(code-map). 조립만 하고 업무 규칙을 두지 않는다.
// stdin/stdout으로 stdio transport를 열고, credential provider는 helper loader
// 자리다(coding-agent/harnesses). label·toolsets·connection은 argv와 환경 설정
// 순서로 찾는다(connection#R3). core RPC는 소유 route 하나로만 routing한다(R2).
import { unixAppDirectTransport } from "../../packages/coding-agent/connection/app-direct-unix.ts";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import type { LophnError } from "../../packages/base/mod.ts";
import {
  type ConnectionId,
  LOPHN_CONNECTION,
  parseToolsets,
  type Toolset,
} from "../../packages/protocol/coding-agent/mod.ts";
import { connectionFromRef } from "../../packages/coding-agent/connection/client/core.ts";
import type { CredentialProvider } from "../../packages/coding-agent/connection/credential/provider.ts";
import {
  createHelperCredentialProvider,
  registeringProvider,
} from "../../packages/coding-agent/connection/credential/helper.ts";
import {
  createKnownSecretRegistry,
  createRedactionStream,
} from "../../packages/platform/redaction/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import {
  REDACTION_REPLACEMENT,
  type RpcFetch,
} from "../../packages/protocol/platform/mod.ts";
import {
  discoverDaemonAddress,
  LOPHN_DAEMON_URL,
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
  createAppDirect,
  uploadPrepareBytes,
} from "../../packages/coding-agent/connection/mod.ts";
import { createAppTool } from "../../packages/coding-agent/mcp-server/tools/app.ts";
import {
  loadDistribution,
  syncTools,
} from "../../packages/coding-agent/guides/mod.ts";
import {
  filePort,
  integrationsStore,
  launchOf,
} from "../../packages/coding-agent/harnesses/mod.ts";
import { createSdkTool } from "../../packages/coding-agent/mcp-server/tools/sdk.ts";
import {
  type AppBlueprintSource,
  appBlueprintSourceOf,
  createAppCommandTools,
} from "../../packages/coding-agent/mcp-server/tools/app-commands.ts";
import { createDocumentTool } from "../../packages/coding-agent/mcp-server/tools/document.ts";
import { createIndexTool } from "../../packages/coding-agent/mcp-server/tools/index.ts";
import { createProblemTool } from "../../packages/coding-agent/mcp-server/tools/problem.ts";
import { createProjectTool } from "../../packages/coding-agent/mcp-server/tools/project.ts";
import { createReadTool } from "../../packages/coding-agent/mcp-server/tools/read.ts";
import { createFormatTool } from "../../packages/coding-agent/mcp-server/tools/format.ts";
import { createApprovalTool } from "../../packages/coding-agent/mcp-server/tools/approval.ts";
import { createQuestionTool } from "../../packages/coding-agent/mcp-server/tools/question.ts";
import { createSessionTool } from "../../packages/coding-agent/mcp-server/tools/session.ts";
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
  // credential provider다. 없으면 설치 묶음의 helper `lophn-credential`에서 받는 production provider다
  // (connection#R17). 시험은 fake helper를 끼운다.
  provider?: CredentialProvider;
  // 제출 root가 거절할 운영 data root다. 없으면 LOPHN_HOME이다(connection#R10).
  dataRoot?: string;
  // 제출 파일 root다. 없으면 작업 위치(--cwd <submission-root>)다.
  submissionRoot?: string;
  // 앱 통로(direct call)다. 없으면 core의 `apps/connect`가 준 socket으로 unix socket transport가
  // 연결한다. 닿는 socket은 실행 argv가 허락한 앱 direct socket의 정확한 경로뿐이고 권한이 없으면
  // unavailable이다(mcp#R29).
  appDirect?: AppDirect;
  // active release blueprint의 command 정의를 읽는다(T23). 소유 route(apps#T19)가 서면 그 read로
  // 만든다. 없으면 blueprint 유래 앱 tool은 나오지 않는다.
  appBlueprint?: AppBlueprintSource;
  // 시험이 core 응답을 끼운다. 없으면 전역 fetch다.
  fetch?: RpcFetch;
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
  // 받은 token을 알려진 값으로 올려 어떤 출력도 이 redaction을 거친다(connection#R17).
  const known = createKnownSecretRegistry();
  const redact = options.redact ?? ((text: string) => {
    const stream = createRedactionStream(known);
    stream.push(text);
    return stream.finish();
  });
  const rawSink = createMessageSink(streams, redact);
  // protocol 메시지(tool 결과)도 받은 token을 가린다. core가 이미 알려진 값을 가리지만 이 process가
  // 받은 값은 어떤 출력에도 남지 않게 마지막으로 한 번 더 지운다(connection#R17).
  const sink: typeof rawSink = {
    ...rawSink,
    send: (line: string) => rawSink.send(scrubKnown(known, line)),
  };
  let clientName: string | undefined;
  const dataRoot = options.dataRoot ?? source["LOPHN_HOME"];
  const address = options.daemonUrl !== undefined
    ? ok({ url: options.daemonUrl })
    : discoverDaemonAddress({
      env: source[LOPHN_DAEMON_URL],
      dataRoot,
      readText: readTextOrUndefined,
    });
  const daemon = address.ok ? address.value.url : "";
  const runner = options.client;
  const caller = connection.ok && daemon !== ""
    ? createCoreClient({
      baseUrl: daemon,
      // connection 참조로 시작할 때 helper에서 credential을 한 번 받는다. 평문 파일·user credential
      // fallback은 없다(connection#R17, mcp-server#R36).
      provider: registeringProvider(
        options.provider ?? createHelperCredentialProvider({
          helper: INSTALLED_HELPER,
        }),
        known,
      ),
      connection: connection.value,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
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
  // 문제 tool의 실행이다(T44). 읽기와 지정 ticket의 현재 claim 아래 record_fix·reproduction test만
  // 소유 route로 보낸다. 문제 직접 claim op는 없다(mcp#R24, R25).
  const problemTool = caller
    ? createProblemTool({
      client: caller,
      idempotencyKey: () => `mcp-problem-${crypto.randomUUID()}`,
      now: () => new Date().toISOString(),
      ...(connection.ok ? { connection: connection.value } : {}),
    })
    : undefined;
  const direct = options.appDirect ??
    (caller
      ? createAppDirect({ client: caller, transport: unixAppDirectTransport() })
      : undefined);
  // 앱 개발 tool의 실행이다(T21). 소유 route로만 보내고 CLI와 같은 흐름을 쓴다.
  // 도구 재배포(guides#R17)는 파일 설치라 core route 밖이다: submissionRoot(앱 source
  // 폴더, --cwd)의 target으로 guides의 syncTools를 돌린다(mcp#R19).
  const appTool = caller
    ? createAppTool({
      client: caller,
      idempotencyKey: () => `mcp-app-${crypto.randomUUID()}`,
      direct,
      sync: async (opInput) => {
        const target = opInput.target as never;
        if (
          typeof target !== "object" || target === null ||
          typeof (target as { app_realpath?: unknown }).app_realpath !==
            "string"
        ) {
          return err({
            code: "invalid_input",
            message: "재배포 대상 target이 필요하다(harness plan의 target)",
          });
        }
        const root = (target as { app_realpath: string }).app_realpath
          .replace(/\/$/, "");
        const connectionRef = connection.ok ? connection.value : "";
        const loaded = await loadDistribution();
        if (!loaded.ok) return loaded;
        return syncTools({
          target,
          ...(Array.isArray(opInput.names)
            ? { names: opInput.names as string[] }
            : {}),
          skills: loaded.value.skills,
          roots: {
            home: dataRoot ? dataRoot.replace(/\/lophn$/, "") : "",
            env: { get: (name) => source[name] },
            cwd: root,
          },
          launch: launchOf({
            executable: `${dataRoot ?? ""}/deno`,
            resources: `${dataRoot ?? ""}/platform`,
            cache: source["DENO_DIR"] ??
              `${
                dataRoot ? dataRoot.replace(/\/lophn$/, "") : ""
              }/.cache/lophn/deno`,
            discoveryFiles: [],
            submissionRoot: root,
            coreAddress: address.ok ? new URL(address.value.url).host : "",
            appAddresses: [],
            connection: connectionRef,
            toolsets: "core,app",
            credentialHelper: `${dataRoot ?? ""}/lophn-credential`,
          }),
          connection: connectionRef === "" ? null : connectionRef,
          operationId: `mcp-app-${crypto.randomUUID()}`,
          now: new Date().toISOString(),
        }, {
          files: filePort(),
          store: integrationsStore(
            `${
              dataRoot ? dataRoot.replace(/\/lophn$/, "") : ""
            }/.lophn/integrations`,
          ),
        });
      },
    })
    : undefined;
  // blueprint 유래 앱 read tool이다(T23). app toolset과 blueprint source가 있을 때만 난다.
  const appCommands = caller && toolsets.includes("app")
    ? createAppCommandTools({
      client: caller,
      idempotencyKey: () => `mcp-app-${crypto.randomUUID()}`,
      direct,
      // 소유 read(`/v1/apps/blueprint`)로 active release의 command 정의를 읽는다.
      blueprint: options.appBlueprint ?? appBlueprintSourceOf(caller),
      listChanged: () =>
        sink.send(JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/tools/list_changed",
        })),
    })
    : undefined;
  // 문서 저장·format·series tool의 실행이다(T14). 같은 core client로 소유 route만 부른다.
  const submission = {
    // 운영 data root는 제출 파일이 될 수 없다. 앱 source와 이어진 symlink도 실제 경로로 푼 뒤 같이
    // 거절된다(connection#R10).
    scope: {
      root: options.submissionRoot ?? Deno.cwd(),
      forbidden: dataRoot === undefined || dataRoot === "" ? [] : [dataRoot],
    },
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
      // 세션 시작 summary 읽기(T35). 읽기 route 하나이고 claim·착수를 하지 않는다.
      lophn_session: createSessionTool({ client: caller }),
    }
    : undefined;
  const handler = createHandler({
    toolsets,
    appCommands,
    onClientInfo: (name) => {
      clientName = name;
    },
    notify: (message) => sink.send(JSON.stringify(message)),
    callTool: (toolName, callArgs, context) => {
      // server가 route 표와 input을 검사한다. 여기는 연결 상태와 실행뿐이다.
      const params = (callArgs ?? {}) as { op?: unknown };
      const op = typeof params.op === "string" ? params.op : undefined;
      if (appCommands?.owns(toolName)) {
        return appCommands.call(toolName, callArgs, context);
      }
      const resolved = resolveRoute(toolName, op);
      if (!resolved || !caller) {
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
      if (toolName === "lophn_problem") {
        return problemTool === undefined
          ? Promise.resolve({
            summary: "tool 실행 준비가 안 됐다",
            data: { tool: toolName, op, connected: false },
            next: ["lophn doctor로 연결과 credential을 확인한다"],
          })
          : problemTool(toolName, resolved.route, callArgs, context);
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
      // 전용 실행이 없는 tool은 주입된 runner만 부른다. 없으면 준비 안 됨이다.
      if (runner === undefined) {
        return Promise.resolve({
          summary: "tool 실행 준비가 안 됐다",
          data: { tool: toolName, op, connected: true },
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

// 설치 묶음의 helper다. 이 entry는 `<설치 root>/platform/apps/mcp/main.ts`라 설치 root는 세 단계 위다.
// 이 경로가 `--allow-run` 하나이자 loader identity다(platform 3.1).
const INSTALLED_HELPER = new URL("../../../lophn-credential", import.meta.url)
  .pathname;

function scrubKnown(
  known: ReturnType<typeof createKnownSecretRegistry>,
  text: string,
): string {
  let out = text;
  for (let hit = known.match(out); hit !== undefined; hit = known.match(out)) {
    out = out.slice(0, hit.index) + REDACTION_REPLACEMENT +
      out.slice(hit.index + hit.length);
  }
  return out;
}

function readTextOrUndefined(path: string): string | undefined {
  try {
    return Deno.readTextFileSync(path);
  } catch {
    return undefined;
  }
}

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
    "LOPHN_HOME",
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
