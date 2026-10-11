// 탭 kind registry의 renderer 쪽 모양이다(shell/workspace#R14). kind마다 파일 하나가 이름·layout
// 값 읽기와 쓰기·현재 보기 힌트·본문·열기 진입을 모두 선언하고, 탭 줄·layout map·view hint·칸은
// 이 목록을 돌 뿐 kind 이름으로 가르지 않는다. kind를 더하는 일은 파일 하나와 registry.ts의 한 줄이다.
import type { ReactNode } from "react";
import type { IconProps } from "@lophn/design/components";
import type { MessageKey } from "@lophn/wording";

import type { TabItem } from "../model.ts";
import type { TabHost } from "./host.ts";

export interface ReadPosition {
  readonly section: string;
  readonly scroll_offset: number;
}

/** 문서 탭이 지금 보이는 판과 읽기·편집. */
export interface TabPresentation {
  readonly editing: boolean;
  readonly version: string;
}

/** main에 보내는 힌트 탭. 제목·경로·본문·터미널 출력은 넣지 않는다. */
export type HintTab =
  & { readonly kind: string; readonly key: string }
  & Readonly<
    Record<string, unknown>
  >;

/** 힌트를 만들 때 화면이 가진 kind별 관측 값. */
export interface HintContext {
  /** 문서 탭 key마다 지금 보이는 판. */
  readonly presentation: Readonly<Record<string, TabPresentation>>;
  /** 앱 패널 탭 key마다 연 view의 session. */
  readonly sessions: Readonly<Record<string, string>>;
}

/** 탭 줄 오른쪽 끝의 열기 단추. 통로가 있는 kind만 낸다. */
export interface TabLauncher {
  readonly labelKey: MessageKey;
  /** 지금 열 수 있는지. 통로가 없으면 단추를 두지 않는다. */
  available(host: TabHost): boolean;
  open(host: TabHost): void;
}

export interface TabKindDef {
  /** TabLayout.kind에 쓰는 이름. registry 안 유일. */
  readonly kind: string;
  /** 탭 줄에 쓰는 종류 글자의 wording key(workspace#R1). */
  readonly labelKey: MessageKey;
  readonly icon: IconProps["icon"];
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
  /** 현재 보기 힌트. 아직 모르는 값이 있으면 null이다. */
  hint(tab: TabItem, ctx: HintContext): HintTab | null;
  /** 힌트에 필요한 값을 아직 모르는 탭인지. main은 그 탭이 빠지기 전에 기다릴 수 있다. */
  pending?(tab: TabItem, ctx: HintContext): boolean;
  /** 이 탭이 focus일 때 agent가 읽을 앱 view를 가졌는지. */
  hasAppView?(tab: TabItem): boolean;
  /** 고른 탭의 본문. null이면 칸이 종류 자리표시를 그린다. */
  render?(tab: TabItem, active: boolean, host: TabHost): ReactNode | null;
  /** 고르지 않아도 칸에 남겨 둘 본문. null이 아니면 고른 탭만 보인다. */
  keep?(tab: TabItem, shown: boolean, host: TabHost): ReactNode | null;
  /** 닫기 전 확인. null이면 바로 닫고, 약속이면 true일 때만 닫는다. */
  beforeClose?(tab: TabItem, host: TabHost): Promise<boolean> | null;
  /** 탭 줄 `+` 자리의 열기 단추. */
  readonly launcher?: TabLauncher;
}
