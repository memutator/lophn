// 탭 kind registry의 main 쪽 모양이다. kind마다 파일 하나가 아래를 모두 선언하고,
// layout schema·복원·현재 보기 조립·힌트 읽기는 이 목록을 돌 뿐 kind 이름으로 가르지 않는다.
// kind를 더하는 일은 파일 하나와 registry.ts의 한 줄이다.
import type { z } from "zod";

export type PlaceholderReason =
  | "document_missing"
  | "app_unavailable"
  | "no_permission"
  | "context_missing"
  | "search_missing"
  | "agent_missing";

export type RestoredTab =
  | { kind: "tab"; tab: { kind: string; key: string } }
  | {
    kind: "placeholder";
    key: string;
    origin: string;
    title: string;
    reason: PlaceholderReason;
  };

/** 탭 대상을 지금 기준으로 검사하는 통로. 테스트가 가짜를 끼운다. */
export interface RestoreTargets {
  /** 문서가 살아 있는지. */
  documentExists(document: string): Promise<boolean>;
  /** 앱이 살아 있고 실행 가능한지. */
  app(app: string): Promise<boolean>;
  /** 사람의 읽기 권한이 있는지. */
  canRead(document: string): Promise<boolean>;
  /** 이 프로젝트에 속한 보관되지 않은 context가 있는지. */
  context(context: string): Promise<boolean>;
  /** context의 적용된 계약이 그 이름의 검색을 아직 선언하는지. */
  declaredSearch(context: string, search: string): Promise<boolean>;
  /** agent(assignment)가 withdraw되지 않았고 session이 있으면 지워지지 않았는지. session이 null이면 agent만 본다. */
  agent(agent: string, session: string | null): Promise<boolean>;
}

/** 힌트의 참조를 현재 허용 대상과 대조하는 통로. */
export interface ViewScope {
  project(id: string): boolean;
  /** 그룹(`document`·`app`처럼 kind가 정한 이름)의 참조가 지금 허용 대상인지. */
  allows(group: string, ref: string): boolean;
}

/** scope 대상을 읽는 자리. kind가 자기 힌트의 대상마다 부른다. */
export interface ScopeReads {
  /** 같은 group·ref는 한 번만 읽는다. 읽혀야 `ViewScope.allows`가 참이다. */
  allow(
    group: string,
    ref: string,
    resource: string,
    body: unknown,
  ): void;
}

/** 앱 view의 현재 값. window의 실제 view registry가 정한다. */
export interface ViewRegistry {
  isLive(windowRef: string): boolean;
  appView(
    app: string,
    surface: string,
  ): {
    release: string;
    mode: "live" | "preview";
    view_generation: number;
  } | null;
  // 이 창에 열린 그 앱·screen의 패널 view가 정말 이 view_session인지. 없으면 session을 싣지 않는다.
  panelSession?(app: string, surface: string, view_session: string): boolean;
}

export interface ViewContext {
  readonly scope: ViewScope;
  readonly registry: ViewRegistry;
  /** 80자 넘는 화면 문자열을 줄인다. */
  truncate(value: string): string;
  /** 비어 있지 않고 80자 이하인 참조인지. */
  refOk(value: unknown): value is string;
}

export interface ReadPosition {
  section: string;
  scroll_offset: number;
}

/**
 * 탭 kind 하나의 선언. L은 layout 파일 탭, H는 renderer 힌트 탭, V는 현재 보기 탭이다.
 */
export interface TabKind<
  L extends { kind: string; key: string } = { kind: string; key: string },
  H extends { kind: string; key: string } = { kind: string; key: string },
  V extends { kind: string; key: string; selected: boolean } = {
    kind: string;
    key: string;
    selected: boolean;
  },
> {
  /** TabLayout.kind에 쓰는 이름. registry 안 유일. */
  readonly kind: L["kind"] & H["kind"] & V["kind"];
  /** 이 kind가 가질 수 있는 TabLayout 필드와 제약. strict object이고 kind 리터럴을 포함한다. */
  readonly layout: z.ZodType<L>;
  /** 읽던 위치를 가진 kind만 준다. 다른 kind는 위치를 버린다. */
  readPosition?(tab: L): ReadPosition | undefined;
  /** 복원 때 대상 검사. 못 쓰는 대상은 이유를 가진 자리표시다. */
  restore(tab: L, targets: RestoreTargets): Promise<RestoredTab>;
  /** renderer 힌트 wire를 힌트 탭으로 읽는다. 맞지 않으면 null이다. */
  hint(raw: Record<string, unknown>, key: string): H | null;
  /** 힌트의 대상 중 scope 읽기가 필요한 것을 알린다. */
  scope(hint: H, reads: ScopeReads): void;
  /** 현재 보기 탭. 범위 밖이면 null이고 조립이 omission을 남긴다. */
  view(hint: H, selected: boolean, ctx: ViewContext): V | null;
  /** 요약 줄에 쓰는 대상 이름. */
  describe(view: V): string;
  /** 앱 view를 가진 kind만 준다. agent view를 연 탭의 app_view를 정한다. */
  appView?(
    hint: H,
    registry: ViewRegistry,
  ): {
    app: string;
    surface: string;
    release: string;
    mode: "live" | "preview";
    view_generation: number;
  } | null;
}

/** 타입 정보를 지킨 채 선언하는 도우미다. */
export function defineTabKind<
  L extends { kind: string; key: string },
  H extends { kind: string; key: string },
  V extends { kind: string; key: string; selected: boolean },
>(kind: TabKind<L, H, V>): TabKind<L, H, V> {
  return kind;
}

const kinds = new Map<string, TabKind>();

/**
 * kind를 registry에 올린다. 같은 이름이 이미 있으면 거절한다. 돌려주는 함수로 내린다 — 기본
 * kind는 registry.ts가 올리고, 이 함수는 테스트가 가짜 kind를 끼울 때도 쓴다.
 */
export function registerTabKind(kind: TabKind): () => void {
  if (kinds.has(kind.kind)) {
    throw new Error(`tab kind already registered: ${kind.kind}`);
  }
  kinds.set(kind.kind, kind);
  return () => {
    if (kinds.get(kind.kind) === kind) kinds.delete(kind.kind);
  };
}

export function tabKindOf(kind: unknown): TabKind | undefined {
  return typeof kind === "string" ? kinds.get(kind) : undefined;
}

export function tabKinds(): readonly TabKind[] {
  return [...kinds.values()];
}
