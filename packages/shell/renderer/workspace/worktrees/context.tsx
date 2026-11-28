// project 창의 worktree 화면들(Explorer 가지, Source Control 패널, + 메뉴 고르기, 탭 꼬리표, git_diff 탭)이 나누는 것.
// workspace-window가 지금 project의 값을 만들어 내리고, 화면은 이것만 보고 core·창을 건드린다.
import { createContext, useContext } from "react";
import type { WorktreeRecord } from "../../../../protocol/projects/worktrees.ts";
import type { MachineRef } from "../../desktop/machines/scope.tsx";
import type { CheckoutRef, SourceControlSource } from "./source.ts";
import type { ProjectWorktrees } from "./use-worktrees.ts";

/** git_diff 탭이 보이는 것. */
export interface DiffSpec {
  readonly checkout: CheckoutRef;
  /** 체크아웃 기준 상대 경로. */
  readonly path: string;
  /** working tree(unstaged·untracked), staged, 또는 커밋 하나(`parent..commit`). */
  readonly scope:
    | { readonly kind: "working" }
    | { readonly kind: "staged" }
    | { readonly kind: "commit"; readonly sha: string };
  /** 목록의 상태 문자(M/A/D/R/U/C). 배지에 쓴다. */
  readonly status?: string;
}

/** worktree를 만든 뒤 이어서 할 일(+ 메뉴의 `+ New worktree…`가 요청했던 세션·터미널 열기). */
export type AfterCreate = (record: WorktreeRecord) => void;

export interface WorktreeUi {
  readonly project: string;
  /** 이 project의 기계(이 컴퓨터는 null). */
  readonly machine: MachineRef;
  /** 이 컴퓨터의 project인가. false면 Reveal in OS 같은 OS 동작을 숨긴다. */
  readonly here: boolean;
  /** 다른 컴퓨터이고 쓰기 허락(터미널 입력)이 없다. 모든 쓰기를 끈다. */
  readonly readOnly: boolean;
  /** project 등록 폴더(원래 폴더) 경로들. */
  readonly folders: readonly string[];
  readonly worktrees: ProjectWorktrees;
  readonly sourceControl: SourceControlSource;
  /** 만들기 창. folder는 원래 폴더(여럿이면 고른 것). */
  openCreate(options?: {
    readonly folder?: string;
    readonly onCreated?: AfterCreate;
  }): void;
  /** 지우기 확인 창(managed는 preflight, adopted는 Untrack). */
  openRemove(worktree: string): void;
  /** label·브랜치 이름 바꾸기 창. */
  openRename(worktree: string): void;
  /** 그 체크아웃에서 새 세션을 연다. worktree가 null이면 원래 폴더. choice가 없으면 lophn agent. prompt가 있으면 첫 메시지로 보낸다. */
  openAgent(
    worktree: string | null,
    options?: { readonly choice?: string; readonly prompt?: string },
  ): void;
  /** 그 체크아웃에서 새 터미널을 연다. */
  openTerminal(worktree: string | null): void;
  /** 오른쪽 sidebar를 Source Control로 바꾸고 그 체크아웃을 고정한다. */
  showInSourceControl(checkout: CheckoutRef): void;
  /** Explorer에서 그 경로를 드러낸다. */
  revealInExplorer(path: string): void;
  /** 메인 영역에 git_diff 탭을 연다. preview면 preview 탭 자리를 쓴다. */
  openDiff(spec: DiffSpec, options?: { readonly preview?: boolean }): void;
  /** 파일을 편집기 탭으로 연다(절대 경로). */
  openFile(path: string, options?: { readonly preview?: boolean }): void;
}

export const WorktreeUiContext = createContext<WorktreeUi | null>(null);

/** project 창 밖(Home, 앱)이면 null이다. */
export function useWorktreeUi(): WorktreeUi | null {
  return useContext(WorktreeUiContext);
}
