import type { Place } from "../../../protocol/lophn-agent/places.ts";

// 사람의 agent 정의와 project 설정이 놓이는 data root 아래 자리. 여기가 바뀌면 사람이 만든 정의를 못 찾는다.
export function projectsDataArea(root: string): string {
  return `${root}/projects`;
}

export function placeDataFolder(root: string, place: Place): string {
  const area = place.kind === "project"
    ? projectsDataArea(root)
    : `${root}/apps`;
  return `${area}/${place.id}`;
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
