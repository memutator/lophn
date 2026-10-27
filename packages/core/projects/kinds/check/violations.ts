import type {
  KindsFileError,
  Violation,
} from "../../../../protocol/projects/mod.ts";

const text = (value: string | null): string => value ?? "";
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function kindsFileViolation(error: KindsFileError): Violation {
  return {
    source: "kinds_file",
    rule: error.rule,
    kind: error.kind,
    path: null,
    field: error.field,
    message: error.message,
  };
}

// kinds 파일 오류가 먼저(상한에 잘려도 남는다), 그 안은 (kind, path, field, rule)의 code unit 순이다. 같은 상태면
// 같은 목록이어야 hash가 같다.
export function sortViolations(violations: readonly Violation[]): Violation[] {
  return [...violations].sort(
    (a, b) =>
      compare(b.source, a.source) ||
      compare(text(a.kind), text(b.kind)) ||
      compare(text(a.path), text(b.path)) ||
      compare(text(a.field), text(b.field)) ||
      compare(a.rule, b.rule),
  );
}
