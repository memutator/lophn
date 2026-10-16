import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  CatalogEntry,
  OptionValues,
} from "../../../protocol/lophn-agent/mod.ts";

// option 축 규칙이다. 어떤 model에 어떤 축과 값이 있는지는
// catalog 자료(CatalogEntry.options)만 말하고 이 모듈은 그 목록을 코드에 적지 않는다.
// 요청 필드로 옮기는 일은 wire.ts의 몫이다.

// 저장·호출 전에 없는 축이나 지원하지 않는 값을 invalid_input으로 거절한다.
// 다른 값으로 조용히 바꾸지 않고, 통과한 값은 입력과 같다. 맡김(없는 축)은 그대로 둔다.
export function validateOptionValues(
  entry: CatalogEntry,
  values: OptionValues,
): Result<Record<string, string>> {
  const axes = entry.options ?? [];
  for (const [id, value] of Object.entries(values)) {
    const axis = axes.find((candidate) => candidate.id === id);
    if (axis === undefined) {
      return err({
        code: "invalid_input",
        message: `이 model에 없는 option 축이다: ${id}`,
      });
    }
    if (!axis.values.some((candidate) => candidate.value === value)) {
      return err({
        code: "invalid_input",
        message: `이 model의 ${id} 축이 지원하지 않는 값이다: ${value}`,
      });
    }
  }
  return ok({ ...values });
}

// 검증한 뒤 호출에 쓸 값을 정한다. 값이 없는 축은 catalog가 확인한 default_value가 있으면
// 그 값을 채우고, 없으면 그 축을 비워 둔다.
export function resolveOptionValues(
  entry: CatalogEntry,
  values: OptionValues,
): Result<Record<string, string>> {
  const checked = validateOptionValues(entry, values);
  if (!checked.ok) return checked;
  const resolved: Record<string, string> = { ...checked.value };
  for (const axis of entry.options ?? []) {
    if (resolved[axis.id] === undefined && axis.default_value !== null) {
      resolved[axis.id] = axis.default_value;
    }
  }
  return ok(resolved);
}
