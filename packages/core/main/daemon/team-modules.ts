// writer·reader Worker가 동적 import 한 번으로 읽는 팀 등록 묶음.
// core 메인 프로세스가 정적으로 import하지 않고 URL로만 넘기므로 동기 file API를 가진 reader 등록도 여기 둔다.
// 설치 묶음에서는 이 파일 하나가 `dist/team-modules.mjs`로 묶여 Worker마다 25개 .ts 트리를 다시 열지 않는다.
import * as annotations from "../../apps/annotations/register.ts";
import * as apps from "../../apps/register.ts";
import * as approvals from "../../approvals/registration.ts";
import * as hostQueue from "../../host-queue/register.ts";
import * as jobs from "../../jobs/register.ts";
import * as rewindReader from "../../lophn-agent/session/rewind/reader.ts";
import * as projects from "../../projects/register.ts";
import * as runs from "../../runs/register.ts";
import * as workflows from "../../workflows/register.ts";
import * as acpRegistration from "./wiring/acp-registration.ts";
import * as agentDelete from "./wiring/agent-delete.ts";
import * as appsDelete from "./wiring/apps-delete.ts";
import * as appsUsage from "./wiring/apps-usage.ts";
import * as assignmentFile from "./wiring/assignment-file.ts";
import * as attention from "./wiring/attention.ts";
import * as instructionsRegistration from "./wiring/instructions-registration.ts";
import * as jobsRegistration from "./wiring/jobs-registration.ts";
import * as lophnAgentRegistration from "./wiring/lophn-agent-registration.ts";
import * as lophnAgentTeam from "./wiring/lophn-agent-team.ts";
import * as projectClone from "./wiring/project-clone.ts";
import * as projectCommands from "./wiring/project-commands.ts";
import * as worktrees from "./wiring/worktrees.ts";
import * as remote from "./wiring/remote.ts";
import * as rewindRegistration from "./wiring/rewind-registration.ts";
import * as routerRegistration from "./wiring/router-registration.ts";
import * as shareRequests from "./wiring/share-requests.ts";

export const BUNDLED_TEAM_MODULES: readonly unknown[] = [
  projects,
  apps,
  runs,
  workflows,
  jobs,
  jobsRegistration,
  lophnAgentTeam,
  rewindReader,
  instructionsRegistration,
  approvals,
  hostQueue,
  routerRegistration,
  annotations,
  lophnAgentRegistration,
  rewindRegistration,
  appsUsage,
  assignmentFile,
  shareRequests,
  acpRegistration,
  appsDelete,
  agentDelete,
  attention,
  remote,
  projectClone,
  projectCommands,
  worktrees,
];
