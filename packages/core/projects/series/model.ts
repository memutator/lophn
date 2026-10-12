// Series 정렬과 다음 key 계산의 순수 계산. locale과 표시 direction에 독립적인
// key 자연 순과 format_field order_value 비교다. 저장·예약은 하지 않는다.
import { compareSeriesKeys } from "../../../protocol/projects/mod.ts";
import type {
  SeriesDraft,
  SeriesInstance,
  SeriesOrder,
} from "../../../protocol/projects/mod.ts";

export {
  compareSeriesKeys,
  documentNameForKey,
  suggestNextKey,
} from "../../../protocol/projects/mod.ts";

// 같은 타입의 format_field order_value를 비교한다. number는 수로, string은
// locale 무관 codepoint로 비교한다.
function compareOrderValues(
  order: SeriesOrder & { kind: "format_field" },
  left: SeriesInstance["order_value"],
  right: SeriesInstance["order_value"],
): number {
  if (order.type === "number") {
    const a = typeof left === "number" ? left : Number(left);
    const b = typeof right === "number" ? right : Number(right);
    return a - b;
  }
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// 가족 정렬. format_field는 같은 타입의 order_value 비교가 먼저고 동점은 기본
// key 자연 순과 Document ID로 결정한다(key 가지는 key 자연 순). descending은
// 최종 순서를 뒤집는다. 입력 배열은 바꾸지 않는다.
export function orderMembers(
  order: SeriesOrder,
  members: readonly SeriesInstance[],
): SeriesInstance[] {
  const ordered = members.map((instance, index) => ({ instance, index })).sort(
    (left, right) => {
      if (order.kind === "format_field") {
        const value = compareOrderValues(
          order,
          left.instance.order_value,
          right.instance.order_value,
        );
        if (value !== 0) return value;
      }
      const key = compareSeriesKeys(left.instance.key, right.instance.key);
      if (key !== 0) return key;
      return compareText(left.instance.document, right.instance.document) ||
        left.index - right.index;
    },
  ).map((entry) => entry.instance);
  return order.direction === "descending" ? ordered.reverse() : ordered;
}

// draft key가 현재 멤버·예약 key와 충돌하는지 검사한다. 예약은 하지 않는다.
export function draftKeyConflicts(
  members: readonly SeriesInstance[],
  reservedKeys: readonly string[],
  draft: SeriesDraft,
): boolean {
  return members.some((instance) => instance.key === draft.key) ||
    reservedKeys.includes(draft.key);
}
