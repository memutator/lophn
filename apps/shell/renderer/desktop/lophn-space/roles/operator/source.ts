// Operator 붙이기·바꾸기·멈춤·회수가 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은
// core-source.ts만 안다. 모양은 contracts(assignments·approvals·assignment-occurrences·documents)에서
// 이 화면이 쓰는 field만 옮긴 것이다(contracts를 들이면 zod가 renderer bundle에 들어간다).
import type {
  PresetEntry,
  RoleRow,
  RoleScope,
  SourceResult,
} from "../source.ts";

/** Operator를 붙일 수 있는 곳. project나 app이다. */
export interface OperatorScope {
  readonly kind: "project" | "app";
  readonly id: string;
}

export function isOperatorScope(scope: RoleScope): scope is OperatorScope {
  return scope.kind !== "all" && scope.id !== null;
}

/** 보고를 남길 수 있는 문서. 첫 판이 이미 있는 기존 문서뿐이다. */
export interface OutputChoice {
  readonly id: string;
  readonly title: string;
  /** 지금 최신 판. 사람이 검토한 초안의 고정 판으로 승인에 묶인다. */
  readonly version: string;
}

/** 그 앱에서 Operator가 읽을 수 있는 명령(확인이 필요 없는 읽기). */
export interface ReadChoice {
  readonly app: string;
  readonly command: string;
  readonly label: string;
}

/** Repeating check. 처음 시각(UTC ISO)과 간격이다. */
export interface Period {
  readonly firstAt: string;
  readonly everyMs: number;
}

/** 사람이 정한 Operator 구성 전체. 승인이 이 모양 그대로를 묶는다. */
export interface OperatorDraft {
  /** 이미 붙은 Operator를 바꾸는 것이면 그 역할. 없으면 새로 붙인다. */
  readonly change: RoleRow | null;
  readonly scope: OperatorScope;
  readonly preset: PresetEntry;
  readonly outputs: readonly {
    readonly document: string;
    readonly content: string;
    /** 검토한 판. */
    readonly version: string;
  }[];
  readonly reads: readonly { readonly app: string; readonly command: string }[];
  readonly period: Period;
}

/** 승인 창을 연 결과. 결정은 창에서 하고 화면은 `settle`로 따라간다. */
export interface Proposed {
  readonly approval: string;
  /** 새로 붙이면 만들 역할의 id. */
  readonly assignment: string;
}

/**
 * 승인이 어디까지 왔는지.
 * - waiting: 창에서 아직 결정하지 않았다.
 * - attached: 허락했고 적용까지 끝났다.
 * - declined: 거절·취소·만료로 끝나 아무것도 바뀌지 않았다.
 */
export type Settled = "waiting" | "attached" | "declined";

/** 건너뛴 회차. 앞선 일이 사람의 답을 기다리고 있었는지 가른다. */
export interface SkippedPeriod {
  readonly dueAt: string;
  readonly waitingForAnswer: boolean;
}

export interface OperatorSource {
  /** Operator Preset 목록(기본과 사람이 만든 것, 각 판 hash 포함). */
  presets(): Promise<SourceResult<readonly PresetEntry[]>>;
  /** 그 곳에서 보고로 쓸 수 있는 기존 문서. */
  outputChoices(
    scope: OperatorScope,
  ): Promise<SourceResult<readonly OutputChoice[]>>;
  /** 문서의 지금 최신 판. 이미 붙은 Operator를 바꿀 때 검토한 고정 판으로 쓴다. */
  versionOf(document: string): Promise<SourceResult<string>>;
  /** 그 앱이 읽게 할 수 있는 명령. */
  readChoices(app: string): Promise<SourceResult<readonly ReadChoice[]>>;
  /** 구성 전체를 승인 요청으로 고정하고 보호 확인 창을 연다. 결정은 사람이 창에서 한다. */
  propose(draft: OperatorDraft): Promise<SourceResult<Proposed>>;
  /** 승인 상태를 읽고, 허락됐으면 적용한다. 같은 승인에 다시 불러도 한 번만 적용된다. */
  settle(proposed: Proposed): Promise<SourceResult<Settled>>;
  /** 멈춤. 새 요청과 주기 일이 시작되지 않는다. 다시 시작은 `RolesSource.resume`이다. */
  pause(role: RoleRow): Promise<SourceResult<null>>;
  /** 회수. 지난 대화만 남는다. */
  withdraw(role: RoleRow): Promise<SourceResult<null>>;
  /** 최근에 건너뛴 주기 일. */
  skipped(role: RoleRow): Promise<SourceResult<readonly SkippedPeriod[]>>;
}
