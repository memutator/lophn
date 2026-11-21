// Projects 화면이 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은 core-source.ts만 안다.
// 모양은 project.list·update·relink_folder·archive에서 이 화면이 쓰는 field만 옮긴 것이다.
import type { SourceResult } from "../../../source-result.ts";
import type { FolderMatch, FolderPick, ProjectDraft } from "../source.ts";

export type { FolderMatch, FolderPick, ProjectDraft, SourceResult };

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
  /** 기계를 넘는 id(`pri_…`). 등록할 때 ledger에서 난다. */
  readonly identity: string;
  /** 첫 폴더가 git 저장소인지. null은 아직 못 읽었다. */
  readonly repo: "git" | "none" | null;
}

/** project 하나가 다른 컴퓨터와 맞춰지는 상태(`project.identity`). */
export interface IdentityStatus {
  readonly project: string;
  readonly identity: string;
  readonly repo: "git" | "none" | null;
  /** git remote가 있다. 없으면 다른 컴퓨터와 자동으로 맞춰지지 않는다. */
  readonly remote: boolean;
  readonly found: boolean;
  /** 사람이 [Separate project]로 나눴다. 다른 컴퓨터와 다시 자동으로 맞춰지지 않는다. */
  readonly separated: boolean;
  /** 같은 저장소인 이 기계의 다른 active project. 있으면 둘 다 자동으로 맞춰지지 않는다. */
  readonly sameRepository: {
    readonly id: string;
    readonly title: string;
  } | null;
}

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
  register(draft: ProjectDraft): Promise<SourceResult<ProjectItem>>;
  /** 등록 dialog가 고른 폴더를 읽는다. */
  match(path: string): Promise<SourceResult<FolderMatch>>;
  /** 폴더를 잃은 project의 그 폴더를 path로 다시 잇는다(relink 제안). */
  relinkFolder(
    project: ProjectItem,
    folder: string,
    path: string,
  ): Promise<SourceResult<ProjectItem>>;
  /** 다른 컴퓨터와 맞춰지는 상태. 폴더를 다시 읽어 ledger 값도 맞춘다. */
  identity(project: ProjectItem): Promise<SourceResult<IdentityStatus>>;
  /** [Separate project]: 새 id를 주어 다른 컴퓨터의 같은 저장소와 다른 project로 만든다. */
  renewIdentity(project: ProjectItem): Promise<SourceResult<IdentityStatus>>;
  /**
   * git이 아닌 project에 다른 기계의 project id를 적어 둘을 같은 project로 잇는다. git project면 conflict다(저장소로
   * 맞춰진다). 이 컴퓨터의 다른 project가 그 id를 가졌어도 conflict다.
   */
  linkIdentity(
    project: ProjectItem,
    identity: string,
  ): Promise<SourceResult<ProjectItem>>;
}
