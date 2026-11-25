import { idSchema } from "../../../protocol/base/ids.ts";
import { agentMemoryFile } from "../../lophn-agent/agents/store.ts";
import {
  type AgentId,
  isLophn,
  type Workspace,
  workspaceOfLophn,
} from "../../../protocol/lophn-agent/workspaces.ts";

// project 설정과 project의 data가 놓이는 data root 아래 자리. 여기가 바뀌면 사람이 둔 설정을 못 찾는다.
export function projectsDataArea(root: string): string {
  return `${root}/projects`;
}

export function appsDataArea(root: string): string {
  return `${root}/apps`;
}

// Home의 그릇 자리다(`LOPHN.md`, `extensions.json`, `skills/`). data root 최상위의 다른 이름(agents, apps,
// projects, skills, settings 등)과 겹치지 않는다.
export function homeDataFolder(root: string): string {
  return `${root}/home`;
}

// workspace의 data 폴더. Home은 `<data>/home`, project는 `<data>/projects/<prj>`, 앱은 `<data>/apps/<app>`다.
export function workspaceDataFolder(
  root: string,
  workspace: Workspace | null,
): string {
  if (workspace === null) return homeDataFolder(root);
  const area =
    workspace.kind === "project" ? projectsDataArea(root) : appsDataArea(root);
  return `${area}/${workspace.id}`;
}

// workspace memory 파일. 그 workspace의 lophn만 쓰고 그 workspace의 모든 agent가 prompt로 받는다.
export const WORKSPACE_MEMORY_FILE = "memory.md";
export function workspaceMemoryFile(
  root: string,
  workspace: Workspace | null,
): string {
  return `${workspaceDataFolder(root, workspace)}/${WORKSPACE_MEMORY_FILE}`;
}

// agent.memory가 쓸 파일. 어느 파일인지는 부른 agent의 id만이 정한다(입력에서 자리를 받지 않는다).
export function memoryFileOf(root: string, agent: AgentId): string | null {
  if (isLophn(agent)) return workspaceMemoryFile(root, workspaceOfLophn(agent));
  return idSchema("agt").safeParse(agent).success
    ? agentMemoryFile(root, agent)
    : null;
}

// workspace 그릇 자리의 skill 꾸러미 폴더. 이 자리의 skill이 workspace-data 층이다.
export const WORKSPACE_DATA_SKILLS = "skills";
export function workspaceDataSkillsFolder(
  root: string,
  workspace: Workspace | null,
): string {
  return `${workspaceDataFolder(root, workspace)}/${WORKSPACE_DATA_SKILLS}`;
}

// 전역 개인 skill 보관소(`<data>/skills`). Home session이 file tool로 쓰고 모든 workspace가 전역 층으로 읽는다.
export function globalSkillsFolder(root: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${WORKSPACE_DATA_SKILLS}`;
}

// workspace 그릇 자리의 로컬 tool 폴더. 이 자리의 `.ts`/`.js`/`.mjs` 파일이 workspace-data 층 tool이다.
export const WORKSPACE_DATA_TOOLS = "tools";
export function workspaceDataToolsFolder(
  root: string,
  workspace: Workspace | null,
): string {
  return `${workspaceDataFolder(root, workspace)}/${WORKSPACE_DATA_TOOLS}`;
}

// projects 폴더 안에서 project 폴더만 가려낸다.
export function projectIdOfFolder(name: string): string | null {
  return /^prj_[0-9a-z]+$/.test(name) ? name : null;
}

// apps 폴더 안에서 앱 폴더만 가려낸다.
export function appIdOfFolder(name: string): string | null {
  return /^app_[0-9a-z]+$/.test(name) ? name : null;
}
