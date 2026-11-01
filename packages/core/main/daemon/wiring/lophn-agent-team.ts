// lophn-agent 팀 등록 file. writer·reader Worker가 이 file을 import해 팀 등록을 만든다.
// lophn-agent(harness)는 domain과 agent-places를 import하지 못하므로, 둘을 아는 이 조립 file이 읽기 함수와
// place 종류 규칙을 port로 꽂는다.
import {
  projectExists,
  projectFolderPaths,
  projectIds,
} from "../../../projects/lookups.ts";
import { appExists, appIds, appSourcePath } from "../../../apps/lookups.ts";
import { domainsOfOwner } from "../../../domains/lookups.ts";
import { createAgentDirectory } from "../../../lophn-agent/agents/directory.ts";
import { PROJECT_LAYER } from "../../../agent-places/place/project-layer.ts";
import { BUNDLED_SKILLS_ROOT } from "../../../agent-places/skills/root.ts";
import { createLophnAgent } from "../../../lophn-agent/register.ts";

export { createLedgerRegistration } from "../../../lophn-agent/register.ts";

const agent = createLophnAgent({
  lookups: {
    projectExists,
    projectIds,
    appExists,
    appIds,
    sourceFolder: (sql, place) =>
      place.kind === "project"
        ? (projectFolderPaths(sql, place.id)[0] ?? null)
        : appSourcePath(sql, place.id),
    domains: (sql, place) =>
      domainsOfOwner(sql, place, "active").map(({ id, name }) => ({
        id,
        name,
      })),
  },
  projectLayer: PROJECT_LAYER,
  bundledSkillsRoot: BUNDLED_SKILLS_ROOT,
});

export const lophnAgentDefinitions = agent.lophnAgentDefinitions;
export const createReaderRegistration = agent.createReaderRegistration;
export const agentDirectory = createAgentDirectory(agent.openAgents);
export const agentMcpServers = agent.agentMcpServers;
