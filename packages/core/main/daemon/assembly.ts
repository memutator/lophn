// core 조립 목록. lead가 고치는 유일한 조립 file이다. main.ts는 이 세 목록만 core에 넘긴다.

// 최상위 팀마다 등록 파일 하나.
import { createCoreRegistration as createApprovalsRegistration } from "../../approvals/registration.ts";
import { createCoreRegistration as createHostQueueRegistration } from "../../host-queue/register.ts";
import { createCoreRegistration as createAnnotationsRegistration } from "../../apps/annotations/register.ts";
import { createLedgerRegistration as createAppsRegistration } from "../../apps/register.ts";
import { createLedgerRegistration as createJobsRegistration } from "../../jobs/register.ts";
import { createLedgerRegistration } from "../../projects/register.ts";
import { createLedgerRegistration as createRunsRegistration } from "../../runs/register.ts";
import { createLedgerRegistration as createWorkflowsRegistration } from "../../workflows/register.ts";
import { createCoreRegistration as createAcpRegistration } from "./wiring/acp-registration.ts";
import {
  appsDeleteWiring,
  createCoreRegistration as createAppsDeleteRegistration,
} from "./wiring/apps-delete.ts";
import { acpWiring } from "./wiring/acp.ts";
import { annotationsWiring } from "./wiring/annotations.ts";
import { artifactMoveWiring } from "./wiring/artifact-move.ts";
import { workspaceDataMoveWiring } from "./wiring/workspace-data-move.ts";
import { workspaceRenameWiring } from "./wiring/workspace-rename.ts";
import { globalFloatsTabsWiring } from "./wiring/global-floats-tabs.ts";
import { shellAgentTabsWiring } from "./wiring/shell-agent-tabs.ts";
import { approvalsWiring } from "./wiring/approvals.ts";
import { customReplyWiring } from "./wiring/custom-reply.ts";
import { harnessWiring } from "./wiring/harness.ts";
import { extensionToolsWiring } from "./wiring/extension-tools.ts";
import { hostQueueWiring } from "./wiring/host-queue.ts";
import { inputRequestWiring } from "./wiring/input-request.ts";
import {
  attentionWiring,
  createCoreRegistration as createAttentionRegistration,
} from "./wiring/attention.ts";
import { appsWiring } from "./wiring/apps.ts";
import { noticesWiring } from "./wiring/notices.ts";
import { bundleFileSharingWiring } from "./wiring/bundle-file-sharing.ts";
import { sealedMarkerWiring } from "./wiring/sealed-marker.ts";
import { createCoreRegistration as createUsageRegistration } from "./wiring/apps-usage.ts";
import {
  assignmentFileWiring,
  createCoreRegistration as createAssignmentRegistration,
} from "./wiring/assignment-file.ts";
import {
  createCoreRegistration as createShareRequestsRegistration,
  shareRequestsWiring,
} from "./wiring/share-requests.ts";
import { configWiring } from "./wiring/config.ts";
import type { WiringFactory } from "./wiring/context.ts";
import { diagnosticsWiring } from "./wiring/diagnostics.ts";
import { domainsRetireWiring } from "./wiring/domains-retire.ts";
import { lophnSplitWiring } from "./wiring/lophn-split.ts";
import { eventsWiring } from "./wiring/events.ts";
import { stateChangesWiring } from "./wiring/state-changes.ts";
import { flowsWiring } from "./wiring/flows.ts";
import { idleWiring } from "./wiring/idle.ts";
import { jobsWiring } from "./wiring/jobs.ts";
import { createCoreRegistration as createJobsCoreRegistration } from "./wiring/jobs-registration.ts";
import {
  lophnAgentProviderLoginWiring,
  lophnAgentWiring,
} from "./wiring/lophn-agent.ts";
import { lophnAgentExtensionsWiring } from "./wiring/lophn-agent-extensions.ts";
import { createCoreRegistration as createWorkspaceRegistration } from "./wiring/lophn-agent-registration.ts";
import { lophnAgentRuntimeWiring } from "./wiring/lophn-agent-runtime.ts";
import {
  lophnAgentRewindWiring,
  lophnAgentSessionWiring,
} from "./wiring/lophn-agent-session.ts";
import {
  createLedgerRegistration as createLophnAgentRegistration,
  lophnAgentDefinitions,
} from "./wiring/lophn-agent-team.ts";
import { projectsWiring } from "./wiring/projects.ts";
import {
  createCoreRegistration as createRemoteRegistration,
  remoteWiring,
} from "./wiring/remote.ts";
import { routerWiring } from "./wiring/router.ts";
import { createCoreRegistration as createRouterRegistration } from "./wiring/router-registration.ts";
import { runsWiring } from "./wiring/runs.ts";
import { sdkInstallWiring } from "./wiring/sdk-install.ts";
import { secretsWiring } from "./wiring/secrets.ts";
import { serverWiring } from "./wiring/server.ts";
import { appCallsWiring } from "./wiring/app-calls.ts";
import { sessionLifecycleWiring } from "./wiring/session-lifecycle.ts";
import { codingRelayWiring } from "./wiring/coding-relay.ts";
import { terminalViewWiring } from "./wiring/terminal-view.ts";
import { sessionSnapshotsWiring } from "./wiring/session-snapshots.ts";
import { settingDeclarationsWiring } from "./wiring/setting-declarations.ts";
import { agentHandleWiring } from "./wiring/agent-handle.ts";
import { createSkillsOffWiring } from "./wiring/skills-off.ts";
import { storageWiring } from "./wiring/storage.ts";
import { supervisionWiring } from "./wiring/supervision.ts";
import { workflowsWiring } from "./wiring/workflows.ts";

export const TEAMS = [
  { createLedgerRegistration },
  { createLedgerRegistration: createAppsRegistration },
  { createLedgerRegistration: createRunsRegistration },
  { createLedgerRegistration: createWorkflowsRegistration },
  { createLedgerRegistration: createJobsRegistration },
  { createCoreRegistration: createJobsCoreRegistration },
  { lophnAgentDefinitions },
  { createLedgerRegistration: createLophnAgentRegistration },
  { createCoreRegistration: createApprovalsRegistration },
  { createCoreRegistration: createHostQueueRegistration },
  { createCoreRegistration: createRouterRegistration },
  { createCoreRegistration: createAnnotationsRegistration },
  { createCoreRegistration: createWorkspaceRegistration },
  { createCoreRegistration: createUsageRegistration },
  { createCoreRegistration: createAssignmentRegistration },
  { createCoreRegistration: createShareRequestsRegistration },
  { createCoreRegistration: createAcpRegistration },
  { createCoreRegistration: createAppsDeleteRegistration },
  { createCoreRegistration: createAttentionRegistration },
  { createCoreRegistration: createRemoteRegistration },
];

// writer·reader Worker가 다시 import할 등록 파일.
// - 팀 등록 파일들
// - session 되돌리기 읽기(rewind reader)와 LOPHN.md·agent 정의 본문 읽기(instruction files)의 reader 등록.
//   동기 file API는 reader Worker 안에서만 쓰므로 core가 정적으로 import하지 않는다.
export const TEAM_MODULES = [
  new URL("../../projects/register.ts", import.meta.url).href,
  new URL("../../apps/register.ts", import.meta.url).href,
  new URL("../../runs/register.ts", import.meta.url).href,
  new URL("../../workflows/register.ts", import.meta.url).href,
  new URL("../../jobs/register.ts", import.meta.url).href,
  new URL("./wiring/jobs-registration.ts", import.meta.url).href,
  new URL("./wiring/lophn-agent-team.ts", import.meta.url).href,
  new URL("../../lophn-agent/session/rewind/reader.ts", import.meta.url).href,
  new URL("./wiring/instructions-registration.ts", import.meta.url).href,
  new URL("../../approvals/registration.ts", import.meta.url).href,
  new URL("../../host-queue/register.ts", import.meta.url).href,
  new URL("./wiring/router-registration.ts", import.meta.url).href,
  new URL("../../apps/annotations/register.ts", import.meta.url).href,
  new URL("./wiring/lophn-agent-registration.ts", import.meta.url).href,
  new URL("./wiring/rewind-registration.ts", import.meta.url).href,
  new URL("./wiring/apps-usage.ts", import.meta.url).href,
  new URL("./wiring/assignment-file.ts", import.meta.url).href,
  new URL("./wiring/share-requests.ts", import.meta.url).href,
  new URL("./wiring/acp-registration.ts", import.meta.url).href,
  new URL("./wiring/apps-delete.ts", import.meta.url).href,
  new URL("./wiring/attention.ts", import.meta.url).href,
  new URL("./wiring/remote.ts", import.meta.url).href,
];

// module마다의 wiring. 순서가 뜻을 가진다.
// - hook은 이 순서로 불린다(구동 순서는 wiring/context.ts). schema step의 순서는 migration 이력이다.
// - 쓰기 앞 처리기는 앞이 안쪽이다. 안쪽에서 바깥으로: message body → apps → trace export → rewind files → provider login → revocation sweep.
// - 읽는 쪽 wiring은 쓰는 쪽보다 뒤다: agent runtime은 extensions 뒤다. 순서가 틀리면 wiring 칸을 읽을 때 오류가 난다.
// - supervision은 다른 start보다 앞이다(platform/io 위에서 다른 worker가 뜬다).
// - runs는 router 뒤다. 켤 때 router가 돌던 turn을 닫은 뒤에 run을 맞춰야 그 turn의 끝을 본다.
// - workflows는 runs와 같은 이유로 router 뒤다.
// - custom-reply는 router 뒤다. 켤 때 router가 돌던 turn을 닫은 뒤에 TurnEnded를 구독한다. harness도 같은 이유로 router 뒤다.
// - flows는 workflows 뒤, jobs 앞이다. runs·workflows가 build에서 낸 service를 쓰고, job이 시작한 flow를 띄운다.
// - jobs는 runs·workflows 뒤다. 켤 때 둘을 맞춘 뒤에 첫 claim이 돈다.
export const WIRINGS: readonly WiringFactory[] = [
  supervisionWiring,
  diagnosticsWiring,
  storageWiring,
  settingDeclarationsWiring,
  configWiring,
  sdkInstallWiring,
  secretsWiring,
  eventsWiring,
  stateChangesWiring,
  projectsWiring,
  lophnAgentSessionWiring,
  lophnAgentWiring,
  // data step은 이 순서로 돈다. agent-handle이 가장 먼저 handle을 채운다(뒤 step들이 정의를 schema로 읽는다). skills-off가 먼저 `skills`를 옮겨야 assignment-file이 엄격한 schema로 agent 파일을 읽는다.
  agentHandleWiring,
  createSkillsOffWiring,
  approvalsWiring,
  assignmentFileWiring,
  // artifact·skill·문서 옮기기는 domains 표를 읽는다. 표를 거두는 data step(domains-retire, 맨 끝)보다 앞에 둔다.
  // 같은 domain 폴더의 rewind 기록을 나눠 고치므로 artifact가 먼저, 그 뒤에 skill과 문서다.
  artifactMoveWiring,
  workspaceDataMoveWiring,
  // artifact-move가 `shell/places`의 판 8을 판 9로 옮긴 뒤에 그 파일을 `shell/workspaces`로 옮긴다.
  workspaceRenameWiring,
  // shell 파일의 모양을 옮기는 data step이다. 다른 step과 순서 의존이 없다.
  globalFloatsTabsWiring,
  // workspace-rename이 layout을 판 10으로, global-floats-tabs가 전역 float을 판 2로 올린 뒤에 두 파일에서 Agent 탭을 걷어낸다.
  shellAgentTabsWiring,
  shareRequestsWiring,
  routerWiring,
  appsWiring,
  // 쓰기 앞 처리기는 앞이 안쪽이다. lophn-agent의 session 정리(rewind files)보다 안쪽이라 app.delete의 session 정리도 이 위에서 한다.
  appsDeleteWiring,
  sealedMarkerWiring,
  // 봉인 표지를 보고 사본을 고르므로 sealed-marker 뒤다.
  bundleFileSharingWiring,
  lophnAgentRewindWiring,
  lophnAgentProviderLoginWiring,
  annotationsWiring,
  runsWiring,
  customReplyWiring,
  harnessWiring,
  hostQueueWiring,
  // approvals·secrets와 host queue 뒤다: 대기열과 알려진 값, 탭 표를 쓴다.
  inputRequestWiring,
  // approvals와 host queue 뒤다: 호출 때 Gate와 queue를 쓴다.
  extensionToolsWiring,
  workflowsWiring,
  flowsWiring,
  jobsWiring,
  lophnAgentExtensionsWiring,
  lophnAgentRuntimeWiring,
  sessionSnapshotsWiring,
  sessionLifecycleWiring,
  attentionWiring,
  codingRelayWiring,
  terminalViewWiring,
  appCallsWiring,
  acpWiring,
  idleWiring,
  serverWiring,
  // 표를 합치는 schema step이 낸 step 목록의 맨 끝이어야 해서 이 위치다(schema-steps.lock.json).
  noticesWiring,
  // 전역 lophn을 workspace마다로 나눈다. data step이 기존 `agents.*`·`approvals.*` step(전역 lophn.md를 본다) 뒤에 돌아야 하고,
  // ledger step은 낸 step 목록의 끝에만 붙는다(schema-steps.lock.json). projects·apps 표가 있어야 해서 팀 schema 뒤다.
  lophnSplitWiring,
  // data step이 마지막이어야 한다. 앞선 옮기기 step이 다 끝난 뒤에 domains 표와 폴더를 거둔다.
  domainsRetireWiring,
  // 기기 표의 ledger step이 낸 step 목록의 맨 끝이다(schema-steps.lock.json). data step은 없다.
  remoteWiring,
];
