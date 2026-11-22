// kind 선언이 작업대에서 받는 것이다. Workspace가 만들어 넘기고, kind는 이 모양으로만 배치와
// 통로를 건드린다.

import type { ViewKeeps } from "../../app-frame/view-keeps.ts";
import type { AgentTabSourceFactory } from "../../conversation/agent-tab-source.ts";
import type { DraftStore } from "../../conversation/drafts.ts";
import type { ArtifactsSlice } from "../../conversation/message-list/artifact-text.tsx";
import type { MachineData } from "../../desktop/machines/data.ts";
import type { MachineRef } from "../../desktop/machines/scope.tsx";
import type { ProjectsSource } from "../../desktop/workspaces/projects/source.ts";
import type { SessionDot } from "../../parts/agent-session/activity.ts";
import type { AvatarLook } from "../../parts/avatar/avatar.tsx";
import type {
  Desk,
  OpenRelation,
  QuickCommand,
  WorkspaceQuick,
  WorkspaceRef,
} from "../../shell/desk-model.ts";
import type { MachineProjects } from "../agent/machine-copies.ts";
import type { AgentsSource } from "../agents/source.ts";
import type { AgentsTabs, Face } from "../agents/tab-state.ts";
import type { FloatRect, TabItem } from "../model.ts";
import type { WorkspaceWindowProps } from "../workspace-window.tsx";
import type { ReadPosition } from "./kind.ts";

/** 파일 탭이 작업대와 나누는 상태. */
interface DocumentSlice {
  noteReadPosition(document: string, position: ReadPosition): void;
}

/** Agents 탭이 작업대와 나누는 것. 통로(source)가 없으면 host.agents는 null이다. */
export interface AgentsSlice {
  readonly source: AgentsSource;
  /** Settings의 Tools and skills로 간다(skill·MCP 등록이 있는 곳). */
  openExtensions(): void;
  /** 탭마다의 이동 기록과 저장하지 않은 편집. 탭 줄의 저장 안 됨 표시와 닫기 확인이 같은 곳을 본다. */
  readonly tabs: AgentsTabs;
  /** sidebar 목록에서 찾은 agent의 이름과 avatar. 탭이 아직 본문을 그리지 않았을 때 탭 줄이 쓴다. */
  faceOf(assignment: string): Face | undefined;
}

/** Agent 탭이 작업대와 나누는 것. 통로(agentViewSource)가 없으면 host.agentView는 null이다. */
export interface AgentViewSlice {
  /** agent와 자리로 그 agent의 source를 얻는다. */
  readonly factory: AgentTabSourceFactory;
  /** 기계마다 project 목록. 기계 목록을 읽는 workspace 창만 준다(detached 창과 전역 float은 없어 기계 고르기가 빠진다). */
  readonly machines?: readonly MachineProjects[];
  /** 창마다 하나인 입력 메모리. 탭을 닫았다 열어도 쓰던 글이 남는다. */
  readonly drafts: DraftStore;
  readonly now?: () => number;
  /** 대화의 결과 링크가 파일(절대 경로)을 연다. `from`은 그 대화 탭의 key다(`showAfter`). */
  openFile(path: string, from?: string): void;
  /** 대화의 shell 코드 블록을 floated 새 터미널에서 실행한다. 터미널 통로가 없으면 null이다. */
  readonly runCommand: ((command: string) => void) | null;
  /** 탭 줄이 그리는 agent의 avatar 아이콘. 목록에 없으면 undefined. */
  avatarOf(agent: string): AvatarLook | undefined;
  /** 탭 줄의 상태 점. session이 없거나 쉬는 중이면 null이다. */
  dotOf(session: string | null): SessionDot | null;
  /** `/skills`·`/mcp`가 Settings › Agents로 간다. */
  openSettings(target: "skills" | "mcp"): void;
  /** provider 끊김 줄의 행동이 Settings › Providers로 간다. */
  openConnections(): void;
  /** 그 session의 agent 탭을 연다. 이 project의 agent가 아니면 열지 않는다. `open.options`는 탭을 놓을 자리다(`openTab`의 옵션). */
  openSession(
    session: string,
    open?: { readonly options?: Parameters<TabHost["openTab"]>[1] },
  ): void;
  /** 이 project workspace에서 열려 있는 lophn session. 없으면 null. */
  workspaceLophnSession(): string | null;
  /** session의 agent 이름. 이 project의 agent가 아니면 undefined. */
  nameOf(session: string): string | undefined;
  /** 창이 아는 session 제목. 제목이 없거나 아직 읽지 못했으면 null이다. 탭 이름의 정본이다. */
  titleOf(session: string): string | null;
  /** 화면이 먼저 안 session 제목(열린 대화가 읽은 것, 방금 바꾼 이름)을 창에 알린다. */
  titled(session: string, title: string): void;
  /** 이 창 workspace(project나 앱)의 artifact. 대화 글의 path를 link로 그리고 누르면 artifact 탭을 연다. */
  readonly artifacts: ArtifactsSlice;
}

/** project settings 탭이 작업대와 나누는 것. project 창이 아니면 host.projectSettings는 null이다. */
export interface ProjectSettingsSlice {
  /** project 등록(이름·폴더)을 읽고 쓰는 통로. 없으면 General은 안내 글만 둔다. */
  readonly projects: ProjectsSource | undefined;
  /** 등록을 저장했다. 작업대가 project 이름과 폴더를 다시 읽는다. */
  projectChanged(): void;
  /** 빠른 실행의 순서와 고정. layout 파일의 `quick`이고 없으면 전역 값을 쓴다. */
  readonly quick: WorkspaceQuick | undefined;
  /** undefined면 이 project의 값을 지우고 전역 값으로 돌아간다. */
  setQuick(next: WorkspaceQuick | undefined): void;
  /** 이 project만의 터미널 명령. 전역 값을 따르는지와 상관없다. */
  readonly commands: readonly QuickCommand[];
  setCommands(next: readonly QuickCommand[]): void;
}

export interface TabHost {
  /** 이 창이 보이는 workspace. Home이면 project 폴더가 필요한 kind는 열리지 않는다. */
  readonly workspace: WorkspaceRef;
  /** workspace의 기계. 탭의 기계는 `tab.machine ?? machine`이다. */
  readonly machine: MachineRef;
  /** 그 기계의 묶음. kind의 hook 아닌 자리(`iconOf`, `dotOf`, `transfer`)가 탭의 기계 묶음을 이것으로 찾는다. */
  machineData(machine: MachineRef): MachineData;
  /** workspace가 project일 때 그 id. Home이면 null이다. */
  readonly projectId: string | null;
  readonly projectTitle: string | undefined;
  /** Explorer가 보이는 연결 폴더. 터미널을 열 때 시작 폴더다. 고른 적이 없으면 undefined(첫 폴더). */
  readonly explorerRoot: string | undefined;
  /** 통로(editor·terminal 등)와 열기 콜백. */
  readonly props: WorkspaceWindowProps;
  /** 앱 workspace의 이름. 읽기 전에는 undefined. 앱 화면 탭의 제목이다. */
  readonly appName: string | undefined;
  /** App details에서 앱 이름을 바꿨다. 탭 제목과 crumb이 새 이름을 쓴다. */
  appRenamed(name: string): void;
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
   * 남긴다). `select: false`면 붙이기만 하고 보고 있는 탭을 바꾸지 않는다(agent가 core 요청으로 여는 탭). 이때도
   * `after`·`beside`·`relation`의 자리는 지키고, `after`가 다른 desk에 있으면 보는 desk를 바꾸지 않고 그 desk에 붙인다.
   * `after`는 그 key의 탭 바로 뒤에 넣는다(그 탭이 없으면 없는 것과 같다). 그 탭이 다른 desk에 있으면 그 desk로
   * 건너가 연다. `beside`는 `after`의 옆 칸에 연다(`openBeside`). `relation`은 agent가 연 탭이 `after`에게 무엇인가에 따른 자리다(`OpenRelation`).
   */
  openTab(
    tab: TabItem,
    options?: {
      readonly select?: boolean;
      readonly after?: string;
      readonly beside?: boolean;
      readonly relation?: OpenRelation;
      /** `select: false`이고 `after`가 없을 때 붙일 desk. 없는 desk면 보이는 desk다. */
      readonly desk?: string;
    },
  ): void;
  /**
   * 탭을 곧바로 floated로 연다(popup). size를 주면 그 크기로 stage 가운데에 열고, 자리(x·y)까지 주면
   * 그 자리를 지금 stage 안으로 당겨 연다. 없으면 지금 크기의 60%다. stage를 아직 못 쟀으면 tabs에 붙여 연다.
   */
  openFloat(
    tab: TabItem,
    at?: { readonly width: number; readonly height: number } | FloatRect,
    /** minimized는 접힌 chip으로 연다. select는 stage를 못 재서 tabs에 붙여 열 때 `openTab`에 넘기는 옵션이다. */
    options?: { readonly select?: boolean; readonly minimized?: boolean },
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
  readonly projectSettings: ProjectSettingsSlice | null;
}
