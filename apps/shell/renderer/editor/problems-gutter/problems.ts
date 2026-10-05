// documents/formats의 FormatDiagnostic을 편집기가 표시할 줄로 바꾼다. 다른 파일의 진단은
// 이 편집기의 줄이 아니라서 문서 전체 문제로 보인다.

/** documents/formats FormatDiagnostic에서 편집기가 읽는 field. */
export interface FormatDiagnostic {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly file: string | null;
  readonly start_line: number | null;
}

export interface EditorProblem {
  /** 1부터 세는 줄. 문서 전체 문제는 null이다. */
  readonly line: number | null;
  readonly message: string;
  readonly severity: "error" | "warning";
}

export function editorProblems(
  diagnostics: readonly FormatDiagnostic[],
  primaryPath: string,
): EditorProblem[] {
  return diagnostics.map((diagnostic) => ({
    line: diagnostic.file === primaryPath ? diagnostic.start_line : null,
    message: diagnostic.message,
    severity: diagnostic.severity,
  }));
}

/** 줄 없는 문제가 먼저, 그다음 줄 순서. */
export function sortProblems(
  problems: readonly EditorProblem[],
): EditorProblem[] {
  return [...problems].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}
