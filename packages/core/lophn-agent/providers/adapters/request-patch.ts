import type { JsonObject, JsonValue } from "../../../../protocol/base/mod.ts";

// option 값이 요청 body에 싣는 조각을 호출 형식 adapter가 만든 body에 합친다(harness/model#R22).
// 조각은 번역(wire.ts)이 정한 값이고 이 함수는 model 이름이나 호출 형식을 모른다.

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeObjects(
  base: Readonly<Record<string, unknown>>,
  patch: JsonObject,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, incoming] of Object.entries(patch)) {
    const existing = merged[key];
    // 양쪽이 object면 안으로 들어가 합친다. 그 밖(배열·scalar)은 사람이 고른 option의 조각이 이긴다.
    merged[key] = isJsonObject(incoming) && typeof existing === "object" &&
        existing !== null && !Array.isArray(existing)
      ? mergeObjects(existing as Record<string, unknown>, incoming)
      : structuredClone(incoming);
  }
  return merged;
}

// body를 바꾸지 않고 합친 새 body를 돌려준다. 빈 조각은 더할 것이 없다는 뜻이다.
export function mergeRequestPatch(
  body: Readonly<Record<string, unknown>>,
  patch: JsonObject | undefined,
): Record<string, unknown> {
  return patch === undefined ? { ...body } : mergeObjects(body, patch);
}
