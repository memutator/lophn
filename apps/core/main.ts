import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { type Core, startCore } from "./core.ts";
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

// 확인한 backup 복원은 이 core를 멈춘다(platform/backup-and-migration#R13). 복원이 끝나면 같은
// data root로 다시 시작해 새 epoch·새 ledger_id·새 hello로 이어 간다. 복원이 실패해도 현재
// 자료는 그대로라 같은 방식으로 다시 시작한다. 시작이 실패하면 프로세스가 끝난다.
let core: Core | undefined;
const exitAfterShutdown = () =>
  void (core?.shutdown() ?? Promise.resolve()).then(() => Deno.exit(0));
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
    teamModules: [
      new URL("./documents.ts", import.meta.url).href,
      new URL("./apps.ts", import.meta.url).href,
      new URL("./problems.ts", import.meta.url).href,
      new URL("./coding-agent.ts", import.meta.url).href,
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./tickets.ts", import.meta.url).href,
    ],
    parent,
    // coding agent connection credential은 OS keychain에 둔다. loader identity 목록은 설치 쪽이 정하면
    // 채운다(그 전에는 child를 등록할 수 없어 보호 전달이 열리지 않는다).
    codingKeychain: productKeychain(),
  });
  if (!started.ok) {
    console.error(`core: ${started.error.message}`);
    Deno.exit(1);
  }
  core = started.value;
  // 복원으로 멈춘 core만 다시 시작한다. 그 밖의 종료(stop·pipe EOF)는 여기서 끝난다.
  await core.done;
  if (!core.restoreStopped()) break;
}
