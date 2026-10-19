// lophn-agent 팀 등록 file. writer·reader Worker가 이 file을 import해 팀 등록을 만든다.
// lophn-agent(harness)는 domain과 agent-roles를 import하지 못하므로, 둘을 아는 이 조립 file이 읽기 함수와
// role 명령, role 규칙을 port로 꽂는다.
import { projectExists, projectIds } from "../../../projects/lookups.ts";
import { appExists, appIds } from "../../../apps/lookups.ts";
import { ROLE_COMMANDS } from "../../../agent-roles/commands.ts";
import { operatorPlaceAllowed } from "../../../agent-roles/tools/operator-place.ts";
import { createOperatorDirectory } from "../../../agent-roles/agents/operator-directory.ts";
import { ROLE_TABLE } from "../../../agent-roles/agents/role-table.ts";
import { PROJECT_LAYER } from "../../../agent-roles/place/project-layer.ts";
import { BUNDLED_SKILLS_ROOT } from "../../../agent-roles/skills/root.ts";
import { createLophnAgent } from "../../../lophn-agent/register.ts";

export { createLedgerRegistration } from "../../../lophn-agent/register.ts";

const agent = createLophnAgent({
  lookups: {
    projectExists,
    projectIds,
    appExists,
    appIds,
  },
  roleCommands: ROLE_COMMANDS,
  operatorPlaceAllowed,
  roles: ROLE_TABLE,
  projectLayer: PROJECT_LAYER,
  bundledSkillsRoot: BUNDLED_SKILLS_ROOT,
});

export const lophnAgentDefinitions = agent.lophnAgentDefinitions;
export const createReaderRegistration = agent.createReaderRegistration;
export const operatorDirectory = createOperatorDirectory(agent.openAgents);
export const operatorMcpServers = agent.operatorMcpServers;
