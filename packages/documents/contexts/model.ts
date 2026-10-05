// ContextTarget의 canonical target key와 항목 순서 계산. 순수 계산만 남는다.
import type { ContextTarget } from "../../contracts/documents/mod.ts";

// target_key는 tagged target의 canonical encoding이다. 전체 문서 null section과
// app 가지를 구분하며 읽기·watch중복 처리가 같은 encoding을 쓴다.
export function targetKey(target: ContextTarget): string {
  return target.kind === "document"
    ? `document\u0000${target.document}\u0000${target.section ?? ""}`
    : `app_command\u0000${target.app}\u0000${target.command}`;
}

// position은 0부터 연속이다. 삽입 지점 뒤 항목을 한 칸씩 민다.
export function insertPositions<T extends { position: number }>(
  items: readonly T[],
  at: number,
): T[] {
  return items.map((item) =>
    item.position >= at ? { ...item, position: item.position + 1 } : item
  );
}

// 제거 뒤 뒤 항목을 한 칸씩 당겨 연속을 지킨다.
export function removePositions<T extends { position: number }>(
  items: readonly T[],
  removed: number,
): T[] {
  return items.map((item) =>
    item.position > removed ? { ...item, position: item.position - 1 } : item
  );
}
