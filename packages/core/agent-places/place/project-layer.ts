import type { Id } from "../../../protocol/base/ids.ts";
import type { AgentPlace } from "../../../protocol/lophn-agent/mod.ts";
import type { ProjectLayer } from "../../lophn-agent/extensions/project-settings.ts";
import {
  appIdOfFolder,
  PLACE_DATA_SKILLS,
  placeDataFolder,
  placeDataSkillsFolder,
  projectIdOfFolder,
  projectsDataArea,
} from "./data-folder.ts";

// 설정 층 규칙의 project 몫이다. 전역 → project → agent 정의 층으로 겹치고, project 층의 설정 파일은
// project의 data 폴더 안에 있다. 파일 이름이 바뀌면 사람이 둔 project 설정을 못 찾는다. place-data skill 폴더는
// project와 앱의 data 폴더 안 `skills/`다.
const EXTENSIONS_FILE = "extensions.json";

// project 첫 폴더와 앱 source 안의 skill 꾸러미 자리다. repo에 commit되어 사람들과 공유된다.
const PLACE_SKILLS_PATH = ".lophn/skills";

function folderOf(root: string, project: string): string {
  return placeDataFolder(root, { kind: "project", id: project as Id<"prj"> });
}

export const PROJECT_LAYER: ProjectLayer = {
  placeDataSkillsFolder,
  isPlaceDataSkills: (root, path) => {
    if (!path.startsWith(`${root}/`)) return false;
    const [area, id, folder] = path.slice(root.length + 1).split("/");
    return (
      folder === PLACE_DATA_SKILLS &&
      ((area === "projects" && projectIdOfFolder(id ?? "") !== null) ||
        (area === "apps" && appIdOfFolder(id ?? "") !== null))
    );
  },
  projectOf: (place: AgentPlace) =>
    place.kind === "project" ? place.id : null,
  extensionsFile: (root, project) =>
    `${folderOf(root, project)}/${EXTENSIONS_FILE}`,
  settingsFolderArea: projectsDataArea,
  projectIdOfFolder,
  placeSkillsFolder: (folder) => `${folder}/${PLACE_SKILLS_PATH}`,
};
