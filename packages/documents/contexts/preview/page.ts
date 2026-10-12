// context.preview 읽기의 page 자르기: worker가 낸 위반 전부에 문구를 붙이고 30개씩 자른다.
// cursor는 그 판(bundle)에 묶인다. 다른 판의 cursor는 invalid_input이다.
import type { Result } from "../../../base/mod.ts";
import {
  CONTEXT_PREVIEW_PAGE,
  type ContextPreviewRead,
  type ContextPreviewWorkResponse,
} from "../../../protocol/projects/mod.ts";
import { violationMessage } from "../api/violation-message.ts";
import { compareKey, type Key, pageByKey } from "../api/reads-common.ts";

const keyOf = (
  violation: ContextPreviewWorkResponse["violations"][number],
): Key => [
  violation.path,
  violation.kind,
  violation.rule ?? "",
  violation.section ?? "",
  violation.target ?? "",
  violation.type ?? "",
];

export function pagePreview(input: {
  context: string;
  bundle: string;
  cursor?: string;
  as_of_seq: string;
  outcome: ContextPreviewWorkResponse;
  // 미리 보는 draft의 계약. rule 위반의 문구가 규칙의 message를 쓰도록 건넨다.
  contract?: unknown;
}): Result<ContextPreviewRead> {
  const { outcome } = input;
  // 정렬은 worker가 path, kind, rule, section으로 정했다. 같은 값끼리의 순서까지 정해 keyset을 안정하게 한다.
  const sorted = [...outcome.violations].sort((a, b) =>
    compareKey(keyOf(a), keyOf(b))
  );
  const paged = pageByKey(
    sorted,
    keyOf,
    `context.preview:${input.bundle}`,
    {
      limit: CONTEXT_PREVIEW_PAGE,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    },
  );
  if (!paged.ok) return paged;
  return {
    ok: true,
    value: {
      context: input.context,
      bundle: input.bundle,
      types: outcome.types,
      violation_count: outcome.violation_count,
      violations: paged.value.items.map((violation) => ({
        kind: violation.kind,
        rule: violation.rule,
        path: violation.path,
        section: violation.section,
        type: violation.type,
        target: violation.target,
        message: violationMessage(violation, input.contract),
      })),
      findings: outcome.findings,
      as_of_seq: input.as_of_seq,
      complete: paged.value.complete,
      next_cursor: paged.value.next_cursor,
    },
  };
}
