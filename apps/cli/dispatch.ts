// lophn CLI의 실행 조립이다(code-map). command 표(`registry.ts`)의 route와 같은 core client로
// command를 실행한다. 업무 규칙을 두지 않고 MCP와 같은 credential provider·client·runner를 잇기만 한다
// (cli#R1, connection#R6). 표 밖 op와 임의 core API passthrough는 없다. 실행하지 못하는 command는 성공으로
// 꾸미지 않고 unavailable로 낸다. 사람 전용 command는 연결 참조(LOPHN_CONNECTION)로 시작한
// coding credential context에서 거절한다(cli#R40).
import {
  err,
  type LophnError,
  ok,
  type Result,
} from "../../packages/base/mod.ts";
import {
  connectionShow,
  type IntegrationTarget,
  LOPHN_CONNECTION,
} from "../../packages/contracts/coding-agent/mod.ts";
import {
  type CoreClient,
  UNREADABLE_MESSAGE,
} from "../../packages/coding-agent/connection/client/core.ts";
import { uploadPrepareBytes } from "../../packages/coding-agent/connection/mod.ts";
import {
  type CommandOutput,
  humanDecisionGuide,
  runConnectionInstall,
} from "../../packages/coding-agent/cli/commands/connection.ts";
import { runApp } from "../../packages/coding-agent/cli/commands/app.ts";
import { runApprovalOpen } from "../../packages/coding-agent/cli/commands/approval.ts";
import { runContextPropose } from "../../packages/coding-agent/cli/commands/context.ts";
import {
  doctorOf,
  doctorSummary,
} from "../../packages/coding-agent/cli/commands/doctor.ts";
import { runQuestionOpen } from "../../packages/coding-agent/cli/commands/question.ts";
import { runSave } from "../../packages/coding-agent/cli/commands/save.ts";
import { runSdk } from "../../packages/coding-agent/cli/commands/sdk.ts";
import { findCommand } from "../../packages/coding-agent/cli/registry.ts";
import {
  filePort,
  installSelected,
  launchOf,
  stdioMcpProbe,
  storeOf,
} from "../../packages/coding-agent/harnesses/mod.ts";
import type { Route } from "../../packages/contracts/platform/mod.ts";
import type { CredentialProvider } from "../../packages/coding-agent/connection/credential/provider.ts";

// 공통 option(출력·연결·daemon·CAS·key·입력 source)은 route 입력이 아니다.
const COMMON_KEYS = new Set([
  "command",
  "json",
  "connection",
  "daemon_url",
  "app",
  "base_revision",
  "idempotency_key",
  "input",
  "input_file",
  "op",
]);

export type CliRuntime = {
  // 연결 참조가 없으면 undefined다. core를 부르는 command는 연결 참조가 필요하다.
  client: CoreClient | undefined;
  provider: CredentialProvider;
  // LOPHN_CONNECTION 환경이 있으면 coding credential context다(관리 쓰기를 거절한다).
  actor: "user" | "coding_agent";
  cwd: string;
  dataRoot: string | undefined;
  env: { get(name: string): string | undefined };
  home: string | undefined;
  // 설치 묶음의 위치다. 이 entry는 `<설치 root>/platform/apps/cli/main.ts`다.
  installRoot: string;
  daemonUrl: string;
  now(): string;
};

export function ambientEnv(): { get(name: string): string | undefined } {
  return {
    get(name) {
      try {
        return Deno.env.get(name);
      } catch {
        return undefined;
      }
    },
  };
}

export function actorOf(
  env: { get(name: string): string | undefined },
): "user" | "coding_agent" {
  return env.get(LOPHN_CONNECTION) === undefined ? "user" : "coding_agent";
}

function strip(input: Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && !COMMON_KEYS.has(key)) rest[key] = value;
  }
  return rest;
}

function unwired(name: string): Result<CommandOutput, LophnError> {
  return err({
    code: "unavailable",
    message: `${name}의 실행은 이 설치에서 아직 연결되지 않았다`,
  });
}

function connectionRequired(): Result<never, LophnError> {
  return err({
    code: "invalid_input",
    message: "연결 참조가 필요하다(--connection 또는 LOPHN_CONNECTION)",
  });
}

// `lophn doctor`와 설치가 쓰는 launch 입력이다. 모두 설치 묶음 기준 절대 경로다.
function launchInputs(runtime: CliRuntime, target: IntegrationTarget) {
  const root = runtime.installRoot.replace(/\/$/, "");
  const url = new URL(runtime.daemonUrl);
  return {
    executable: `${root}/deno`,
    resources: `${root}/platform`,
    cache: runtime.env.get("DENO_DIR") ??
      `${runtime.home ?? ""}/.cache/lophn/deno`,
    discoveryFiles: runtime.dataRoot === undefined
      ? []
      : [`${runtime.dataRoot}/run/location.json`],
    submissionRoot: target.scope_kind === "app"
      ? target.app_realpath
      : runtime.cwd,
    coreAddress: url.host,
    appAddresses: [] as string[],
    credentialHelper: `${root}/lophn-credential`,
  };
}

export async function runCliCommand(
  name: string,
  input: Record<string, unknown>,
  runtime: CliRuntime,
): Promise<Result<CommandOutput, LophnError>> {
  const entry = findCommand(name);
  if (entry === undefined) {
    return err({
      code: "invalid_input",
      message: `지원하지 않는 command다: ${name}`,
    });
  }
  if (name === "connection create" || name === "connection revoke") {
    return ok(humanDecisionGuide(name));
  }
  if (name.startsWith("ticket ") && entry.monoRoute === undefined) {
    // claim·renew·release·report는 MCP의 `lophn_ticket`에만 둔다. CLI는 안내만 한다(mcp#R27).
    return ok({
      summary: `${name}은 MCP 연결에서만 한다`,
      data: { command: name, mcp_only: true },
      next: [
        "MCP의 lophn_ticket으로 claim·보고한다. CLI는 지정 ticket 읽기만 한다",
      ],
      isError: true,
    });
  }
  const client = runtime.client;
  if (name === "connection install") {
    const { client: core } = runtime;
    return await runConnectionInstall(
      input as { connection?: string; target: IntegrationTarget },
      {
        actor: runtime.actor,
        connections: {
          async read(id) {
            if (core === undefined) return connectionRequired();
            const shown = await core.read(connectionShow, { connection: id });
            if (!shown.ok) return shown;
            const state = (shown.value as { connection?: { state?: string } })
              .connection?.state;
            return state === "active" || state === "revoked"
              ? ok({ state })
              : err({
                code: "unavailable",
                message: "연결 상태를 읽지 못했다",
              });
          },
        },
        install: (connection, target) =>
          installSelected({
            target,
            connection,
            launch: launchOf({
              ...launchInputs(runtime, target),
              connection,
              toolsets: "core,app",
            }),
            version: null,
            roots: {
              home: runtime.home ?? "",
              env: runtime.env,
              cwd: runtime.cwd,
            },
            operationId: `cli-${crypto.randomUUID()}`,
            now: runtime.now(),
          }, {
            files: filePort(),
            store: storeOf(runtime.home ?? ""),
          }),
      },
    );
  }
  if (name === "doctor") return await runDoctor(input, runtime);
  if (client === undefined) return connectionRequired();
  const idempotency = () => `cli-${crypto.randomUUID()}`;
  if (name === "save") {
    const scope = {
      root: runtime.cwd,
      forbidden: runtime.dataRoot === undefined ? [] : [runtime.dataRoot],
    };
    const saved = await runSave(
      entry.input.parse({ command: name, ...input }) as Parameters<
        typeof runSave
      >[0],
      { client, scope, prepareBytes: uploadPrepareBytes(client) },
    );
    return saved.ok ? ok(saved.value) : saved;
  }
  if (name === "context propose") {
    const proposed = await runContextPropose(
      input as Parameters<typeof runContextPropose>[0],
      { client, prepareBytes: uploadPrepareBytes(client) },
    );
    return proposed.ok ? ok(proposed.value) : proposed;
  }
  if (name === "question open") {
    const opened = await runQuestionOpen(input as { question: string }, {
      client,
    });
    return opened.ok ? ok(opened.value) : opened;
  }
  if (name === "approval open") {
    const opened = await runApprovalOpen(input as { approval: string }, {
      client,
    });
    return opened.ok ? ok(opened.value) : opened;
  }
  if (name.startsWith("app ")) {
    const ran = await runApp(
      name as Parameters<typeof runApp>[0],
      input,
      { client, idempotencyKey: idempotency },
    );
    return ran.ok ? ok(ran.value) : ran;
  }
  if (name.startsWith("sdk ")) {
    // 앱 source 쓰기 port는 이 실행 권한에 없다(apply는 unavailable).
    const ran = await runSdk(name as Parameters<typeof runSdk>[0], input, {
      client,
    });
    return ok(ran);
  }
  // 나머지는 command 표의 소유 읽기 route 하나로만 보낸다(cli#R1). 표 밖 op는 실행 전 거절이다.
  const op = typeof input.op === "string" ? input.op : undefined;
  const route: Route | undefined = op === undefined
    ? entry.monoRoute
    : entry.opRoutes?.[op];
  if (
    route === undefined || (route.kind !== "read" && route.kind !== "worker")
  ) {
    return unwired(name);
  }
  const read = await client.read(route, strip(input));
  if (!read.ok) {
    // 없는 대상과 범위 밖 대상은 같은 답이다(connection#R5).
    return read.error.code === "not_found"
      ? err({ code: "not_found", message: UNREADABLE_MESSAGE })
      : read;
  }
  return ok({ summary: `${name} 결과`, data: read.value, next: [] });
}

async function runDoctor(
  input: Record<string, unknown>,
  runtime: CliRuntime,
): Promise<Result<CommandOutput, LophnError>> {
  const connection = typeof input.connection === "string"
    ? input.connection
    : runtime.env.get(LOPHN_CONNECTION) ?? null;
  const target = input.target as IntegrationTarget | undefined;
  const client = runtime.client;
  const home = runtime.home ?? "";
  const report = await doctorOf({
    ...(target === undefined ? {} : { target }),
    connection,
    roots: { home, env: runtime.env, cwd: runtime.cwd },
    denoExecutable: `${runtime.installRoot.replace(/\/$/, "")}/deno`,
    now: runtime.now(),
    expectedTools: ["lophn_index", "lophn_read"],
  }, {
    files: filePort(),
    mcp: stdioMcpProbe({ ambient: (key) => runtime.env.get(key) }),
    store: storeOf(home),
    daemon: {
      // 실행 중 daemon 판정은 이 command가 읽지 못한다. 알 수 없음으로 둔다.
      status: () =>
        Promise.resolve(
          err({ code: "unavailable", message: "daemon 상태를 읽지 못했다" }),
        ),
    },
    connections: {
      async read(id) {
        if (client === undefined) return connectionRequired();
        const shown = await client.read(connectionShow, { connection: id });
        if (!shown.ok) return shown;
        const state = (shown.value as { connection?: { state?: string } })
          .connection?.state;
        return state === "active" || state === "revoked"
          ? ok({ state })
          : err({ code: "unavailable", message: "연결 상태를 읽지 못했다" });
      },
    },
    credential: {
      async available(id) {
        const received = await runtime.provider(id as never);
        return received.ok ? "available" : received.error;
      },
    },
  });
  if (!report.ok) return report;
  const summary = doctorSummary(report.value);
  return ok({
    summary: summary.summary,
    data: report.value,
    next: summary.next,
  });
}
