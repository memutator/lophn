// search 읽기 handler의 공용 타입. route 선언은 contract가 하고, 여기서는
// ledger snapshot과 derived read의 표면만 둔다.

export type SearchSnapshotSql = {
  get(
    query: string,
    params: readonly unknown[],
  ): Record<string, unknown> | undefined;
  all(query: string, params: readonly unknown[]): Record<string, unknown>[];
};

export type SearchSnapshot = {
  // ledger read snapshot. 문서·판 metadata는 같은 seq의 일관된 snapshot이다.
  as_of_seq: string;
  sql: SearchSnapshotSql;
};

export type SearchFilters = {
  place?: { kind: "project" | "app"; id: string };
  context?: string;
  formats?: string[];
};

export type PortLookup = {
  port<T>(key: unknown): T;
};
