// kind 선언이 작업대에서 받는 것이다. Workspace가 만들어 넘기고, kind는 이 모양으로만 배치와
// 통로를 건드린다.
import type { AvatarProfile, TabDot } from "@lophn/design/components";

import type { TabItem, WorkspaceView } from "../model.ts";
import type { WorkspaceProps } from "../workspace.tsx";
import type { SearchTabState } from "../contexts/search-tab.tsx";
import type { ContextsSource } from "../contexts/source.ts";
import type { AgentsSource } from "../agents/source.ts";
import type { AgentTabSourceFactory } from "../../conversation/agent-tab-source.ts";
import type { DraftStore } from "../../conversation/drafts.ts";
import type { ContextChipView } from "../../conversation/composer/types.ts";
import type { ReadPosition } from "./kind.ts";

/** 파일 탭이 작업대와 나누는 상태. */
interface DocumentSlice {
  noteReadPosition(document: string, position: ReadPosition): void;
}

/** Contexts·Context·Search 탭이 작업대와 나누는 것. 통로(source)가 없으면 host.contexts는 null이다. */
export interface ContextsSlice {
  readonly source: ContextsSource;
  /** 이 프로젝트의 context 목록. 여는 때(Contexts 탭, sidebar의 Context 모양, 새 탭 menu)만 읽어 둔다. */
  readonly list: readonly { readonly id: string; readonly title: string }[];
  /** 목록에 있는 context의 이름. */
  titleOf(context: string): string | undefined;
  /** context를 보관하거나 풀었다. 작업대가 가진 목록을 다시 읽는다. */
  refresh(): void;
  /** 고른 검색이나 저장한 보기를 그 context의 Search 탭에서 연다. 열려 있으면 그 탭을 고른다. */
  openSearch(state: SearchTabState): void;
  /** 검색 결과·Overview 예시의 도메인 객체를 그 파일 탭으로 연다. 상대 경로는 연결 폴더 기준이다. */
  openPath(path: string): void;
  /** Project Manager의 새 Agent 탭을 연다. chips는 넘길 위반 근거이고, 없으면 빈 탭이다. */
  askProjectManager(chips?: readonly ContextChipView[]): void;
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
  readonly factory: AgentTabSourceFactory;
  /** 창마다 하나인 입력 메모리. 탭을 닫았다 열어도 쓰던 글이 남는다. */
  readonly drafts: DraftStore;
  readonly now?: () => number;
  /** 대화의 결과 링크가 파일(절대 경로)을 연다. */
  openFile(path: string): void;
  /** 탭 줄이 그리는 agent의 profile 아이콘. 목록에 없으면 undefined. */
  profileOf(agent: string): AvatarProfile | undefined;
  /** 탭 줄의 상태 점. session이 없거나 쉬는 중이면 null이다. */
  dotOf(session: string | null): TabDot | null;
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
  /**
   * focus 칸 끝에 붙이고 고른다. 같은 key가 그 칸에 있으면 고르기만 한다. `select: false`면 붙이기만 하고
   * 보고 있는 탭을 바꾸지 않는다(core 요청으로 열리는 coding 터미널 탭).
   */
  openTab(tab: TabItem, options?: { readonly select?: boolean }): void;
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
  readonly contexts: ContextsSlice | null;
  readonly agents: AgentsSlice | null;
  readonly agentView: AgentViewSlice | null;
}
