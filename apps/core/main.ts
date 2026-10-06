import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { startCore } from "./core.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";
import { createLedgerRegistration } from "./documents.ts";
import {
  createLedgerRegistration as createLophnAgentRegistration,
  lophnAgentDefinitions,
} from "./lophn-agent.ts";
import {
  createLedgerRegistration as createProblemsRegistration,
  problemsReportDefinitions,
  problemsTestDefinitions,
} from "./problems.ts";
import { ticketDefinitions } from "./tickets.ts";
import { productKeychain } from "./secret-store.ts";
import {
  credentialLoaderIdentity,
  serveCredentialSocket,
} from "../../packages/platform/install-and-update/mod.ts";

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
];

const portArg = Deno.args.find((arg) => arg.startsWith("--port="));
const port = portArg === undefined ? undefined : Number(portArg.slice(7));

// Electron main이 물려 준 pipe. 터미널에서 직접 띄우면(stdin이 터미널) 신호로만 끝난다.
const parent = Deno.stdin.isTerminal()
  ? undefined
  : { stdin: Deno.stdin.readable, stdout: Deno.stdout.writable };

const started = await startCore({
  port,
  // 제품 writer는 자기 system clock으로 커밋 시각을 따라간다.
  writerClock: "system",
  teams: TEAMS,
  // 앱 프로세스 감독(apps/supervisor)은 상시 신뢰 child다. 제품 기동만 띄운다.
  appSupervisor: true,
  teamModules: [
    new URL("./documents.ts", import.meta.url).href,
    new URL("./apps.ts", import.meta.url).href,
    new URL("./problems.ts", import.meta.url).href,
    new URL("./coding-agent.ts", import.meta.url).href,
    new URL("./lophn-agent.ts", import.meta.url).href,
    new URL("./tickets.ts", import.meta.url).href,
  ],
  parent,
  // coding agent connection credential은 OS keychain에 둔다. 보호 loader는 설치 묶음의 helper
  // `lophn-credential` 하나이고 identity는 그 고정 절대 경로다(Linux .deb. 다른 OS는 platform#T49).
  codingKeychain: productKeychain(),
  codingLoaders: [credentialLoaderIdentity()],
});
if (!started.ok) {
  console.error(`core: ${started.error.message}`);
  Deno.exit(1);
}
const core = started.value;

// 보호 통로: helper가 이어 주는 소유자 전용 unix socket(Linux). 열지 못해도 core는 시작하고,
// coding credential 전달만 unavailable로 남는다(secrets#R12).
const credentialSocket = Deno.build.os === "linux" && core.codingCredentials
  ? await serveCredentialSocket({
    dataRoot: core.dataRoot,
    authority: core.codingCredentials.authority,
  })
  : undefined;
if (credentialSocket !== undefined && !credentialSocket.ok) {
  console.error("core: credential socket unavailable");
}
const closeCredentialSocket = () =>
  credentialSocket?.ok ? credentialSocket.value.close() : Promise.resolve();
void core.done.then(closeCredentialSocket);

const stop = () =>
  void core.shutdown().then(closeCredentialSocket).then(() => Deno.exit(0));
Deno.addSignalListener("SIGINT", stop);
Deno.addSignalListener("SIGTERM", stop);
