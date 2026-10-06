import { ok, type Result } from "../../base/mod.ts";
import type { JsonObject } from "../../contracts/platform/mod.ts";
import { hashOf, type RevertGroup, type RevertRunGroup } from "./model.ts";

// 준비. RevertRun이 한 transaction에서 복원하려면 owner가 복원에 필요한 준비 결과(예: 문서의
// 이전 판을 다시 준비한 결과)를 입력에 실어야 한다. transaction 안에서는 file·blob 준비를 하지
// 못하기 때문이다. 이 함수는 사람이 본 preview의 묶음에서 RevertRun 입력의 groups를 만든다.
// 복원 가능한 묶음마다 `prepare`가 준비 결과를 돌려주면 comparison.prepared에 싣고 그 hash를
// prepared_ref로 둔다. 준비하지 못한 묶음은 그대로 두고, owner가 복원 준비 불충족으로 막는다.
export type PrepareGroup = (
  group: RevertGroup,
) => Promise<Result<JsonObject | null>>;

export async function buildRevertInput(
  groups: readonly RevertGroup[],
  prepare: PrepareGroup,
): Promise<Result<RevertRunGroup[]>> {
  const items: RevertRunGroup[] = [];
  for (const group of groups) {
    const comparison = group.comparison ?? {};
    if (group.capability !== "reversible") {
      items.push({
        source_seqs: group.source_seqs,
        comparison,
        prepared_ref: null,
      });
      continue;
    }
    const prepared = await prepare(group);
    if (!prepared.ok) return prepared;
    items.push(
      prepared.value === null
        ? { source_seqs: group.source_seqs, comparison, prepared_ref: null }
        : {
          source_seqs: group.source_seqs,
          comparison: { ...comparison, prepared: prepared.value },
          prepared_ref: hashOf(prepared.value),
        },
    );
  }
  return ok(items);
}
