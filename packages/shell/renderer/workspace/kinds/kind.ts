// 탭 kind registry의 renderer 쪽 모양이다. kind마다 파일 하나가 이름·layout
// 값 읽기와 쓰기·본문·열기 진입을 모두 선언하고, 탭 줄·layout map·칸은
// 이 목록을 돌 뿐 kind 이름으로 가르지 않는다. kind를 더하는 일은 파일 하나와 registry.ts의 한 줄이다.

import type { IconProps } from "@lophn/ui/primitives";
import type { MessageKey } from "@lophn/i18n";
import type { ReactNode } from "react";
import type { TabTransfer } from "../../../ipc/detached.ts";
import type { SessionDot } from "../../parts/agent-session/activity.ts";
import type { TabItem } from "../model.ts";
import type { TabHost } from "./host.ts";

export interface ReadPosition {
  readonly section: string;
  readonly scroll_offset: number;
}

export interface TabKindDef {
  /** layout 탭의 kind에 쓰는 이름. registry 안 유일. */
  readonly kind: string;
  /** 종류 이름의 message key. 팔레트가 탭 행에 쓴다(탭 줄에는 종류 글자가 없다). */
  readonly labelKey: MessageKey;
  /** 탭 줄의 기본 아이콘. 탭마다 다르면 `iconOf`가 덮는다. */
  readonly icon: IconProps["icon"];
  /** 탭 줄·닫기 확인에 보일 이름. 본문이 바뀌는 탭(Agents 탭의 열린 agent)이 쓴다. undefined면 `tab.title`이다. */
  titleOf?(tab: TabItem, host: TabHost): string | undefined;
  /** 탭마다 다른 아이콘(파일 종류, agent의 profile, harness vendor). null이면 `icon`이다. */
  iconOf?(tab: TabItem, host: TabHost): ReactNode | null;
  /** 탭이 디스크 파일이면 그 절대 경로. 탭 menu의 Copy Path·Reveal in Explorer가 쓴다. */
  pathOf?(tab: TabItem): string | null;
  /** 이 탭이 사는 자리(desk) key. 있으면 탭을 여는 길이 그 자리로 건너가서 연다(없는 자리는 그 탭이 열린 채 만든다). 없으면 보이는 자리다. */
  homeDesk?(tab: TabItem): string | undefined;
  /** 탭 이름 뒤의 상태 점(Agent 탭의 session 상태). null이면 점이 없다. */
  dotOf?(tab: TabItem, host: TabHost): SessionDot | null;
  /**
   * 사람이 탭 이름을 바꿨다. null이면 사람이 붙인 이름을 지우고 자동 이름으로 돌아간다. 이 hook을 선언한
   * kind만 탭 줄의 이름 바꾸기(더블클릭, 탭 menu의 Rename)가 생긴다. 지금은 터미널과 Agent 탭이다(Agent 탭은 session 제목을 바꾼다).
   */
  rename?(tab: TabItem, name: string | null, host: TabHost): void;
  /** true면 이름 바꾸기는 이 컴퓨터의 탭만 한다(이름을 core에 쓰는 route가 기기의 목록에 없다). 다른 기계의 탭은 이름 바꾸기 항목이 없다. */
  readonly renameThisComputerOnly?: true;
  /**
   * true(또는 탭별 true)면 이 탭은 이 컴퓨터의 shell host(파일, 터미널, browser, 앱 view)나 기기가 부를 수 없는 관리 route가 있어야 선다.
   * 탭의 기계가 이 컴퓨터가 아니면 본문 대신 OnlyHere("This opens only on <이름>")다. 다른 기계에서 열리게 한 kind는 이 표를 뺀다.
   */
  readonly thisComputerOnly?: true | ((tab: TabItem) => boolean);
  /**
   * 이 컴퓨터에 이 앱이 있으면 탭의 기계와 상관없이(그 기계가 꺼져 있어도) 이 컴퓨터에서 연다(같은 앱은 한 줄). 그 앱 id다.
   * 탭 범위(TabScope)가 그 기계의 상태 안내보다 먼저 묻는다.
   */
  hereApp?(tab: TabItem): string | undefined;
  /** true면 닫은 탭 다시 열기가 건너뛴다(PTY처럼 닫으면 이어 갈 수 없는 탭). */
  readonly noReopen?: true;
  /** true면 이 kind의 탭은 Detach하지 않는다(탭 menu 항목과 패널 단추를 그리지 않는다). 다른 탭에 묶인 보조 패널(browser DevTools)이 쓴다. */
  readonly noDetach?: true;
  /**
   * 전역 float(모든 workspace에 떠 있는 패널)에서 다른 workspace의 desk로도 돌아올 수 있는 kind. 없으면 탭이 나온
   * workspace의 desk로만 돌아온다(terminal은 project 폴더, agent는 workspace의 agent에 묶인다).
   */
  readonly anyWorkspace?: true;
  /** true를 돌려주면 이 탭은 전역 float으로 올리지 않는다(browser의 native popup은 opener view를 이 창 밖으로 옮길 수 없다). noDetach인 kind는 묻지 않는다. */
  noGlobal?(tab: TabItem): boolean;
  /**
   * 탭을 다른 창으로 옮기기 전에 살아 있는 상태를 꺼낸다(`toStored` 값만으로는 옮겨지지 않는 것).
   * 보내는 창에서 돈다. null이면 옮기지 않는다(탭은 그대로 둔다). 선언하지 않은 kind는 `{ value: null, views: [] }`로 본다.
   * value는 JSON이고 main을 거쳐 같은 project의 창에만 간다.
   */
  transfer?(tab: TabItem, host: TabHost): Promise<TabTransfer | null>;
  /**
   * detached 창이 project를 떠나며 조용히 닫힌 뒤 같은 탭을 다시 열 때 이어 붙을 값(terminal의 PTY 참조).
   * 부수 효과 없이 지금 값을 읽는다. 선언하지 않은 kind는 이어 붙을 것이 없다. 값은 JSON이고 main이 이 실행 동안만 든다.
   */
  resume?(tab: TabItem, host: TabHost): unknown;
  /** 받는 창이 탭을 그리기 전에 부른다. transfer가 낸 값이 온다. 값 없이 되살린 탭(저장된 값만)에는 부르지 않는다. */
  receive?(tab: TabItem, transfer: TabTransfer, host: TabHost): void;
  /** 팔레트 탭 행의 아이콘. 없으면 일반 탭이다. */
  readonly paletteIcon?: "terminal";
  /**
   * layout 파일 탭을 화면 탭으로 읽는다. 대상 필드가 맞지 않으면 null이고 그 탭만 빠진다.
   * key는 검증을 마친 값이고 position은 읽어 둔 읽던 위치다.
   * `fromStored`와 `toStored`가 둘 다 없는 kind는 저장하지 않는다: 탭이 이 창 메모리에만 살고 layout 파일(desk 탭 줄,
   * float, detached, 전역 float)에는 어디에도 남지 않는다(Agent 탭). 둘은 같이 있거나 같이 없다.
   */
  fromStored?(
    stored: Readonly<Record<string, unknown>>,
    shared: {
      readonly key: string;
      readonly position: ReadPosition | undefined;
    },
  ): TabItem | null;
  /** 화면 탭을 schema 필드로 줄인다. 맞출 수 없으면 null이고 그 탭만 빠진다. */
  toStored?(
    tab: TabItem,
    shared: { readonly position: ReadPosition | undefined },
  ): Record<string, unknown> | null;
  /** 이 탭이 focus일 때 agent가 읽을 앱 view를 가졌는지. */
  hasAppView?(tab: TabItem): boolean;
  /** 고른 탭의 본문. null이면 칸이 종류 자리표시를 그린다. */
  render?(tab: TabItem, active: boolean, host: TabHost): ReactNode | null;
  /** 고르지 않아도 칸에 남겨 둘 본문. null이 아니면 고른 탭만 보인다. */
  keep?(tab: TabItem, shown: boolean, host: TabHost): ReactNode | null;
  /**
   * 닫기 전 확인. null이면 바로 닫고, 약속이면 true일 때만 닫는다. `confirmed`는 사람이 이미 닫기를 확인한 길(desk 끝내기)이라
   * 같은 질문을 되묻지 않는다. 저장 실패처럼 잃을 것이 남는 질문은 그래도 묻는다.
   */
  beforeClose?(
    tab: TabItem,
    host: TabHost,
    options?: { readonly confirmed?: boolean },
  ): Promise<boolean> | null;
}

/** 이 탭이 이 컴퓨터에서만 열리는가. */
export function isThisComputerOnly(
  def: TabKindDef | undefined,
  tab: TabItem,
): boolean {
  return typeof def?.thisComputerOnly === "function"
    ? def.thisComputerOnly(tab)
    : def?.thisComputerOnly === true;
}
