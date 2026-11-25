// Permission rules가 읽고 쓰는 통로. 규칙은 선언 설정(`approvals.permission_rules`) 하나에 전역과 project별로 들어
// 있다. 제품 기본 목록은 protocol 상수라 통로를 거치지 않는다. 화면은 설정과 project 목록을 useCoreRead로 읽고
// 쓰기 route 이름은 core-source.ts만 안다.
import type {
  PermissionRule,
  PermissionRuleAction,
  PermissionRuleCategory,
} from "../../../../../protocol/approvals/permission-rules.ts";
import type { SourceResult } from "../source.ts";

export type {
  PermissionRule,
  PermissionRuleAction,
  PermissionRuleCategory,
  SourceResult,
};
export type ShellRule = PermissionRule;
export type ShellRuleAction = PermissionRuleAction;

/** 규칙이 놓인 층: 전역 또는 project 하나. */
export type ShellRuleLayer =
  | { readonly kind: "global" }
  | { readonly kind: "project"; readonly project: string };

export interface ShellRulesView {
  readonly global: readonly PermissionRule[];
  /** 모든 project(규칙이 없는 것 포함, 이름 순)와 설정에만 남은 project id(이름은 id). */
  readonly projects: readonly {
    readonly id: string;
    readonly name: string;
    readonly rules: readonly PermissionRule[];
  }[];
}

export interface ShellRulesSource {
  /** 층의 끝에 규칙을 더한다. 거절은 code가 이유다. */
  add(layer: ShellRuleLayer, rule: PermissionRule): Promise<SourceResult<null>>;
  remove(layer: ShellRuleLayer, index: number): Promise<SourceResult<null>>;
  setAction(
    layer: ShellRuleLayer,
    index: number,
    action: PermissionRuleAction,
  ): Promise<SourceResult<null>>;
}
