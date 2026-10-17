import type { Id } from "../../../protocol/base/ids.ts";
import type { AgentPlace } from "../../../protocol/lophn-agent/mod.ts";
import type { ProjectLayer } from "../../lophn-agent/extensions/project-settings.ts";
import {
  placeDataFolder,
  projectIdOfFolder,
  projectsDataArea,
} from "./data-folder.ts";

// 설정 층 규칙의 role 몫이다. 전역 → project → agent 정의 층으로 겹치고, project 층의 skill 폴더와 설정 파일은
// project의 data 폴더 안에 있다. 앱 place에는 project 층이 없다. 파일 이름이 바뀌면 사람이 둔 project 설정을 못 찾는다.
const EXTENSIONS_FILE = "extensions.json";
const SKILLS_FOLDER = "skills";

function folderOf(root: string, project: string): string {
  return placeDataFolder(root, { kind: "project", id: project as Id<"prj"> });
}

export const PROJECT_LAYER: ProjectLayer = {
  projectOf: (place: AgentPlace) => place.kind === "project" ? place.id : null,
  skillsFolder: (root, project) =>
    `${folderOf(root, project)}/${SKILLS_FOLDER}`,
  extensionsFile: (root, project) =>
    `${folderOf(root, project)}/${EXTENSIONS_FILE}`,
  settingsFolderArea: projectsDataArea,
  projectIdOfFolder,
};
