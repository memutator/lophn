// app-data 명령 결과에서 result_path를 따라 내려간 배열의 항목을 꺼낸다.
// key가 없거나 값이 배열이 아니면 빈 목록이다(위반으로 세지 않는다).
export function resultItems(
  result: unknown,
  resultPath: readonly string[],
): readonly unknown[] {
  let value = result;
  for (const key of resultPath) {
    if (!isRecord(value) || !Object.hasOwn(value, key)) return [];
    value = value[key];
  }
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
