// kind 선언이 작업대에서 받는 것이다. Workspace가 만들어 넘기고, kind는 이 모양으로만 배치와
// 통로를 건드린다(shell/workspace#R14).
import type {
  CompareTarget,
  DocumentTabMeta,
} from "../../editor/document-view.tsx";
import type { TabItem, WorkspaceView } from "../model.ts";
import type { DocumentRow } from "../source.ts";
import type { WorkspaceProps } from "../workspace.tsx";
import type { ReadPosition } from "./kind.ts";

/** 문서 탭이 작업대와 나누는 상태. 정보 패널과 현재 보기 힌트가 같이 읽는다. */
export interface DocumentSlice {
  readonly rows: readonly DocumentRow[];
  readonly infoShown: boolean;
  toggleInfo(): void;
  /** 편집기가 읽은 파일 이름. 읽기 전에는 없다. */
  fileName(document: string): string | undefined;
  compareOf(document: string): CompareTarget | null;
  showCompare(document: string, target: CompareTarget | null): void;
  versionsChanged(): void;
  noteMeta(document: string, meta: DocumentTabMeta): void;
  notePresentation(
    document: string,
    shown: { readonly editing: boolean; readonly version: string },
  ): void;
  noteReadPosition(document: string, position: ReadPosition): void;
}

/** 앱 패널 탭이 작업대와 나누는 상태. */
export interface AppPanelSlice {
  /** 앱 패널 view의 session을 현재 보기 힌트에 알린다. 닫히면 null이다. */
  noteSession(tab: string, session: string | null): void;
}

export interface TabHost {
  readonly projectId: string;
  readonly projectTitle: string | undefined;
  /** 통로(editor·terminal 등)와 열기 콜백. */
  readonly props: WorkspaceProps;
  /** 앱 화면 목록을 읽을 수 있는지. 없으면 앱 패널을 열지 않는다. */
  readonly appScreens: boolean;
  readonly view: WorkspaceView;
  /** focus 칸 끝에 붙이고 고른다. 같은 key가 그 칸에 있으면 고르기만 한다. */
  openTab(tab: TabItem): void;
  /** key의 탭 필드를 바꾸고 저장한다. 함수를 주면 그 사이 바뀐 탭에서 계산한다. */
  patchTab(
    key: string,
    patch: Partial<TabItem> | ((current: TabItem) => Partial<TabItem>),
  ): void;
  removeTab(key: string): void;
  readonly document: DocumentSlice;
  readonly appPanel: AppPanelSlice;
}
