// context의 현재 상태 하나를 contexts 표에서 읽는다. 다른 concern(lophn-agent/presets)이 context
// 선택을 검사할 때 표를 직접 읽지 않고 이 조회를 쓴다. 없는 ID와 읽기 실패는 undefined다
// (읽는 쪽이 fail-closed로 다루게 한다).
import type { Sql } from "../../../protocol/platform/mod.ts";

export type ContextStatusValue = "drafting" | "active" | "archived";

export function contextStatusOf(
  sql: Pick<Sql, "get">,
  context: string,
): ContextStatusValue | undefined {
  try {
    const row = sql.get("select status from contexts where id = ?", [context]);
    const status = row === undefined ? undefined : row["status"];
    return status === "drafting" || status === "active" ||
        status === "archived"
      ? status
      : undefined;
  } catch {
    return undefined;
  }
}
