// 위반 한 줄의 문구. 순수 함수(추출·검사)는 문구 없이 위반을 내고, 읽기가 이 문구를 붙인다.
// 저장된 위반 목록(context.violations)과 context.preview가 같은 문구를 쓴다.
export function violationMessage(violation: {
  kind: string;
  rule: string | null;
  path: string;
  type: string | null;
  target: string | null;
}): string {
  const at = violation.target === null ? "" : ` (${violation.target})`;
  switch (violation.kind) {
    case "rule":
      return `${violation.rule ?? "rule"} is violated${at}`;
    case "unreadable":
      return `${violation.path} cannot be read${at}`;
    case "path_mismatch":
      return `${violation.path} does not match the ${
        violation.type ?? "type"
      } pattern`;
    default:
      return `the link to ${violation.target ?? "its target"} does not resolve`;
  }
}
