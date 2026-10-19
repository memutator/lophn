// core 조립 목록. lead가 고치는 유일한 조립 file이다. main.ts는 이 세 목록만 core에 넘긴다.
import { createLedgerRegistration as createAppsRegistration } from "../../apps/register.ts";
import { createLedgerRegistration } from "../../projects/register.ts";
import { createLedgerRegistration as createDomainsRegistration } from "../../domains/register.ts";
import {
  createLedgerRegistration as createLophnAgentRegistration,
  lophnAgentDefinitions,
} from "./wiring/lophn-agent-team.ts";
import {
  createLedgerRegistration as createProblemsRegistration,
  problemsReportDefinitions,
  problemsTestDefinitions,
} from "../../problems/register.ts";
import { ticketDefinitions } from "../../apps/tickets/register.ts";
import { createCoreRegistration as createTicketPortsRegistration } from "../../apps/tickets/ports.ts";
import type { WiringFactory } from "./wiring/context.ts";
import { appsWiring } from "./wiring/apps.ts";
import { appsTicketsWiring } from "./wiring/apps-tickets.ts";
import { annotationsWiring } from "./wiring/annotations.ts";
import { codingSessionsWiring } from "./wiring/coding-sessions.ts";
import { codingMcpWiring } from "./wiring/coding-mcp.ts";
import { approvalsWiring } from "./wiring/approvals.ts";
import { configWiring } from "./wiring/config.ts";
import { sdkInstallWiring } from "./wiring/sdk-install.ts";
import { diagnosticsWiring } from "./wiring/diagnostics.ts";
import { eventsWiring } from "./wiring/events.ts";
import {
  lophnAgentProviderLoginWiring,
  lophnAgentWiring,
} from "./wiring/lophn-agent.ts";
import { lophnAgentExtensionsWiring } from "./wiring/lophn-agent-extensions.ts";
import { lophnAgentRuntimeWiring } from "./wiring/lophn-agent-runtime.ts";
import {
  lophnAgentRewindWiring,
  lophnAgentSessionWiring,
} from "./wiring/lophn-agent-session.ts";
import { routerWiring } from "./wiring/router.ts";
import { problemsWiring } from "./wiring/problems.ts";
import { problemsTestsWiring } from "./wiring/problems-tests.ts";
import { projectsWiring } from "./wiring/projects.ts";
import { kindsWiring } from "./wiring/kinds.ts";
import { secretsWiring } from "./wiring/secrets.ts";
import { sessionSnapshotsWiring } from "./wiring/session-snapshots.ts";
import { settingDeclarationsWiring } from "./wiring/setting-declarations.ts";
import { serverWiring } from "./wiring/server.ts";
import { storageWiring } from "./wiring/storage.ts";
import { supervisionWiring } from "./wiring/supervision.ts";

// 최상위 팀마다 등록 파일 하나.
import { createCoreRegistration as createApprovalsRegistration } from "../../approvals/registration.ts";
import { createCoreRegistration as createRouterRegistration } from "./wiring/router-registration.ts";
import { createCoreRegistration as createAnnotationsRegistration } from "../../apps/annotations/register.ts";
import { createCoreRegistration as createCodingRegistration } from "../../apps/tickets/coding/register.ts";
import { createCoreRegistration as createPlaceRegistration } from "./wiring/lophn-agent-registration.ts";
import { createCoreRegistration as createUsageRegistration } from "./wiring/apps-usage.ts";
import { createCoreRegistration as createDomainOwnersRegistration } from "./wiring/domains-registration.ts";

export const TEAMS = [
  { createLedgerRegistration },
  { createLedgerRegistration: createAppsRegistration },
  { createLedgerRegistration: createDomainsRegistration },
  { problemsTestDefinitions },
  { problemsReportDefinitions },
  { createLedgerRegistration: createProblemsRegistration },
  { lophnAgentDefinitions },
  { createLedgerRegistration: createLophnAgentRegistration },
  { ticketDefinitions },
  { createCoreRegistration: createTicketPortsRegistration },
  { createCoreRegistration: createApprovalsRegistration },
  { createCoreRegistration: createRouterRegistration },
  { createCoreRegistration: createAnnotationsRegistration },
  { createCoreRegistration: createCodingRegistration },
  { createCoreRegistration: createPlaceRegistration },
  { createCoreRegistration: createUsageRegistration },
  { createCoreRegistration: createDomainOwnersRegistration },
];

// writer·reader Worker가 다시 import할 등록 파일.
// - 팀 등록 파일들
// - session 되돌리기 읽기(rewind reader)와 LOPHN.md·agent 정의 본문 읽기(instruction files)의 reader 등록.
//   동기 file API는 reader Worker 안에서만 쓰므로 core가 정적으로 import하지 않는다.
export const TEAM_MODULES = [
  new URL("../../projects/register.ts", import.meta.url).href,
  new URL("../../apps/register.ts", import.meta.url).href,
  new URL("../../domains/register.ts", import.meta.url).href,
  new URL("../../problems/register.ts", import.meta.url).href,
  new URL("./wiring/lophn-agent-team.ts", import.meta.url).href,
  new URL("../../apps/tickets/register.ts", import.meta.url).href,
  new URL("../../apps/tickets/ports.ts", import.meta.url).href,
  new URL("../../lophn-agent/session/rewind/reader.ts", import.meta.url).href,
  new URL("./wiring/instructions-registration.ts", import.meta.url).href,
  new URL("../../approvals/registration.ts", import.meta.url).href,
  new URL("./wiring/router-registration.ts", import.meta.url).href,
  new URL("../../apps/annotations/register.ts", import.meta.url).href,
  new URL("../../apps/tickets/coding/register.ts", import.meta.url).href,
  new URL("./wiring/lophn-agent-registration.ts", import.meta.url).href,
  new URL("./wiring/rewind-registration.ts", import.meta.url).href,
  new URL("./wiring/apps-usage.ts", import.meta.url).href,
  new URL("./wiring/domains-registration.ts", import.meta.url).href,
];

// module마다의 wiring. 순서가 뜻을 가진다.
// - hook은 이 순서로 불린다(구동 순서는 wiring/context.ts). schema step의 순서는 migration 이력이다.
// - 쓰기 앞 처리기는 앞이 안쪽이다. 안쪽에서 바깥으로: kinds(project command마다 감시를 다시 정한다) →
//   message body → approval text → apps → trace export → rewind files → provider login → revocation sweep.
// - 읽는 쪽 wiring은 쓰는 쪽보다 뒤다: problems는 apps 뒤, agent runtime은
//   extensions 뒤다. 순서가 틀리면 wiring 칸을 읽을 때 오류가 난다.
// - supervision은 다른 start보다 앞이다(platform/io 위에서 다른 worker가 뜬다).
export const WIRINGS: readonly WiringFactory[] = [
  supervisionWiring,
  diagnosticsWiring,
  storageWiring,
  settingDeclarationsWiring,
  configWiring,
  sdkInstallWiring,
  secretsWiring,
  eventsWiring,
  projectsWiring,
  kindsWiring,
  lophnAgentSessionWiring,
  lophnAgentWiring,
  approvalsWiring,
  routerWiring,
  appsWiring,
  codingMcpWiring,
  lophnAgentRewindWiring,
  lophnAgentProviderLoginWiring,
  appsTicketsWiring,
  codingSessionsWiring,
  annotationsWiring,
  problemsWiring,
  problemsTestsWiring,
  lophnAgentExtensionsWiring,
  lophnAgentRuntimeWiring,
  sessionSnapshotsWiring,
  serverWiring,
];
