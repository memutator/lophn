// Projects 화면이 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은 core-source.ts만 안다.
// 모양은 project.list·update·relink_folder·archive에서 이 화면이 쓰는 field만 옮긴 것이다.
import type { SourceResult } from "../../../source-result.ts";
import type {
  FolderMatch,
  FolderPick,
  IdentityFile,
  ProjectDraft,
} from "../source.ts";

export type {
  FolderMatch,
  FolderPick,
  IdentityFile,
  ProjectDraft,
  SourceResult,
};

export interface FolderItem {
  readonly path: string;
  readonly description: string;
  /** 디스크에 있는지. false면 사람이 새 위치를 골라야 한다. */
  readonly found: boolean;
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
  /** 기계를 넘는 id(`pri_…`). 저장소 file을 읽기 전이거나 file이 없으면 null이다. */
  readonly identity: string | null;
  /** 첫 폴더가 git 저장소인지. null은 아직 못 읽었다. */
  readonly repo: "git" | "none" | null;
}

/** project 하나의 id file 상태(`project.identity`). */
export interface IdentityStatus {
  readonly project: string;
  readonly identity: string | null;
  readonly file: IdentityFile;
  readonly repo: "git" | "none" | null;
  readonly folder: string | null;
  readonly found: boolean;
  /** 같은 id를 먼저 가진 이 기계의 다른 project. */
  readonly duplicateOf: { readonly id: string; readonly title: string } | null;
}

/** 등록 결과. identityFailed면 등록은 됐고 id file만 만들지 못했다. */
export type RegisteredProject = ProjectItem & {
  readonly identityFailed?: boolean;
};

/** 바꾼 칸만 담는다. folders는 통째로 바뀐다. */
export interface ProjectChange {
  readonly title?: string;
  readonly purpose?: string;
  readonly folders?: readonly {
    readonly path: string;
    readonly description: string;
  }[];
}

export interface ProjectsSource {
  /** 보관한 project까지 모두. */
  list(): Promise<SourceResult<readonly ProjectItem[]>>;
  /** 이름·목적·폴더·폴더 설명을 한 번에 저장한다. */
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
  /** 등록. 런처의 등록과 같은 input이다. */
  register(draft: ProjectDraft): Promise<SourceResult<RegisteredProject>>;
  /** 등록 dialog가 고른 폴더를 읽는다. */
  match(path: string): Promise<SourceResult<FolderMatch>>;
  /** 폴더를 잃은 project의 그 폴더를 path로 다시 잇는다(relink 제안). */
  relinkFolder(
    project: ProjectItem,
    folder: string,
    path: string,
  ): Promise<SourceResult<ProjectItem>>;
  /** 폴더의 id file 상태. 폴더를 읽어 ledger 값도 맞춘다. */
  identity(project: ProjectItem): Promise<SourceResult<IdentityStatus>>;
  /** file이 없을 때만 만든다. 충돌은 이긴 값을, 사라진 것은 같은 id를 다시 쓴다. */
  createIdentity(project: ProjectItem): Promise<SourceResult<IdentityStatus>>;
  /** 새 id로 덮어 이 폴더를 다른 기계에서 다른 project로 만든다. */
  renewIdentity(project: ProjectItem): Promise<SourceResult<IdentityStatus>>;
}
