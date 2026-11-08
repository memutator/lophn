import type { AgentWorkspace } from "../../../protocol/lophn-agent/mod.ts";
import type { ProjectLayer } from "../../lophn-agent/extensions/project-settings.ts";
import {
  appIdOfFolder,
  appsDataArea,
  WORKSPACE_DATA_SKILLS,
  workspaceDataFolder,
  workspaceDataSkillsFolder,
  projectIdOfFolder,
  projectsDataArea,
} from "./data-folder.ts";

// 설정 층 규칙의 workspace 몫이다. 전역 → Home | project | 앱 → agent 정의 층으로 겹치고, workspace 층의 설정 파일은
// workspace의 data 폴더 안에 있다(Home `<data>/home`, project `<data>/projects/<prj>`, 앱 `<data>/apps/<app>`). 파일 이름이
// 바뀌면 사람이 둔 설정을 못 찾는다. workspace-data skill 폴더는 그 data 폴더 안 `skills/`다.
const EXTENSIONS_FILE = "extensions.json";

// project 첫 폴더와 앱 source 안의 skill 꾸러미 자리다. repo에 commit되어 사람들과 공유된다.
const WORKSPACE_SKILLS_PATH = ".lophn/skills";

function workspaceOfFolder(name: string): AgentWorkspace | null {
  const project = projectIdOfFolder(name);
  if (project !== null) return { kind: "project", id: project } as never;
  const app = appIdOfFolder(name);
  return app === null ? null : ({ kind: "app", id: app } as never);
}

// root 아래 상대 경로의 조각이다. root 밖이면 null이다.
function piecesUnder(root: string, path: string): string[] | null {
  return path.startsWith(`${root}/`)
    ? path.slice(root.length + 1).split("/")
    : null;
}

export const PROJECT_LAYER: ProjectLayer = {
  workspaceDataSkillsFolder,
  isWorkspaceDataSkills: (root, path) => {
    const [area, id, folder] = piecesUnder(root, path) ?? [];
    if (area === undefined) return false;
    if (area === "home") return id === WORKSPACE_DATA_SKILLS;
    return (
      folder === WORKSPACE_DATA_SKILLS &&
      ((area === "projects" && projectIdOfFolder(id ?? "") !== null) ||
        (area === "apps" && appIdOfFolder(id ?? "") !== null))
    );
  },
  extensionsFile: (root, workspace) =>
    `${workspaceDataFolder(root, workspace)}/${EXTENSIONS_FILE}`,
  isExtensionsFile: (root, path) => {
    const pieces = piecesUnder(root, path);
    if (pieces === null) return false;
    const [area, id, file, ...rest] = pieces;
    if (area === "home") return id === EXTENSIONS_FILE && file === undefined;
    return (
      file === EXTENSIONS_FILE &&
      rest.length === 0 &&
      ((area === "projects" && projectIdOfFolder(id ?? "") !== null) ||
        (area === "apps" && appIdOfFolder(id ?? "") !== null))
    );
  },
  settingsFolderAreas: (root) => [projectsDataArea(root), appsDataArea(root)],
  workspaceOfFolder,
  workspaceSkillsFolder: (folder) => `${folder}/${WORKSPACE_SKILLS_PATH}`,
};
