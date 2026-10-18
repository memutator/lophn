import type { VersionRef } from "../../types.ts";

// 양쪽에 있고 n이 다른 키만. core와 checks도 든다(같이 바뀌면 섞인 결과로 읽어야 한다).
// 한쪽에만 있는 키는 건너뛴다. ex-verdict가 reasons에 적는다.
export function changedComponents(
  base: Map<string, VersionRef>,
  variant: Map<string, VersionRef>,
): { from: VersionRef; to: VersionRef }[] {
  const out: { key: string; from: VersionRef; to: VersionRef }[] = [];
  for (const [key, from] of base) {
    const to = variant.get(key);
    if (to !== undefined && to.n !== from.n) out.push({ key, from, to });
  }
  return out
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ from, to }) => ({ from, to }));
}
