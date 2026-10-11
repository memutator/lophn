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
  type ConnectionId,
  connectionShow,
  type HarnessId,
  HUMAN_ONLY_NAMES,
  type IntegrationTarget,
  LOPHN_CONNECTION,
} from "../../packages/contracts/coding-agent/mod.ts";
import {
  connectionFromRef,
  type CoreClient,
  UNREADABLE_MESSAGE,
} from "../../packages/coding-agent/connection/client/core.ts";
import { uploadPrepareBytes } from "../../packages/coding-agent/connection/mod.ts";
import { createSdkSourcePort } from "../../packages/coding-agent/connection/sdk-source.ts";
import {
  systemExecPort,
  systemFilesPort,
} from "../../packages/coding-agent/harnesses/system-ports.ts";
import {
  type CommandOutput,
  connectionRevokeGuide,
  humanDecisionGuide,
  runConnectionInstall,
} from "../../packages/coding-agent/cli/commands/connection.ts";
import { runApp } from "../../packages/coding-agent/cli/commands/app.ts";
import { runApprovalOpen } from "../../packages/coding-agent/cli/commands/approval.ts";
import {
  type DaemonLogFiles,
  type DaemonPort,
  runDaemon,
} from "../../packages/coding-agent/cli/commands/daemon.ts";
import {
  type HarnessWriteName,
  runHarnessDetect,
  runHarnessInspect,
  runHarnessList,
  runHarnessWrite,
} from "../../packages/coding-agent/cli/commands/harness-run.ts";
import { mcpConfigOf } from "../../packages/coding-agent/cli/commands/mcp.ts";
import {
  doctorOf,
  doctorSummary,
} from "../../packages/coding-agent/cli/commands/doctor.ts";
import {
  isProblemHumanOnly,
  problemHumanOnly,
  runProblem,
} from "../../packages/coding-agent/cli/commands/problem.ts";
import { runQuestionOpen } from "../../packages/coding-agent/cli/commands/question.ts";
import { runSave } from "../../packages/coding-agent/cli/commands/save.ts";
import { runSdk } from "../../packages/coding-agent/cli/commands/sdk.ts";
import {
  runSessionObserve,
  runSessionPlan,
  runSessionSummary,
} from "../../packages/coding-agent/cli/commands/session.ts";
import {
  runTicketWrite,
  ticketHumanOnly,
  type TicketWriteName,
} from "../../packages/coding-agent/cli/commands/ticket.ts";
import {
  runSkillsInstall,
  runSkillsList,
} from "../../packages/coding-agent/cli/commands/skills.ts";
import { findCommand } from "../../packages/coding-agent/cli/registry.ts";
import {
  installSkills,
  loadDistribution,
  syncTools,
} from "../../packages/coding-agent/guides/mod.ts";
import {
  catalogOf,
  detectHarnesses,
  detectionCacheOf,
  type DetectPorts,
  discover,
  filePort,
  inspectIntegration,
  type Inspection,
  installSelected,
  integrationsStore,
  launchOf,
  LOPHN_SKILL_NAMES,
  NATIVE_ENVIRONMENT,
  planSelected,
  removeSelected,
  stdioMcpProbe,
  updateSelected,
} from "../../packages/coding-agent/harnesses/mod.ts";
import {
  daemonStart,
  daemonStatus,
  daemonStop,
  readRunMetadata,
} from "../../packages/platform/install-and-update/mod.ts";
import { appDirectSocketPaths } from "../../packages/contracts/apps/mod.ts";
import { documentSectionHistory } from "../../packages/contracts/documents/mod.ts";
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
  // 앱 direct socket 자리의 폴더다(apps runtime과 같은 규칙). 모르면 undefined이고 설치하는 MCP에는 앱
  // direct socket 권한이 없다.
  appSocketDir?: string;
  now(): string;
  // hook payload를 읽는 눈이다. 없으면 process stdin이다(`session observe`만 읽는다).
  stdin?: () => Promise<string>;
  // 시험이 끼우는 눈이다. 없으면 실제 파일·process·platform daemon 판정을 쓴다.
  ports?: Partial<CliPorts>;
};

export type CliPorts = {
  detect: DetectPorts;
  daemon: DaemonPort;
  daemonLogs: DaemonLogFiles;
  launch(
    decision: { executable: string; argv: readonly string[] },
  ): Promise<Result<void, LophnError>>;
  // 관측 socket에 NDJSON을 쓴다. observation 전용이라 credential을 싣지 않는다.
  observe(path: string, ndjson: string): Promise<Result<void, LophnError>>;
};

// hook payload 상한이다(조사 T6의 body 64KiB 제안). 넘으면 읽지 않는다.
const OBSERVE_STDIN_LIMIT = 64 * 1024;

async function readProcessStdin(): Promise<string> {
  if (Deno.stdin.isTerminal()) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of Deno.stdin.readable) {
    size += chunk.length;
    if (size > OBSERVE_STDIN_LIMIT) return "";
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

async function writeObserveSocket(
  path: string,
  ndjson: string,
): Promise<Result<void, LophnError>> {
  try {
    const connection = await Deno.connect({ transport: "unix", path });
    try {
      await connection.write(new TextEncoder().encode(ndjson));
    } finally {
      connection.close();
    }
    return ok(undefined);
  } catch {
    return err({
      code: "unavailable",
      message: "관측 socket에 쓰지 못했다",
    });
  }
}

// 실제 눈이다. platform의 instance lock·위치 metadata 판정을 그대로 쓰고 detect는 PATH와 catalog
// fallback만 읽는다.
function defaultPorts(runtime: CliRuntime): CliPorts {
  const home = runtime.home ?? "";
  const dataRoot = runtime.dataRoot ?? `${home}/.lophn`;
  const runDir = `${dataRoot}/run`;
  const root = runtime.installRoot.replace(/\/$/, "");
  const executable = `${root}/lophn-desktop`;
  const probeEnv: Record<string, string> = {};
  for (const name of ["PATH", "HOME"]) {
    const value = runtime.env.get(name);
    if (value !== undefined) probeEnv[name] = value;
  }
  return {
    detect: {
      files: systemFilesPort(),
      execFor: (classifier) => systemExecPort(classifier, probeEnv),
      path: runtime.env.get("PATH"),
      home,
    },
    daemon: {
      start() {
        const decision = daemonStart(dataRoot, executable);
        return Promise.resolve(
          decision.ok
            ? ok({ executable, argv: decision.value.argv })
            : decision,
        );
      },
      startFail: (error) => Promise.resolve(err(error)),
      stop() {
        const decision = daemonStop(dataRoot, executable);
        return Promise.resolve(
          decision.ok
            ? ok({ executable, argv: decision.value.argv })
            : decision,
        );
      },
      stopFail: (error) => Promise.resolve(err(error)),
      status: () => daemonStatus(runDir),
      async runMetadata() {
        const read = await readRunMetadata(runDir);
        return read.ok
          ? ok({
            api_port: read.value.api_port,
            core_epoch: read.value.core_epoch,
            started_at: read.value.started_at,
          })
          : read;
      },
    },
    daemonLogs: {
      paths: () =>
        [0, 1, 2, 3, 4].map((index) =>
          `${dataRoot}/logs/platform-${index}.jsonl`
        ),
    },
    observe: writeObserveSocket,
    launch(decision) {
      try {
        const child = new Deno.Command(decision.executable, {
          args: [...decision.argv],
          env: { LOPHN_HOME: dataRoot },
          stdin: "null",
          stdout: "null",
          stderr: "null",
        }).spawn();
        child.unref();
        return Promise.resolve(ok(undefined));
      } catch {
        return Promise.resolve(err({
          code: "unavailable",
          message: "launcher를 띄우지 못했다(실행 권한 또는 설치 묶음)",
        }));
      }
    },
  };
}

function portsOf(runtime: CliRuntime): CliPorts {
  return { ...defaultPorts(runtime), ...runtime.ports };
}

// 앱 runtime이 정하는 socket 폴더다(apps-control의 appSocketRoot와 같은 규칙: XDG runtime 아래
// `lophn`, 없으면 임시 폴더의 `lophn-<uid>`). 읽을 수 없으면 undefined다.
export function appSocketDirOf(
  env: { get(name: string): string | undefined },
  uid: () => number | null,
): string | undefined {
  const xdg = env.get("XDG_RUNTIME_DIR");
  if (xdg !== undefined && xdg.length > 0) return `${xdg}/lophn`;
  const id = uid();
  return id === null ? undefined : `${env.get("TMPDIR") ?? "/tmp"}/lophn-${id}`;
}

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

// receipt·journal 폴더다. data root `H`의 `integrations`이고 launcher가 이 폴더 하나만 쓰기로 연다.
function integrationsDirOf(runtime: CliRuntime): string {
  const root = runtime.dataRoot ?? `${runtime.home ?? ""}/.lophn`;
  return `${root.replace(/\/$/, "")}/integrations`;
}

function storeOf(runtime: CliRuntime) {
  return integrationsStore(integrationsDirOf(runtime));
}

// `lophn doctor`와 설치가 쓰는 launch 입력이다. 모두 설치 묶음 기준 절대 경로다.
function launchInputs(runtime: CliRuntime, target: IntegrationTarget) {
  return launchBase(
    runtime,
    target.scope_kind === "app" ? target.app_realpath : runtime.cwd,
  );
}

function launchBase(runtime: CliRuntime, submissionRoot: string) {
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
    submissionRoot,
    coreAddress: url.host,
    appAddresses: [] as string[],
    appSockets: runtime.appSocketDir === undefined
      ? []
      : appDirectSocketPaths(runtime.appSocketDir),
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
  if (name === "connection create") return ok(humanDecisionGuide(name));
  if (name === "connection revoke") {
    return ok(connectionRevokeGuide(
      input as { connection: ConnectionId; base_revision: string },
    ));
  }
  if (name === "ticket create" || name === "ticket cancel") {
    // 사람 전용이다. 연결 참조(coding credential)가 있으면 실행 전 거절이고, 사람은 결정 화면
    // 링크를 받는다(cli#R37, 질문 Q1).
    return ticketHumanOnly(name, input, {
      actor: runtime.actor,
      connected: runtime.client !== undefined,
    });
  }
  if (isProblemHumanOnly(name)) {
    // 사람 전용이다. CLI는 feedback·수리 요청·확인·무시를 접수하지 않는다. 연결 참조(coding
    // credential)가 있으면 실행 전 거절이고, 사람은 결정 화면 링크와 대기 사실만 받는다(D27, cli#R7, R35).
    return problemHumanOnly(name, input, {
      actor: runtime.actor,
      connected: runtime.client !== undefined,
    });
  }
  if (name === "ticket claim") {
    // claim은 MCP의 `lophn_ticket`에만 둔다. CLI는 안내만 한다(cli#R41, mcp#R27).
    return ok({
      summary: `${name}은 MCP 연결에서만 한다`,
      data: { command: name, mcp_only: true },
      next: [
        "MCP의 lophn_ticket으로 claim한다. CLI는 지정 ticket 읽기·갱신·반납·완료 보고를 한다",
      ],
      isError: true,
    });
  }
  if (
    (HUMAN_ONLY_NAMES as readonly string[]).includes(name) &&
    runtime.actor !== "user"
  ) {
    // 관리 쓰기·daemon 시작·중지는 coding credential context에서 실행 전 거절이다(cli#R6, R40).
    return err({
      code: "forbidden",
      message: "이 command는 사람 전용이다",
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
            store: storeOf(runtime),
          }),
      },
    );
  }
  if (name === "doctor") return await runDoctor(input, runtime);
  if (name === "mcp config") return mcpConfig(input, runtime);
  if (name.startsWith("daemon ")) {
    return await runDaemonCommand(name, input, runtime);
  }
  if (name === "harness list") return ok(runHarnessList());
  if (name.startsWith("harness ")) {
    return await runHarness(name, input, runtime);
  }
  if (name === "skills list") {
    return await runSkillsList({ distribution: () => loadDistribution() });
  }
  if (name === "skills install") {
    return await runSkillsInstall(
      input as Parameters<typeof runSkillsInstall>[0],
      {
        actor: runtime.actor,
        distribution: () => loadDistribution(),
        async install(request) {
          const loaded = await loadDistribution();
          if (!loaded.ok) return loaded;
          // skill만 설치하므로 연결 참조는 없어도 되고 launch의 connection은 쓰이지 않는다.
          const connection = typeof input.connection === "string"
            ? input.connection
            : runtime.env.get(LOPHN_CONNECTION) ?? "";
          return await installSkills({
            target: request.target,
            names: request.names,
            skills: loaded.value.skills,
            roots: {
              home: runtime.home ?? "",
              env: runtime.env,
              cwd: runtime.cwd,
            },
            launch: launchOf({
              ...launchInputs(runtime, request.target),
              connection,
              toolsets: "core,app",
            }),
            connection: connection === "" ? null : connection,
            operationId: request.operationId,
            now: runtime.now(),
          }, { files: filePort(), store: storeOf(runtime) });
        },
      },
    );
  }
  if (name === "session plan") {
    return await runSessionPlanCommand(input, runtime);
  }
  if (name === "session observe") {
    // core·credential을 읽지 않고 socket에만 쓴다. coding credential context(LOPHN_CONNECTION 환경)의 TUI도 부른다.
    return await runSessionObserve(input as { hook: HarnessId }, {
      env: runtime.env,
      stdin: runtime.stdin ?? readProcessStdin,
      now: runtime.now,
      send: portsOf(runtime).observe,
    });
  }
  if (name === "session summary") {
    // 소유 읽기 route `/v1/coding_agent_sessions/summary` 하나다. 연결이 없으면 일반 summary는 거절이고
    // hook은 빈 값이다(guides#R24).
    return await runSessionSummary(
      input as Parameters<typeof runSessionSummary>[0],
      { client },
    );
  }
  if (name.startsWith("session ")) return unwired(name);
  if (client === undefined) return connectionRequired();
  // 같은 호출을 다시 확인할 수 있게 사람이 준 key를 그대로 쓴다. 없으면 호출마다 새 key다.
  const idempotency = () =>
    typeof input.idempotency_key === "string"
      ? input.idempotency_key
      : `cli-${crypto.randomUUID()}`;
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
  if (name === "question open") {
    const opened = await runQuestionOpen(input as { group: string }, {
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
      {
        client,
        idempotencyKey: idempotency,
        // 도구 재배포(guides#R17)는 파일 설치라 core route 밖이다. 검사한 op 입력의
        // target·names와 연결 참조로 guides의 syncTools를 돌린다(cli#R29).
        sync: async (opInput) => {
          const ref = typeof opInput.connection === "string"
            ? opInput.connection
            : runtime.env.get(LOPHN_CONNECTION) ?? "";
          const target = opInput.target as IntegrationTarget | undefined;
          if (target === undefined) {
            return Promise.resolve(
              err({
                code: "invalid_input",
                message: "재배포 대상 target이 필요하다(--target)",
              }),
            );
          }
          const loaded = await loadDistribution();
          if (!loaded.ok) return loaded;
          return syncTools({
            target,
            ...(Array.isArray(opInput.names)
              ? { names: opInput.names as string[] }
              : {}),
            skills: loaded.value.skills,
            roots: {
              home: runtime.home ?? "",
              env: runtime.env,
              cwd: runtime.cwd,
            },
            launch: launchOf({
              ...launchInputs(runtime, target),
              connection: ref,
              toolsets: "core,app",
            }),
            connection: ref === "" ? null : ref,
            operationId: idempotency(),
            now: runtime.now(),
          }, { files: filePort(), store: storeOf(runtime) });
        },
      },
    );
    return ran.ok ? ok(ran.value) : ran;
  }
  if (
    name === "ticket renew" || name === "ticket release" ||
    name === "ticket report"
  ) {
    const ran = await runTicketWrite(name as TicketWriteName, input, {
      client,
      idempotencyKey: idempotency,
    });
    return ok(ran);
  }
  if (name.startsWith("problem ")) {
    // 읽기·record-fix·reproduction test·첨부 열기다. MCP `lophn_problem`과 같은 흐름이다(cli#R33, R34).
    const connection = connectionFromRef(
      typeof input.connection === "string"
        ? input.connection
        : runtime.env.get(LOPHN_CONNECTION),
    );
    return await runProblem(
      name as Parameters<typeof runProblem>[0],
      input,
      {
        client,
        idempotencyKey: idempotency,
        now: runtime.now,
        ...(connection.ok ? { connection: connection.value } : {}),
      },
    );
  }
  if (name.startsWith("sdk ")) {
    // `apply`는 앱 source의 deno.json·deno.lock만 정확한 경로 권한으로 쓰는 CLI 전용 port다. MCP에는
    // 이 port가 없고 권한이 없으면 unavailable이다.
    const ran = await runSdk(name as Parameters<typeof runSdk>[0], input, {
      client,
      source: createSdkSourcePort({
        denoExecutable: `${runtime.installRoot.replace(/\/$/, "")}/deno`,
      }),
    });
    return ok(ran);
  }
  // 나머지는 command 표의 소유 읽기 route 하나로만 보낸다(cli#R1). 표 밖 op는 실행 전 거절이다.
  const op = typeof input.op === "string" ? input.op : undefined;
  // `document history`는 section을 주면 그 key의 판별 변화 route다(MCP `lophn_document history`와 같다).
  const route: Route | undefined =
    name === "document history" && typeof input.section === "string"
      ? documentSectionHistory
      : op === undefined
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

// `lophn session plan`: shell main이 클릭을 검증하며 넘긴 값으로 시작 계획을 낸다. core를 읽지 않고
// (ticket·connection 현재 사실은 입력의 facts) 저장한 감지와 지금 본 실행 파일만 쓴다. process를 열지 않는다.
async function runSessionPlanCommand(
  input: Record<string, unknown>,
  runtime: CliRuntime,
): Promise<Result<CommandOutput, LophnError>> {
  const ports = portsOf(runtime);
  const home = runtime.home ?? "";
  return await runSessionPlan(
    input as Parameters<typeof runSessionPlan>[0],
    {
      async detect() {
        const detected = await detectHarnesses(
          "detect",
          ports.detect,
          detectionCacheOf(home, filePort(), integrationsDirOf(runtime)),
          runtime.now(),
        );
        return detected.ok ? ok(detected.value.detections) : detected;
      },
      current(harness) {
        const definition = catalogOf(harness);
        if (definition === undefined) {
          return err({ code: "invalid_input", message: "알 수 없는 제품이다" });
        }
        const found = discover(
          definition,
          { environment: NATIVE_ENVIRONMENT, profile_id: null },
          ports.detect,
        );
        return found.ok ? ok({ selected: found.value.selected }) : found;
      },
    },
  );
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
    store: storeOf(runtime),
    daemon: { status: () => portsOf(runtime).daemon.status() },
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

function connectionReader(client: CoreClient | undefined) {
  return {
    async read(
      id: string,
    ): Promise<Result<{ state: "active" | "revoked" }, LophnError>> {
      if (client === undefined) return connectionRequired();
      const shown = await client.read(connectionShow, { connection: id });
      if (!shown.ok) return shown;
      const state = (shown.value as { connection?: { state?: string } })
        .connection?.state;
      return state === "active" || state === "revoked"
        ? ok({ state })
        : err({ code: "unavailable", message: "연결 상태를 읽지 못했다" });
    },
  };
}

// `lophn mcp config`: 설정 조각만 낸다. 제품 설정 파일은 읽지도 쓰지도 않는다(cli#R9).
function mcpConfig(
  input: Record<string, unknown>,
  runtime: CliRuntime,
): Result<CommandOutput, LophnError> {
  const request = input as Parameters<typeof mcpConfigOf>[0];
  // 설정 조각에는 운영 data 위치(daemon 위치 파일)를 싣지 않는다(cli#R9).
  const made = mcpConfigOf(request, {
    ...launchBase(runtime, runtime.cwd),
    discoveryFiles: [],
  });
  return made.ok
    ? ok({
      summary:
        `${request.target}의 MCP 설정 조각이다. 설정 파일은 바꾸지 않았다`,
      data: made.value,
      next: ["조각을 기존 설정과 비교해 사람이 넣는다"],
    })
    : made;
}

async function runDaemonCommand(
  name: string,
  input: Record<string, unknown>,
  runtime: CliRuntime,
): Promise<Result<CommandOutput, LophnError>> {
  const ports = portsOf(runtime);
  const ran = await runDaemon(
    name as Parameters<typeof runDaemon>[0],
    strip(input) as Parameters<typeof runDaemon>[1],
    {
      actor: runtime.actor,
      port: ports.daemon,
      logs: ports.daemonLogs,
      launch: ports.launch,
    },
  );
  return ran;
}

// 사람이 고른 target 하나만 다룬다. 감지된 다른 제품은 읽지도 쓰지도 않는다(harnesses#R6).
async function runHarness(
  name: string,
  input: Record<string, unknown>,
  runtime: CliRuntime,
): Promise<Result<CommandOutput, LophnError>> {
  const ports = portsOf(runtime);
  const home = runtime.home ?? "";
  const files = filePort();
  const store = storeOf(runtime);
  const client = runtime.client;
  const connections = connectionReader(client);
  const deps = {
    actor: runtime.actor,
    connections,
    detect: (mode: "detect" | "refresh") =>
      detectHarnesses(
        mode,
        ports.detect,
        detectionCacheOf(home, files, integrationsDirOf(runtime)),
        runtime.now(),
      ),
    async inspect(
      harness: IntegrationTarget["harness_id"],
    ): Promise<Result<Inspection, LophnError>> {
      const target: IntegrationTarget = {
        scope_kind: "user",
        environment: NATIVE_ENVIRONMENT,
        profile_id: null,
        harness_id: harness,
        app: null,
        app_realpath: null,
      };
      const definition = catalogOf(harness);
      if (definition === undefined) {
        return err({ code: "invalid_input", message: "알 수 없는 제품이다" });
      }
      const id = typeof input.connection === "string"
        ? input.connection
        : runtime.env.get(LOPHN_CONNECTION) ?? null;
      let connection: Parameters<typeof inspectIntegration>[0]["connection"] =
        null;
      if (id !== null) {
        const read = await connections.read(id);
        connection = { id, state: read.ok ? read.value.state : "unknown" };
      }
      return ok(
        await inspectIntegration({
          definition,
          target,
          roots: { home, env: runtime.env, cwd: runtime.cwd },
          denoExecutable: `${runtime.installRoot.replace(/\/$/, "")}/deno`,
          expectedTools: ["lophn_index", "lophn_read"],
          expectedSkills: LOPHN_SKILL_NAMES,
          connection,
          now: runtime.now(),
        }, {
          files,
          mcp: stdioMcpProbe({ ambient: (key) => runtime.env.get(key) }),
          store,
        }),
      );
    },
    write(
      action: HarnessWriteName,
      request: {
        connection: string;
        target: IntegrationTarget;
        components: readonly string[];
        operationId: string;
      },
    ) {
      const base = {
        target: request.target,
        connection: request.connection,
        launch: launchOf({
          ...launchInputs(runtime, request.target),
          connection: request.connection,
          toolsets: "core,app",
        }),
        version: null,
        roots: { home, env: runtime.env, cwd: runtime.cwd },
        operationId: request.operationId,
        now: runtime.now(),
        components: request.components,
      };
      const apply = action === "harness plan"
        ? planSelected
        : action === "harness update"
        ? updateSelected
        : action === "harness remove"
        ? removeSelected
        : installSelected;
      return apply(base, { files, store });
    },
  };
  if (name === "harness detect" || name === "harness refresh") {
    return await runHarnessDetect(
      name === "harness refresh" ? "refresh" : "detect",
      deps,
    );
  }
  if (name === "harness inspect") {
    return await runHarnessInspect(input as { harness?: never }, deps);
  }
  return await runHarnessWrite(
    name as HarnessWriteName,
    input as Parameters<typeof runHarnessWrite>[1],
    deps,
  );
}
