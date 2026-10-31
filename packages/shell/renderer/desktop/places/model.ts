// Places panel 줄과 등록 창의 순수 규칙.
import type { ProjectItem } from "./projects/source.ts";
import type { FolderDraft } from "./source.ts";

/** 디스크에서 사라진 등록 폴더 중 첫째. 없으면 undefined다. */
export function missingFolder(
  project: Pick<ProjectItem, "folders">,
): ProjectItem["folders"][number] | undefined {
  return project.folders.find((folder) => !folder.found);
}

/** 고른 폴더를 더한다. 이미 있는 폴더는 다시 넣지 않는다. */
export function addFolder(
  folders: readonly FolderDraft[],
  path: string,
): readonly FolderDraft[] {
  return folders.some((folder) => folder.path === path)
    ? folders
    : [...folders, { path, description: "" }];
}

/** 이름은 공백만으로 둘 수 없다. */
export function usableTitle(title: string): boolean {
  return title.trim().length > 0;
}

/** 목록을 읽는 중·실패·읽음. */
export type Loaded<T> =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly items: readonly T[] };
