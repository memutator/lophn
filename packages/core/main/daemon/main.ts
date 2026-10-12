import { codingAgentConnectionDefinitions } from "../../server/identity/coding-connection.ts";
import { type Core, startCore } from "./core.ts";
import { createLedgerRegistration as createAppsRegistration } from "../../apps/register.ts";
import { createLedgerRegistration } from "../../projects/register.ts";
import {
  createLedgerRegistration as createLophnAgentRegistration,
  lophnAgentDefinitions,
} from "../../lophn-agent/register.ts";
import {
  createLedgerRegistration as createProblemsRegistration,
  problemsReportDefinitions,
  problemsTestDefinitions,
} from "../../problems/register.ts";
import { ticketDefinitions } from "../../apps/tickets/register.ts";
import { createCoreRegistration as createTicketPortsRegistration } from "../../apps/tickets/ports.ts";
import { productKeychain } from "../../secrets/store.ts";
import {
  credentialLoaderIdentity,
  serveCredentialSocket,
} from "../../install-and-update/mod.ts";

// 최상위 팀마다 등록 파일 하나. main은 이 목록만 부른다.
const TEAMS = [
  { createLedgerRegistration },
  { createLedgerRegistration: createAppsRegistration },
  { problemsTestDefinitions },
  { problemsReportDefinitions },
  { createLedgerRegistration: createProblemsRegistration },
  { codingAgentConnectionDefinitions },
  { lophnAgentDefinitions },
  { createLedgerRegistration: createLophnAgentRegistration },
  { ticketDefinitions },
  { createCoreRegistration: createTicketPortsRegistration },
];

const portArg = Deno.args.find((arg) => arg.startsWith("--port="));
const port = portArg === undefined ? undefined : Number(portArg.slice(7));

// Electron main이 물려 준 pipe. 터미널에서 직접 띄우면(stdin이 터미널) 신호로만 끝난다.
const parent = Deno.stdin.isTerminal()
  ? undefined
  : { stdin: Deno.stdin.readable, stdout: Deno.stdout.writable };

// 확인한 backup 복원은 이 core를 멈춘다. 복원이 끝나면 같은
// data root로 다시 시작해 새 epoch·새 ledger_id·새 hello로 이어 간다. 복원이 실패해도 현재
// 자료는 그대로라 같은 방식으로 다시 시작한다. 시작이 실패하면 프로세스가 끝난다.
let core: Core | undefined;
// 보호 통로 socket은 core가 (재)시작할 때마다 열고 core가 멈추면 닫는다.
let closeCredentialSocket: () => Promise<void> = () => Promise.resolve();
const exitAfterShutdown = () =>
  void (core?.shutdown() ?? Promise.resolve()).then(() =>
    closeCredentialSocket()
  ).then(() => Deno.exit(0));
Deno.addSignalListener("SIGINT", exitAfterShutdown);
Deno.addSignalListener("SIGTERM", exitAfterShutdown);
for (;;) {
  const started = await startCore({
    port,
    // 제품 writer는 자기 system clock으로 커밋 시각을 따라간다.
    writerClock: "system",
    teams: TEAMS,
    // 앱 프로세스 감독(apps/supervisor)은 상시 신뢰 child다. 제품 기동만 띄운다.
    appSupervisor: true,
    // lophn agent runtime child도 상시 신뢰 child다. 제품 기동만 띄운다.
    agentRuntime: true,
    teamModules: [
      new URL("../../projects/register.ts", import.meta.url).href,
      new URL("../../apps/register.ts", import.meta.url).href,
      new URL("../../problems/register.ts", import.meta.url).href,
      new URL("../../server/identity/coding-connection.ts", import.meta.url)
        .href,
      new URL("../../lophn-agent/register.ts", import.meta.url).href,
      new URL("../../apps/tickets/register.ts", import.meta.url).href,
      new URL("../../apps/tickets/ports.ts", import.meta.url).href,
    ],
    parent,
    // coding agent connection credential은 OS keychain에 둔다. 보호 loader는 설치 묶음의 helper
    // `lophn-credential` 하나이고 identity는 그 고정 절대 경로다(Linux .deb. 다른 OS는 아직 없다).
    codingKeychain: productKeychain(),
    codingLoaders: [credentialLoaderIdentity()],
  });
  if (!started.ok) {
    console.error(`core: ${started.error.message}`);
    Deno.exit(1);
  }
  core = started.value;
  // 보호 통로: helper가 이어 주는 소유자 전용 unix socket(Linux). 열지 못해도 core는 시작하고,
  // coding credential 전달만 unavailable로 남는다.
  const credentialSocket = Deno.build.os === "linux" && core.codingCredentials
    ? await serveCredentialSocket({
      dataRoot: core.dataRoot,
      authority: core.codingCredentials.authority,
    })
    : undefined;
  if (credentialSocket !== undefined && !credentialSocket.ok) {
    console.error("core: credential socket unavailable");
  }
  closeCredentialSocket = () =>
    credentialSocket?.ok ? credentialSocket.value.close() : Promise.resolve();
  // 복원으로 멈춘 core만 다시 시작한다. 그 밖의 종료(stop·pipe EOF)는 여기서 끝난다.
  await core.done;
  await closeCredentialSocket();
  if (!core.restoreStopped()) break;
}
