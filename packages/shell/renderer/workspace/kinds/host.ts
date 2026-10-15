// kind 선언이 작업대에서 받는 것이다. Workspace가 만들어 넘기고, kind는 이 모양으로만 배치와
// 통로를 건드린다.
import type { DocumentTabMeta } from "../../editor/document-view.tsx";
import type { TabItem, WorkspaceView } from "../model.ts";
import type { DocumentRow } from "../source.ts";
import type { WorkspaceProps } from "../workspace.tsx";
import type { SearchTabState } from "../contexts/search-tab.tsx";
import type { ContextsSource } from "../contexts/source.ts";
import type { AgentsSource } from "../agents/source.ts";
import type { AgentViewSourceFactory } from "../../conversation/agent-source.ts";
import type { Ticks } from "../../conversation/agent-view-data.ts";
import type { DraftStore } from "../../conversation/drafts.ts";
import type { ContextLinks } from "../../conversation/result-links.tsx";
import type { ReadPosition } from "./kind.ts";

/** 문서 탭이 작업대와 나누는 상태. 정보 패널과 현재 보기 힌트가 같이 읽는다. */
export interface DocumentSlice {
  readonly rows: readonly DocumentRow[];
  readonly infoShown: boolean;
  toggleInfo(): void;
  /** 편집기가 읽은 파일 이름. 읽기 전에는 없다. */
  fileName(document: string): string | undefined;
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
  /** context 목록 한 줄이 바뀌면 달라지는 표. 열린 Context 탭이 다시 읽을 때를 안다. 목록에 없으면 undefined. */
  stampOf(context: string): string | undefined;
  /** 고른 검색이나 저장한 보기를 그 context의 Search 탭에서 연다. 열려 있으면 그 탭을 고른다. */
  openSearch(state: SearchTabState): void;
  /** 검색 결과·Overview 예시의 도메인 객체를 그 문서 탭으로 연다. */
  openPath(path: string): void;
  /** Context Engineer와 말하는 대화를 연다(오늘의 대화 도크). */
  askContextEngineer(): void;
  /** [New context]. 대화를 열고 만드는 중인 context가 생기면 그 탭을 남긴다. */
  newContext(): void;
}

/** Agents 탭이 작업대와 나누는 것. 통로(source)가 없으면 host.agents는 null이다. */
export interface AgentsSlice {
  readonly source: AgentsSource;
  /** 목록이나 정의가 바뀌었다. sidebar의 Agents 묶음이 다시 읽는다. */
  changed(): void;
  /** project의 LOPHN.md 편집을 연다. */
  editInstructions(): void;
  /** lophn 공간으로 간다(model 기본값·skill·MCP 등록이 있는 곳). */
  openLophn(): void;
}

/** Agent 탭이 작업대와 나누는 것. 통로(agentViewSource)가 없으면 host.agentView는 null이다. */
export interface AgentViewSlice {
  /** agent와 자리로 그 agent의 source를 얻는다. */
  readonly factory: AgentViewSourceFactory;
  /** 창마다 하나인 입력 메모리. 탭을 닫았다 열어도 쓰던 글이 남는다. */
  readonly drafts: DraftStore;
  readonly ticks?: Ticks;
  readonly now?: () => number;
  /** 결과 링크와 편집 카드의 [Open]이 그 문서 탭을 연다. */
  openResult(document: string, version: string | null): void;
  /** 대화 속 context 이름 링크가 그 Context 탭을 연다. 통로가 없으면 링크를 그리지 않는다. */
  readonly contexts?: ContextLinks;
  /** Change defaults…와 `/skills`·`/mcp`가 lophn 공간의 Settings › Agents로 간다. */
  openSettings(): void;
  /** provider 끊김 줄의 행동이 설정의 연결 자리로 간다. 없으면 그 행동을 두지 않는다. */
  readonly openConnections?: () => void;
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
  readonly agents: AgentsSlice | null;
  readonly agentView: AgentViewSlice | null;
}
