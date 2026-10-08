// settings 진단 자리가 읽는 통로. doctor 결과(diagnostics/check)의 영향 한 문장과 다음 행동만
// 기본으로 보이고 원문(check·finding·코드)은 개발자 diagnostics 펼침에만 둔다(shell/wording#R8).
// 모양은 contracts(diagnostics)에서 이 자리가 쓰는 field만 옮긴 것이다.
import type { SourceResult } from "../source.ts";

export type { SourceResult };

/** doctor가 실제로 검사하는 항목(contracts DIAGNOSTIC_CHECKS와 같다). */
export type DiagnosticCheckName =
  | "sdk_hash"
  | "credential_permission"
  | "broad_grant"
  | "file_and_network_grant"
  | "unused_grant"
  | "raw_key_pattern";

/** 사람이 읽을 한 문장(영향)과 다음 행동. finding이 없으면 clean이다. */
export interface DiagnosticRow {
  readonly check: DiagnosticCheckName;
  /** 문제를 찾았는지. 찾지 못한 항목은 clean이다. */
  readonly finding: null | {
    /** 사람이 겪는 영향 한 문장. */
    readonly impact: "wide_grant" | "raw_key";
    /** 원문 finding message. 개발자 diagnostics 펼침에만 보인다. */
    readonly raw: string;
    readonly at: string;
  };
}

export interface DiagnosticsView {
  readonly rows: readonly DiagnosticRow[];
  readonly observedAt: string;
}

export type SecurityCheckName = "broad_grant" | "raw_key_pattern";

export interface DiagnosticsSource {
  /** 사이 check를 돌린다. 사람이 누를 때만 부른다. */
  check(): Promise<SourceResult<DiagnosticsView>>;
}
