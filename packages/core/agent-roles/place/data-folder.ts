import type { Id } from "../../../protocol/base/ids.ts";
import type { Place } from "../../../protocol/lophn-agent/places.ts";
import { ARTIFACTS_FOLDER } from "../../../protocol/projects/artifact.ts";

// 사람의 agent 정의와 project 설정이 놓이는 data root 아래 자리. 여기가 바뀌면 사람이 만든 정의를 못 찾는다.
export function projectsDataArea(root: string): string {
  return `${root}/projects`;
}

// project의 data 폴더. 앱 place는 없다(protocol의 Place 합집합이 줄면 type도 project만 받는다).
export function placeDataFolder(root: string, place: Place): string {
  return `${projectsDataArea(root)}/${place.id}`;
}

// project의 artifact 파일이 놓이는 폴더. PM과 Operator가 file tool로 읽고 쓴다.
export function artifactsFolder(root: string, project: string): string {
  return `${
    placeDataFolder(root, { kind: "project", id: project as Id<"prj"> })
  }/${ARTIFACTS_FOLDER}`;
}

export function placeAgentsFolder(root: string, place: Place): string {
  return `${placeDataFolder(root, place)}/agents`;
}

export function lophnAgentsFolder(root: string): string {
  return `${root}/agents`;
}

// projects 폴더 안에서 project 폴더만 가려낸다.
export function projectIdOfFolder(name: string): string | null {
  return /^prj_[0-9a-z]+$/.test(name) ? name : null;
}
