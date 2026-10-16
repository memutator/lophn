// 탭 kind registry의 main 쪽 모양이다. kind마다 파일 하나가 layout 파일의 탭 값과 복원 규칙을
// 선언하고, layout schema·복원은 이 목록을 돌 뿐 kind 이름으로 가르지 않는다.
// kind를 더하는 일은 파일 하나와 registry.ts의 한 줄이다.
import type { z } from "zod";

type PlaceholderReason =
  | "app_unavailable"
  | "context_missing"
  | "search_missing";

type RestoredTab =
  | { kind: "tab"; tab: { kind: string; key: string } }
  | {
    kind: "placeholder";
    key: string;
    origin: string;
    title: string;
    reason: PlaceholderReason;
  };

/** 탭 대상을 지금 기준으로 검사하는 통로. 테스트가 가짜를 끼운다. */
interface RestoreTargets {
  /** 앱이 살아 있고 실행 가능한지. */
  app(app: string): Promise<boolean>;
  /** 이 프로젝트에 속한 보관되지 않은 context가 있는지. */
  context(context: string): Promise<boolean>;
  /** context의 적용된 계약이 그 이름의 검색을 아직 선언하는지. */
  declaredSearch(context: string, search: string): Promise<boolean>;
}

interface ReadPosition {
  section: string;
  scroll_offset: number;
}

/** 탭 kind 하나의 선언. L은 layout 파일 탭이다. */
interface TabKind<
  L extends { kind: string; key: string } = { kind: string; key: string },
> {
  /** TabLayout.kind에 쓰는 이름. registry 안 유일. */
  readonly kind: L["kind"];
  /** 이 kind가 가질 수 있는 TabLayout 필드와 제약. strict object이고 kind 리터럴을 포함한다. */
  readonly layout: z.ZodType<L>;
  /** 읽던 위치를 가진 kind만 준다. 다른 kind는 위치를 버린다. */
  readPosition?(tab: L): ReadPosition | undefined;
  /** 복원 때 대상 검사. 못 쓰는 대상은 이유를 가진 placeholder다. */
  restore(tab: L, targets: RestoreTargets): Promise<RestoredTab>;
}

/** 타입 정보를 지킨 채 선언하는 도우미다. */
export function defineTabKind<L extends { kind: string; key: string }>(
  kind: TabKind<L>,
): TabKind<L> {
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

