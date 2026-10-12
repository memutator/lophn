// 대표 발생과 직전 변화 선정. 순수 함수이며 같은 입력에서 같은
// 결과를 낸다. 현재 source로 비교값을 보충하지 않는다.

// 고정 근거의 fingerprint. 각 항목이 다르면 불일치 1이다.
export const FINGERPRINT_FIELDS = [
  "release",
  "command",
  "evidence",
  "stack",
] as const;
export type Fingerprint = {
  // 보고 당시 release. 모르면 null.
  release: string | null;
  // 실패 invocation의 command. 모르면 null.
  command: string | null;
  // 보존된 evidence 종류 집합(정렬한 `,` 연결). 없으면 빈 문자열.
  evidence: string;
  // 보존된 stack의 첫 source 위치 `path:line`. 없으면 null.
  stack: string | null;
};

// 불일치 점수식: 이미 고른 대표 각각과 항목 불일치 수를 세고 그 최솟값을 점수로 쓴다
// (고른 모든 대표와 다른 정도). 0이면 새 정보가 없는 후보다.
export const FINGERPRINT_SCORE = "min_mismatch_against_chosen" as const;

export function mismatch(a: Fingerprint, b: Fingerprint): number {
  let count = 0;
  for (const field of FINGERPRINT_FIELDS) if (a[field] !== b[field]) count += 1;
  return count;
}

export type OccurrenceCandidate = {
  id: string;
  // Report 접수 순서(event seq의 순위). 낮을수록 먼저 접수됐다.
  rank: number;
  fingerprint: Fingerprint;
};

export const MAX_REPRESENTATIVES = 3;

// 첫·마지막·가장 다른 발생 순서로 최대 3개를 중복 없이 낸다.
export function selectRepresentatives(
  candidates: readonly OccurrenceCandidate[],
): OccurrenceCandidate[] {
  if (candidates.length === 0) return [];
  const sorted = [...candidates].sort((a, b) => a.rank - b.rank);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const chosen = first.id === last.id ? [first] : [first, last];
  const rest = sorted.filter((item) =>
    !chosen.some((picked) => picked.id === item.id)
  );
  let best: OccurrenceCandidate | undefined;
  let bestScore = 0;
  for (const item of rest) {
    const score = Math.min(
      ...chosen.map((picked) => mismatch(picked.fingerprint, item.fingerprint)),
    );
    // 동률은 낮은 rank가 먼저라 `>`로만 갈아 끼운다.
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  if (best !== undefined && chosen.length < MAX_REPRESENTATIVES) {
    chosen.push(best);
  }
  return chosen;
}

export const PRECEDING_WINDOW_MS = 604_800_000;
export const MAX_PRECEDING_CHANGES = 12;

export type ChangeCandidate = {
  id: string;
  at_ms: number;
  // 먼저 기록된 변화일수록 낮다(release 준비 순서).
  order: number;
};

// 첫 발생 7일 전부터 조회 현재까지 중 첫 발생에 가까운 순서로 최대 12개를 고른다.
// 같은 거리에서는 먼저 기록된 변화가 앞선다.
export function selectPrecedingChanges(
  candidates: readonly ChangeCandidate[],
  firstObservedMs: number,
  nowMs: number,
): (ChangeCandidate & { distance_ms: number })[] {
  return candidates
    .filter((item) =>
      item.at_ms >= firstObservedMs - PRECEDING_WINDOW_MS &&
      item.at_ms <= nowMs
    )
    .map((item) => ({
      ...item,
      distance_ms: Math.abs(item.at_ms - firstObservedMs),
    }))
    .sort((a, b) => a.distance_ms - b.distance_ms || a.order - b.order)
    .slice(0, MAX_PRECEDING_CHANGES);
}

// n개 문제가 전체 상한 total을 나눠 쓰는 몫이다. 몫이 0이면 그 문제는 이 종류의 절을
// 얻지 못하고 이유는 `more` 절에 남는다. 앞선 문제가 나머지를 먼저 받는다.
export function allocate(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const extra = total % count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}
