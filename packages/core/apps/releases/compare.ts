// 이전 release와의 비교. 고정 선언 둘의 정적 비교다.
// 같은 입력 schema라는 이유로 호환을 주장하지 않는다: 효과·확인·되돌림이 바뀌면 동작 변경이고,
// 이름·설명만 바뀐 것은 따로 낸다. 업무 의미의 동일성은 증명하지 않으므로 바뀐 것이 있으면
// `review_required`다. 데이터 계약은 apps/data 근거(`data_schema`·`data_changes`), 접근 요청은
// apps/permissions 근거(`added_permissions`)로 나눠 낸다.
import type {
  ActivationComparison,
  AppGrant,
  DataChange,
} from "../../../protocol/apps/mod.ts";
import { type AppFacts, compareFacts } from "../permissions/mod.ts";

// 비교는 command 꼴로 한다. 새 선언에는 confirm·revert가 없어서 그 칸은 늘 비어 있다.

// activation에서 묻는 판정 값이다. 선언 비교는 grant 덮음 하나다: 새 release의 선언 가운데 지금 active
// grant가 덮지 않는 것이 늘어난 것이고, 이전 release와 선언을 따로 비교하지 않는다. data 손실은 이번에 지나는
// migration 단계가 선언한 `loss`를 믿는다. DB 사본에서 돌려 재지 않는다.
export function compareForActivation(input: {
  previous: { id: string; data_schema: number } | null;
  grants: readonly AppGrant[];
  facts: Pick<AppFacts, "permissions" | "app_connections">;
  next: { data_changes: readonly DataChange[] };
}): ActivationComparison {
  const { previous } = input;
  const gap = compareFacts(input.grants, input.facts);
  const from = previous?.data_schema ?? 0;
  return {
    previous_release: previous === null
      ? null
      : previous.id as ActivationComparison["previous_release"],
    first: previous === null,
    added_resources: gap.added_resources,
    added_tools: gap.added_tools,
    loss_steps: input.next.data_changes.filter((change) =>
      change.from >= from && (change.loss ?? []).length > 0
    ).map((change) => ({
      from: change.from,
      to: change.to,
      loss: [...(change.loss ?? [])],
    })),
  };
}

// 첫 activation이거나 늘어난 선언, 손실 단계가 하나라도 있으면 사람에게 묻는다.
export function asksFor(comparison: ActivationComparison): boolean {
  return comparison.first || comparison.added_resources.length > 0 ||
    comparison.added_tools.length > 0 ||
    comparison.loss_steps.length > 0;
}
