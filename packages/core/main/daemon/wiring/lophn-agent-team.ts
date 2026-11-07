// lophn-agent 팀 등록 file. writer·reader Worker가 이 file을 import해 팀 등록을 만든다.
// lophn-agent(harness)는 agent-workspaces를 import하지 못하므로, 이를 아는 이 조립 file이 읽기 함수와
// workspace 종류 규칙을 port로 꽂는다.
import {
  projectExists,
  projectFolderPaths,
  projectIds,
} from "../../../projects/lookups.ts";
import {
  appExists,
  appIds,
  appSourcePath,
  appStatusOf,
  sharedCommands,
  sharedSkillFolders,
} from "../../../apps/lookups.ts";
import { createAgentDirectory } from "../../../lophn-agent/agents/directory.ts";
import { PROJECT_LAYER } from "../../../agent-workspaces/workspace/project-layer.ts";
import { BUNDLED_SKILLS_ROOT } from "../../../agent-workspaces/skills/root.ts";
import { createLophnAgent } from "../../../lophn-agent/register.ts";

export { createLedgerRegistration } from "../../../lophn-agent/register.ts";

const agent = createLophnAgent({
  lookups: {
    projectExists,
    projectIds,
    appExists,
    appIds,
    appArchived: (sql, id) => appStatusOf(sql, id) === "archived",
    sharedSkills: sharedSkillFolders,
    sharedCommands,
    sourceFolder: (sql, workspace) =>
      workspace.kind === "project"
        ? (projectFolderPaths(sql, workspace.id)[0] ?? null)
        : appSourcePath(sql, workspace.id),
  },
  projectLayer: PROJECT_LAYER,
  bundledSkillsRoot: BUNDLED_SKILLS_ROOT,
});

export const lophnAgentDefinitions = agent.lophnAgentDefinitions;
export const createReaderRegistration = agent.createReaderRegistration;
export const agentDirectory = createAgentDirectory(agent.openAgents);
export const agentMcpServers = agent.agentMcpServers;
