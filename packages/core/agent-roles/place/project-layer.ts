import type { Id } from "../../../protocol/base/ids.ts";
import {
  domainIdOfFolder,
  DOMAINS_AREA,
  domainSkillsFolder,
} from "../../../protocol/domains/paths.ts";
import type { AgentPlace } from "../../../protocol/lophn-agent/mod.ts";
import type { ProjectLayer } from "../../lophn-agent/extensions/project-settings.ts";
import {
  placeDataFolder,
  projectIdOfFolder,
  projectsDataArea,
} from "./data-folder.ts";

// 설정 층 규칙의 role 몫이다. 전역 → project → agent 정의 층으로 겹치고, project 층의 설정 파일은
// project의 data 폴더 안에 있다. 파일 이름이 바뀌면 사람이 둔 project 설정을 못 찾는다. skill 폴더는 domain의
// data 폴더 안에 있다(`domains`).
const EXTENSIONS_FILE = "extensions.json";
const SKILLS_FOLDER = "skills";

function folderOf(root: string, project: string): string {
  return placeDataFolder(root, { kind: "project", id: project as Id<"prj"> });
}

export const PROJECT_LAYER: ProjectLayer = {
  domains: {
    skillsFolder: domainSkillsFolder,
    folderArea: (root) => `${root}/${DOMAINS_AREA}`,
    domainIdOfFolder,
  },
  projectOf: (place: AgentPlace) => place.kind === "project" ? place.id : null,
  skillsFolder: (root, project) =>
    `${folderOf(root, project)}/${SKILLS_FOLDER}`,
  extensionsFile: (root, project) =>
    `${folderOf(root, project)}/${EXTENSIONS_FILE}`,
  settingsFolderArea: projectsDataArea,
  projectIdOfFolder,
};
