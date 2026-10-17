// Projects 화면이 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은 core-source.ts만 안다.
// 모양은 project.list·update·relink_folder·archive에서 이 화면이 쓰는 field만 옮긴 것이다.
import type { SourceResult } from "../../../source-result.ts";
import type { FolderPick, ProjectDraft } from "../source.ts";

export type { FolderPick, ProjectDraft, SourceResult };

/** 등록 폴더 안에서 따로 설명을 단 하위 폴더. path는 등록 폴더 기준 상대 경로다. */
export interface SubfolderItem {
  readonly path: string;
  readonly description: string;
}

export interface FolderItem {
  readonly path: string;
  readonly description: string;
  /** 디스크에 있는지. false면 사람이 새 위치를 골라야 한다. */
  readonly found: boolean;
  readonly subfolders: readonly SubfolderItem[];
}

export interface ProjectItem {
  readonly id: string;
  /** 사람이 보는 이름 하나. */
  readonly title: string;
  readonly purpose: string;
  /** 쓰기의 비교 기준. */
  readonly revision: string;
  readonly archived: boolean;
  readonly folders: readonly FolderItem[];
}

/** 바꾼 칸만 담는다. folders는 하위 폴더까지 통째로 바뀐다. */
export interface ProjectChange {
  readonly title?: string;
  readonly purpose?: string;
  readonly folders?: readonly {
    readonly path: string;
    readonly description: string;
    readonly subfolders: readonly SubfolderItem[];
  }[];
}

export interface ProjectsSource {
  /** 보관한 project까지 모두. */
  list(): Promise<SourceResult<readonly ProjectItem[]>>;
  /** 이름·목적·폴더·폴더 설명·하위 폴더를 한 번에 저장한다. */
  save(
    project: ProjectItem,
    change: ProjectChange,
  ): Promise<SourceResult<ProjectItem>>;
  setArchived(
    project: ProjectItem,
    archived: boolean,
  ): Promise<SourceResult<ProjectItem>>;
  /** 사라진 폴더의 새 위치를 OS 선택기로 고르고 잇는다. 사람이 그만두면 null이다. */
  relocate(
    project: ProjectItem,
    folder: string,
  ): Promise<SourceResult<ProjectItem | null>>;
  /** 폴더 더하기의 OS 선택기. */
  pickFolder(): Promise<FolderPick>;
  /** 등록 폴더 안의 폴더 이름. 하위 폴더 고르기가 한 단계씩 읽는다. */
  listFolders(path: string): Promise<SourceResult<readonly string[]>>;
  /** 등록. 런처의 등록과 같은 input이다. */
  register(draft: ProjectDraft): Promise<SourceResult<ProjectItem>>;
}
