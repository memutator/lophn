// read 결과의 원천 상태. 정상 0행과 미수집·부분 범위·신선도 부족을 구별한다.
// 이어 읽기 cursor는 처음 조건·정렬·데이터 기준에 묶인다.

export const READ_COVERAGE = ["complete", "partial", "uncollected"] as const;
export const READ_FRESHNESS = ["fresh", "stale", "unknown"] as const;

export type ReadCoverage = (typeof READ_COVERAGE)[number];
export type ReadFreshness = (typeof READ_FRESHNESS)[number];

export type ReadQuery = {
  filter: unknown;
  order: unknown;
  basis: unknown;
};

export type ReadContinuation = {
  query: ReadQuery;
  cursor: string;
};

export type ReadSource<T> = {
  rows: T[];
  coverage: ReadCoverage;
  freshness: ReadFreshness;
  continuation: string | null;
};

export function readResult<T>(
  rows: T[],
  source: {
    coverage: ReadCoverage;
    freshness: ReadFreshness;
    continuation?: ReadContinuation;
  },
): ReadSource<T> {
  return {
    rows,
    coverage: source.coverage,
    freshness: source.freshness,
    continuation: source.continuation
      ? encodeContinuation(source.continuation)
      : null,
  };
}

export function continueRead<T>(
  previous: ReadContinuation,
  next: ReadQuery,
  rows: T[],
  source: { coverage: ReadCoverage; freshness: ReadFreshness },
): ReadSource<T> {
  if (!sameQuery(previous.query, next)) {
    throw new Error("continuation query changed");
  }
  return readResult(rows, source);
}

function encodeContinuation(value: ReadContinuation): string {
  return JSON.stringify(value);
}

export function decodeContinuation(value: string): ReadContinuation {
  const parsed = JSON.parse(value) as ReadContinuation;
  if (
    !parsed || typeof parsed !== "object" ||
    typeof parsed.cursor !== "string" ||
    !parsed.query
  ) throw new Error("continuation is invalid");
  return parsed;
}

function sameQuery(left: ReadQuery, right: ReadQuery): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
