import { err, ok, type Result } from "../../../../packages/base/mod.ts";

// 호출하는 쪽(ex-cli)이 git으로 모아 넘기는 사실. 이 파일은 git을 부르지 않는다.
export type LockFacts = {
  spec_commit: string | null; // spec.json을 마지막으로 바꾼 commit. commit된 적이 없으면 null
  spec_dirty: boolean; // 작업 트리의 experiments/<id>/ 가 그 commit과 다르다
  spec_commit_on_current: boolean; // spec_commit이 지금(기준) checkout의 HEAD와 같거나 조상이다
  variant_has_spec_commit: boolean; // variant checkout의 HEAD가 spec_commit과 같거나 후손이다
  variant_spec_same: boolean; // variant HEAD의 spec.json byte가 spec_commit의 것과 같다
  cases_missing_at_spec_commit: string[]; // spec_commit에 시나리오 file이 없던 cases의 시나리오 id
};

// spec이 고침보다 먼저 확정됐는지. 고친 뒤에 쓰면 결과에 맞춰 규칙을 고르게 된다.
export function checkSpecLocked(
  facts: LockFacts,
): Result<{ spec_commit: string }> {
  const conflict = (message: string) =>
    err({ code: "conflict" as const, message });
  if (facts.spec_commit === null || facts.spec_dirty) {
    return conflict("commit the spec (and the case scenarios) first");
  }
  if (!facts.spec_commit_on_current) {
    return conflict("the spec commit is not in the base checkout");
  }
  if (!facts.variant_has_spec_commit) {
    return conflict("the variant must be built on top of the spec commit");
  }
  if (!facts.variant_spec_same) {
    return conflict("the spec changed in the variant");
  }
  if (facts.cases_missing_at_spec_commit.length > 0) {
    return conflict(
      `case scenarios are not in the spec commit: ${facts.cases_missing_at_spec_commit.join(
        ", ",
      )}`,
    );
  }
  return ok({ spec_commit: facts.spec_commit });
}
