// package 판(x.y.z) 순서. 문자열 순서는 0.10.0이 0.9.0보다 앞에 오므로 숫자 세 칸을 비교한다.
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let at = 0; at < 3; at += 1) {
    const diff = (left[at] ?? 0) - (right[at] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
