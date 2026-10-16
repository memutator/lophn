// 발생 행(reports)의 앱·모드·진단 범위다. 열람 판정(`targetVisible`)에 넘긴다.
export function reportFacts(row: Record<string, unknown>) {
  return {
    app: String(row["app"]),
    problem: row["problem"] === null ? null : String(row["problem"]),
    mode: String(row["mode"]),
    diagnostic_scope: row["diagnostic_scope"] === null
      ? null
      : String(row["diagnostic_scope"]),
  };
}
