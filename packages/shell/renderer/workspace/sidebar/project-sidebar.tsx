// project 창 오른쪽 sidebar의 Files panel. 틀(폭, 접힘)은 ShellFrame이 정하고 panel 목록은 sidebar-panels.tsx다.
// 왼쪽은 shell/left-sidebar다.

import { t } from "@lophn/i18n";
import { PanelEmpty } from "../../shell/panel-rows.tsx";
import { RightSidebar } from "../../shell/right-sidebar.tsx";
import type { ProjectView, WorkspaceSource } from "../source.ts";
import { Explorer, type TabAwareResult } from "./explorer.tsx";

export interface Reveal {
  readonly path: string;
  readonly nonce: number;
}

export interface ExplorerPanelProps {
  project: ProjectView | null;
  /** Explorer가 폴더를 읽는 통로. */
  source: WorkspaceSource;
  /** 이 컴퓨터의 workspace인가. false면 OS 전용 동작을 숨기고 원격 허락에 따라 읽기 전용으로 떨어진다. */
  here?: boolean;
  /** 편집기에서 열려 있는 파일의 절대 경로. */
  current?: string | null;
  /** keep이면 고정 탭으로, 아니면 preview 탭으로 연다(한 번 클릭). */
  onOpenFile: (path: string, keep?: boolean) => void;
  /** Ctrl/Cmd+Shift+E. true면 Explorer가 그려질 때 focus를 받고 `onFocusAsked`로 내려놓는다. */
  focusAsked?: boolean;
  onFocusAsked?: () => void;
  /** Reveal in Explorer. Explorer에 그 파일을 알린다. */
  reveal?: Reveal | null;
  /** Explorer의 이름 바꾸기·옮기기. 열린 탭 정리까지 한다. */
  onMove: (from: string, to: string) => Promise<TabAwareResult>;
  /** Explorer의 휴지통 보내기. 열린 탭 정리까지 한다. */
  onTrash: (path: string) => Promise<TabAwareResult>;
  /** Explorer가 보이는 연결 폴더(루트). 작업대가 들고 있어 터미널도 같은 폴더에서 열린다. */
  explorerRoot: string | null;
  onExplorerRoot: (path: string) => void;
  /** 연결 폴더 더하기(OS 선택기)와 빼기. 사람이 선택기를 닫는 것도 true이고 실패는 false다. */
  onAddFolder: () => Promise<boolean>;
  onRemoveFolder: (path: string) => Promise<boolean>;
  /** 폴더 오른쪽 클릭 menu의 Open in Terminal. 없으면 그 항목을 두지 않는다. */
  onOpenTerminal?: (cwd: string) => void;
}

export function ExplorerPanel({
  project,
  source,
  here = true,
  current = null,
  reveal = null,
  focusAsked = false,
  onFocusAsked,
  onOpenFile,
  onMove,
  onTrash,
  explorerRoot,
  onExplorerRoot,
  onAddFolder,
  onRemoveFolder,
  onOpenTerminal,
}: ExplorerPanelProps) {
  const folders = project?.folders ?? [];
  // Files는 이름 대신 Explorer가 루트 폴더 선택을 머리 줄에 올린다.
  const title =
    folders.length > 0
      ? null
      : t("project-workspace.label.sidebar-tab-explorer");
  return (
    <RightSidebar title={title} panel="explorer">
      {folders.length === 0 ? (
        <PanelEmpty>{t("project-workspace.empty.no-folders")}</PanelEmpty>
      ) : (
        <Explorer
          // 프로젝트가 바뀌면 고른 루트와 펼침을 새로 시작한다.
          key={project?.id}
          source={source}
          here={here}
          folders={folders}
          current={current}
          reveal={reveal}
          focusAsked={focusAsked}
          onFocusAsked={onFocusAsked ?? (() => {})}
          onOpenFile={onOpenFile}
          onMove={onMove}
          onTrash={onTrash}
          rootPath={explorerRoot}
          onRoot={onExplorerRoot}
          onAddFolder={onAddFolder}
          onRemoveFolder={onRemoveFolder}
          onOpenTerminal={onOpenTerminal}
        />
      )}
    </RightSidebar>
  );
}
