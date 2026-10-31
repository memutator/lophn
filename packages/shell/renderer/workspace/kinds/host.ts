// kind 선언이 작업대에서 받는 것이다. Workspace가 만들어 넘기고, kind는 이 모양으로만 배치와
// 통로를 건드린다.

import type { TabItem } from "../model.ts";
import type { Desk } from "../../shell/desk-model.ts";
import type { ProjectsSource } from "../../desktop/launcher/projects/source.ts";
import type { ViewKeeps } from "../../app-frame/view-keeps.ts";
import type { WorkspaceProps } from "../workspace.tsx";
import type { AgentsSource } from "../agents/source.ts";
import type { AgentTabSourceFactory } from "../../conversation/agent-tab-source.ts";
import type { DraftStore } from "../../conversation/drafts.ts";
import type { ReadPosition } from "./kind.ts";
import type { AvatarProfile } from "../../parts/avatar/avatar.tsx";
import type { ArtifactListItem } from "../../../ipc/artifact.ts";
import type { TabDot } from "../../parts/tab-state-dot/tab-state-dot.tsx";

/** 파일 탭이 작업대와 나누는 상태. */
interface DocumentSlice {
  noteReadPosition(document: string, position: ReadPosition): void;
}

/** Agents 탭이 작업대와 나누는 것. 통로(source)가 없으면 host.agents는 null이다. */
export interface AgentsSlice {
  readonly source: AgentsSource;
  /** 목록이나 정의가 바뀌었다. sidebar의 Agents 묶음이 다시 읽는다. */
  changed(): void;
  /** Settings의 Tools and skills로 간다(skill·MCP 등록이 있는 곳). */
  openExtensions(): void;
}

/** Agent 탭이 작업대와 나누는 것. 통로(agentViewSource)가 없으면 host.agentView는 null이다. */
export interface AgentViewSlice {
  /** agent와 자리로 그 agent의 source를 얻는다. */
  readonly factory: AgentTabSourceFactory;
  /** 창마다 하나인 입력 메모리. 탭을 닫았다 열어도 쓰던 글이 남는다. */
  readonly drafts: DraftStore;
  readonly now?: () => number;
  /** 대화의 결과 링크가 파일(절대 경로)을 연다. `from`은 그 대화 탭의 key다(`showAfter`). */
  openFile(path: string, from?: string): void;
  /** 대화의 shell 코드 블록을 floated 새 터미널에서 실행한다. 터미널 통로가 없으면 null이다. */
  readonly runCommand: ((command: string) => void) | null;
  /** 탭 줄이 그리는 agent의 profile 아이콘. 목록에 없으면 undefined. */
  profileOf(agent: string): AvatarProfile | undefined;
  /** 탭 줄의 상태 점. session이 없거나 쉬는 중이면 null이다. */
  dotOf(session: string | null): TabDot | null;
  /** `/skills`·`/mcp`가 Settings › Agents로 간다. */
  openSettings(target: "skills" | "mcp"): void;
  /** provider 끊김 줄의 행동이 Settings › Providers로 간다. */
  openConnections(): void;
  /** 그 session의 agent 탭을 연다. 이 project의 agent가 아니면 열지 않는다. */
  openSession(session: string): void;
  /** 이 project place에서 열려 있는 lophn session. 없으면 null. */
  placeLophnSession(): string | null;
  /** session의 agent 이름. 이 project의 agent가 아니면 undefined. */
  nameOf(session: string): string | undefined;
  /** 이 project의 domain들의 artifact. 대화 글의 path를 link로 그리고 누르면 artifact 탭을 연다. */
  readonly artifacts: ArtifactsSlice;
}

/** project settings 탭이 작업대와 나누는 것. */
export interface ProjectSettingsSlice {
  /** project 등록(이름·폴더)을 읽고 쓰는 통로. 없으면 General 구역은 쓸 수 없다. */
  readonly projects: ProjectsSource | undefined;
  /** 등록을 저장했다. 작업대가 project 이름과 폴더를 다시 읽는다. */
  projectChanged(): void;
}

export interface ArtifactsSlice {
  readonly items: readonly (ArtifactListItem & { domain: string })[];
  readonly names: readonly { domain: string; name: string }[];
  open(domain: string, name: string): void;
  /** 목록을 다시 읽는다. agent가 방금 만든 artifact를 알아보려고 쓴다. */
  reload(): void;
}

export interface TabHost {
  readonly projectId: string;
  readonly projectTitle: string | undefined;
  /** Explorer가 보이는 연결 폴더. 터미널을 열 때 시작 폴더다. 고른 적이 없으면 undefined(첫 폴더). */
  readonly explorerRoot: string | undefined;
  /** 통로(editor·terminal 등)와 열기 콜백. */
  readonly props: WorkspaceProps;
  /** 앱 화면 목록을 읽을 수 있는지. 없으면 앱 패널을 열지 않는다. */
  readonly appScreens: boolean;
  /** 보이는 desk. */
  readonly desk: Desk;
  /** 이 창 전체의 탭. 자리가 여럿인 창은 모든 자리의 탭이라 key를 만들거나 열린 탭을 찾을 때 쓴다. */
  windowTabs(): readonly TabItem[];
  /** 탭 view의 보관소. Float·Dock으로 다시 mount되어도 browser view를 이어 쓰는 데 쓴다. */
  readonly viewKeeps: ViewKeeps;
  /**
   * 탭을 연다. 이미 어느 desk의 tabs에 있으면 새로 붙이지 않고 그 desk로 건너가 고른다. 없으면 보이는 desk
   * 끝에 붙이고 고른다. `preview` 탭은 그 desk의 preview 자리를 바꿔 쓴다(저장 안 된 변경이 있는 탭은
   * 남긴다). `select: false`면 붙이기만 하고 보고 있는 탭을 바꾸지 않는다(core 요청으로 열리는 coding 터미널 탭).
   * `after`는 그 key의 탭 바로 뒤에 넣는다(그 탭이 없으면 없는 것과 같다). 그 탭이 다른 desk에 있으면 그 desk로
   * 건너가 연다.
   */
  openTab(
    tab: TabItem,
    options?: { readonly select?: boolean; readonly after?: string },
  ): void;
  /**
   * 탭을 곧바로 floated로 연다(popup). size를 주면 그 크기로 stage 가운데에 열고 없으면 지금
   * 크기의 60%다. stage를 아직 못 쟀으면 tabs에 붙여 연다.
   */
  openFloat(
    tab: TabItem,
    size?: { readonly width: number; readonly height: number },
  ): void;
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
  readonly agents: AgentsSlice | null;
  readonly agentView: AgentViewSlice | null;
  /** project settings 탭의 통로. detached 창에는 그 탭이 없어 null이다. */
  readonly projectSettings: ProjectSettingsSlice | null;
}
