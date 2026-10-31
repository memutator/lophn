// Projects 상세의 편집 초안과 순수 규칙. 저장 전까지의 고침은 모두 초안에만 있다.
import type { FolderItem, ProjectChange, ProjectItem } from "./source.ts";

export interface Draft {
  readonly title: string;
  readonly purpose: string;
  readonly folders: readonly FolderItem[];
}

export function draftOf(project: ProjectItem): Draft {
  return {
    title: project.title,
    purpose: project.purpose,
    folders: project.folders,
  };
}

function keptFolders(folders: readonly FolderItem[]) {
  return folders.map(({ path, description }) => ({ path, description }));
}

/** 저장할 고침. 바뀐 것이 없으면 null이다. */
export function changeOf(
  project: ProjectItem,
  draft: Draft,
): ProjectChange | null {
  const title = draft.title.trim();
  const folders = keptFolders(draft.folders);
  const original = keptFolders(project.folders);
  const change: ProjectChange = {
    ...(title === project.title ? {} : { title }),
    ...(draft.purpose === project.purpose ? {} : { purpose: draft.purpose }),
    ...(JSON.stringify(folders) === JSON.stringify(original)
      ? {}
      : { folders }),
  };
  return Object.keys(change).length === 0 ? null : change;
}

export function usableName(title: string): boolean {
  return title.trim().length > 0;
}

export function changeFolder(
  draft: Draft,
  path: string,
  change: (folder: FolderItem) => FolderItem,
): Draft {
  return {
    ...draft,
    folders: draft.folders.map((folder) =>
      folder.path === path ? change(folder) : folder,
    ),
  };
}

/** 새로 고른 폴더를 초안에 더한다. 이미 있으면 그대로다. */
export function addFolder(draft: Draft, path: string): Draft {
  return draft.folders.some((folder) => folder.path === path)
    ? draft
    : {
        ...draft,
        folders: [...draft.folders, { path, description: "", found: true }],
      };
}

export function removeFolder(draft: Draft, path: string): Draft {
  return {
    ...draft,
    folders: draft.folders.filter((folder) => folder.path !== path),
  };
}
