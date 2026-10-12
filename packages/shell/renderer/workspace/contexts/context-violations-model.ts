// Violations 화면이 쓰는 순수 값: 줄 정렬, 넘긴 위반 대조, 파일 이름.
import type { ViolationItem, ViolationKey } from "./source.ts";

/** 위반 하나를 가리키는 키(context 제외). */
export function violationKey(violation: ViolationKey): ViolationKey {
  return {
    kind: violation.kind,
    rule: violation.rule,
    path: violation.path,
    section: violation.section,
  };
}

export function keyText(key: ViolationKey): string {
  return JSON.stringify([key.kind, key.rule, key.path, key.section]);
}

/** 경로 순, 같은 경로면 section·종류·규칙 순. */
export function sortViolations(
  violations: readonly ViolationItem[],
): readonly ViolationItem[] {
  const text = (violation: ViolationItem) =>
    [
      violation.path,
      violation.section ?? "",
      violation.kind,
      violation.rule ?? "",
    ].join("\u0000");
  return [...violations].sort((a, b) => {
    const left = text(a);
    const right = text(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/** "eval/experiments/exp-012.md" → "exp-012.md" */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
