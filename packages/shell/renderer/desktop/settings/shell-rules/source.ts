// Shell rules가 읽고 쓰는 통로. 규칙은 선언 설정(`approvals.shell_rules`) 하나에 전역과 project별로 들어
// 있다. 제품 기본 목록은 protocol 상수라 통로를 거치지 않는다. 화면은 이 interface만 보고 core route
// 이름은 core-source.ts만 안다.
import type { ShellRule } from "../../../../../protocol/approvals/shell-rules.ts";
import type { SourceResult } from "../source.ts";

export type { ShellRule, SourceResult };

export type ShellRuleAction = ShellRule["action"];

/** 규칙이 놓인 층: 전역(Workspace) 또는 project 하나. */
export type ShellRuleLayer =
  | { readonly kind: "global" }
  | { readonly kind: "project"; readonly project: string };

export interface ShellRulesView {
  readonly global: readonly ShellRule[];
  /** 모든 project(규칙이 없는 것 포함, 이름 순)와 설정에만 남은 project id(이름은 id). */
  readonly projects: readonly {
    readonly id: string;
    readonly name: string;
    readonly rules: readonly ShellRule[];
  }[];
}

export interface ShellRulesSource {
  /** core 연결 상태를 듣는다. 준비되면 화면이 다시 읽는다. 해제는 반환 함수다. */
  watch(listener: (state: { readonly state: string }) => void): () => void;
  read(): Promise<SourceResult<ShellRulesView>>;
  /** 층의 끝에 규칙을 더한다. 거절은 code가 이유다. */
  add(layer: ShellRuleLayer, rule: ShellRule): Promise<SourceResult<null>>;
  remove(layer: ShellRuleLayer, index: number): Promise<SourceResult<null>>;
  setAction(
    layer: ShellRuleLayer,
    index: number,
    action: ShellRuleAction,
  ): Promise<SourceResult<null>>;
}
