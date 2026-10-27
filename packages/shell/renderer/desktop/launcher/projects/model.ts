// Projects 상세의 편집 초안과 순수 규칙. 저장 전까지의 고침은 모두 초안에만 있다.
import type {
  FolderItem,
  ProjectChange,
  ProjectItem,
  SubfolderItem,
} from "./source.ts";

interface SubfolderDraft extends SubfolderItem {
  /** 빼기를 눌렀다. 저장 전이면 [Undo]로 되돌린다. */
  readonly removed: boolean;
}

interface FolderDraft {
  readonly path: string;
  readonly description: string;
  readonly found: boolean;
  readonly subfolders: readonly SubfolderDraft[];
}

export interface Draft {
  readonly title: string;
  readonly purpose: string;
  readonly folders: readonly FolderDraft[];
}

function folderDraftOf(folder: FolderItem): FolderDraft {
  return {
    path: folder.path,
    description: folder.description,
    found: folder.found,
    subfolders: folder.subfolders.map((sub) => ({ ...sub, removed: false })),
  };
}

export function draftOf(project: ProjectItem): Draft {
  return {
    title: project.title,
    purpose: project.purpose,
    folders: project.folders.map(folderDraftOf),
  };
}

function keptFolders(folders: readonly FolderDraft[]) {
  return folders.map((folder) => ({
    path: folder.path,
    description: folder.description,
    subfolders: folder.subfolders
      .filter((sub) => !sub.removed)
      .map(({ path, description }) => ({ path, description })),
  }));
}

/** 저장할 고침. 바뀐 것이 없으면 null이다. */
export function changeOf(
  project: ProjectItem,
  draft: Draft,
): ProjectChange | null {
  const title = draft.title.trim();
  const folders = keptFolders(draft.folders);
  const original = keptFolders(project.folders.map(folderDraftOf));
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
  change: (folder: FolderDraft) => FolderDraft,
): Draft {
  return {
    ...draft,
    folders: draft.folders.map((folder) =>
      folder.path === path ? change(folder) : folder,
    ),
  };
}

export function changeSubfolder(
  draft: Draft,
  path: string,
  sub: string,
  change: (item: SubfolderDraft) => SubfolderDraft,
): Draft {
  return changeFolder(draft, path, (folder) => ({
    ...folder,
    subfolders: folder.subfolders.map((item) =>
      item.path === sub ? change(item) : item,
    ),
  }));
}

export function addSubfolder(
  draft: Draft,
  path: string,
  sub: SubfolderItem,
): Draft {
  return changeFolder(draft, path, (folder) => ({
    ...folder,
    subfolders: folder.subfolders.some((item) => item.path === sub.path)
      ? folder.subfolders.map((item) =>
          item.path === sub.path ? { ...sub, removed: false } : item,
        )
      : [...folder.subfolders, { ...sub, removed: false }],
  }));
}

/** 새로 고른 폴더를 초안에 더한다. 이미 있으면 그대로다. */
export function addFolder(draft: Draft, path: string): Draft {
  return draft.folders.some((folder) => folder.path === path)
    ? draft
    : {
        ...draft,
        folders: [
          ...draft.folders,
          {
            path,
            description: "",
            found: true,
            subfolders: [],
          },
        ],
      };
}

export function removeFolder(draft: Draft, path: string): Draft {
  return {
    ...draft,
    folders: draft.folders.filter((folder) => folder.path !== path),
  };
}

/** 하위 폴더 경로의 절대 경로. 등록 폴더의 구분자를 따른다. */
export function joinPath(root: string, relative: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const base = root.replace(/[\\/]+$/, "");
  return relative === "" ? base : `${base}${separator}${relative}`;
}
