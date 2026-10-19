// 예시 비교 규칙. Project Manager가 쓴 ticket `examples`와 이 check가 같은 규칙이어야 사람이 보는 결과와 어긋나지 않는다.
// 객체는 expect의 key가 다 있고 값이 맞아야 하며 actual의 나머지 key는 무시한다. 배열은 길이가 같고 원소가 차례로
// 맞아야 한다. 나머지는 `===`다. core를 import하지 않는다: variant로 바뀌어도 grader가 안 바뀌어야 해서 규칙만 베꼈다.
export function exampleMatches(expect: unknown, actual: unknown): boolean {
  if (Array.isArray(expect)) {
    return Array.isArray(actual) && expect.length === actual.length &&
      expect.every((item, index) => exampleMatches(item, actual[index]));
  }
  if (expect !== null && typeof expect === "object") {
    if (
      actual === null || typeof actual !== "object" || Array.isArray(actual)
    ) {
      return false;
    }
    const record = actual as Record<string, unknown>;
    return Object.entries(expect).every(([key, value]) =>
      Object.hasOwn(record, key) && exampleMatches(value, record[key])
    );
  }
  return expect === actual;
}
