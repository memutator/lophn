// kind 선언이 작업대에서 받는 것이다. Workspace가 만들어 넘기고, kind는 이 모양으로만 배치와
// 통로를 건드린다(shell/workspace#R14).
import type {
  CompareTarget,
  DocumentTabMeta,
} from "../../editor/document-view.tsx";
import type { TabItem, WorkspaceView } from "../model.ts";
import type { DocumentRow } from "../source.ts";
import type { WorkspaceProps } from "../workspace.tsx";
import type { SearchTabState } from "../contexts/search-tab.tsx";
import type { ContextsSource } from "../contexts/source.ts";
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

/** Contexts·Context·Search 탭이 작업대와 나누는 것. 통로(source)가 없으면 host.contexts는 null이다. */
export interface ContextsSlice {
  readonly source: ContextsSource;
  /** 이 프로젝트의 context 목록. 작업대가 읽어 두고 바뀌면 갱신한다. */
  readonly list: readonly { readonly id: string; readonly title: string }[];
  /** 목록에 있는 context의 이름. */
  titleOf(context: string): string | undefined;
  /** 고른 검색이나 저장한 보기를 그 context의 Search 탭에서 연다. 열려 있으면 그 탭을 고른다(R22). */
  openSearch(state: SearchTabState): void;
  /** 검색 결과·Overview 예시의 도메인 객체를 그 문서 탭으로 연다(workspace#R26). */
  openPath(path: string): void;
  /** Context Engineer와 말하는 대화를 연다(오늘의 대화 도크). */
  askContextEngineer(): void;
  /** [New context]. 대화를 열고 만드는 중인 context가 생기면 그 탭을 남긴다(workspace#R30). */
  newContext(): void;
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
  /**
   * key의 탭 필드를 바꾸고 저장한다. 함수를 주면 그 사이 바뀐 탭에서 계산한다. 타이핑처럼 잦은
   * 바뀜은 `later`로 저장을 잠깐 모은다.
   */
  patchTab(
    key: string,
    patch: Partial<TabItem> | ((current: TabItem) => Partial<TabItem>),
    options?: { readonly later?: boolean },
  ): void;
  removeTab(key: string): void;
  readonly document: DocumentSlice;
  readonly appPanel: AppPanelSlice;
  readonly contexts: ContextsSlice | null;
}
