// changeset이 응답을 한도(`max`) 안에 못 들어가게 하면 changeset만 빼고 알린다. 안 그러면 호출이 결과
// 모름으로 닫혀 rewind가 통째로 막힌다.
export function fitChangeset(body: unknown, max: number): unknown {
  const record = body as { changeset?: string | null };
  if (record.changeset === null || record.changeset === undefined) return body;
  const size = new TextEncoder().encode(JSON.stringify(body)).byteLength;
  if (size <= max) return body;
  return { ...record, changeset: null, changeset_dropped: "too_large" };
}
