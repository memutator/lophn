import type { Place } from "../../../protocol/lophn-agent/places.ts";

// project 설정과 project의 data가 놓이는 data root 아래 자리. 여기가 바뀌면 사람이 둔 설정을 못 찾는다.
export function projectsDataArea(root: string): string {
  return `${root}/projects`;
}

// place의 data 폴더. project는 `<data>/projects/<prj>`, 앱은 `<data>/apps/<app>`다.
export function placeDataFolder(root: string, place: Place): string {
  const area =
    place.kind === "project" ? projectsDataArea(root) : `${root}/apps`;
  return `${area}/${place.id}`;
}

// projects 폴더 안에서 project 폴더만 가려낸다.
export function projectIdOfFolder(name: string): string | null {
  return /^prj_[0-9a-z]+$/.test(name) ? name : null;
}

// apps 폴더 안에서 앱 폴더만 가려낸다.
export function appIdOfFolder(name: string): string | null {
  return /^app_[0-9a-z]+$/.test(name) ? name : null;
}
