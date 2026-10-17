// 탭 kind registry의 renderer 쪽 모양이다. kind마다 파일 하나가 이름·layout
// 값 읽기와 쓰기·본문·열기 진입을 모두 선언하고, 탭 줄·layout map·칸은
// 이 목록을 돌 뿐 kind 이름으로 가르지 않는다. kind를 더하는 일은 파일 하나와 registry.ts의 한 줄이다.
import type { ReactNode } from "react";
import type { TabDot } from "../../parts/tab-strip/tab-strip.tsx";
import type { IconProps } from "@lophn/design/components";
import type { MessageKey } from "@lophn/wording";

import type { TabItem } from "../model.ts";
import type { TabHost } from "./host.ts";

export interface ReadPosition {
  readonly section: string;
  readonly scroll_offset: number;
}

export interface TabKindDef {
  /** layout 탭의 kind에 쓰는 이름. registry 안 유일. */
  readonly kind: string;
  /** 종류 이름의 wording key. 팔레트가 탭 행에 쓴다(탭 줄에는 종류 글자가 없다). */
  readonly labelKey: MessageKey;
  /** 탭 줄의 기본 아이콘. 탭마다 다르면 `iconOf`가 덮는다. */
  readonly icon: IconProps["icon"];
  /** 탭마다 다른 아이콘(파일 종류, agent의 profile, harness vendor). null이면 `icon`이다. */
  iconOf?(tab: TabItem, host: TabHost): ReactNode | null;
  /** 탭 이름 뒤의 상태 점(Agent 탭의 session 상태). null이면 점이 없다. */
  dotOf?(tab: TabItem, host: TabHost): TabDot | null;
  /** 팔레트 탭 행의 아이콘. 없으면 일반 탭이다. */
  readonly paletteIcon?: "terminal";
  /**
   * layout 파일 탭을 화면 탭으로 읽는다. 대상 필드가 맞지 않으면 null이고 그 탭만 빠진다.
   * key는 검증을 마친 값이고 position은 읽어 둔 읽던 위치다.
   */
  fromStored(
    stored: Readonly<Record<string, unknown>>,
    shared: {
      readonly key: string;
      readonly position: ReadPosition | undefined;
    },
  ): TabItem | null;
  /** 화면 탭을 schema 필드로 줄인다. 맞출 수 없으면 null이고 그 탭만 빠진다. */
  toStored(
    tab: TabItem,
    shared: { readonly position: ReadPosition | undefined },
  ): Record<string, unknown> | null;
  /** 이 탭이 focus일 때 agent가 읽을 앱 view를 가졌는지. */
  hasAppView?(tab: TabItem): boolean;
  /** 고른 탭의 본문. null이면 칸이 종류 자리표시를 그린다. */
  render?(tab: TabItem, active: boolean, host: TabHost): ReactNode | null;
  /** 고르지 않아도 칸에 남겨 둘 본문. null이 아니면 고른 탭만 보인다. */
  keep?(tab: TabItem, shown: boolean, host: TabHost): ReactNode | null;
  /** 닫기 전 확인. null이면 바로 닫고, 약속이면 true일 때만 닫는다. */
  beforeClose?(tab: TabItem, host: TabHost): Promise<boolean> | null;
}
