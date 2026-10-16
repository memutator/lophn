// Violations 화면이 쓰는 순수 값: 줄 key, 줄 정렬, 파일 이름, Project Manager에게 넘길 chip.
import type { ContextChipView } from "../../conversation/composer/types.ts";
import type { ViolationItem } from "./source.ts";

export function keyText(key: ViolationItem): string {
  return JSON.stringify([key.kind, key.rule, key.path, key.section]);
}

/** 위반 하나가 chip 하나다. label은 context 이름이다. */
export function violationChips(
  label: string,
  violations: readonly ViolationItem[],
): readonly ContextChipView[] {
  return violations.map((item) => ({
    id: keyText(item),
    label,
    violation: { file: item.path, rule: item.rule ?? item.message },
  }));
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
