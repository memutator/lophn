// search 읽기 handler의 공용 타입. route 선언은 contract가 하고, 여기서는
// ledger snapshot과 derived read의 표면만 둔다. context filter는 ContextItemSource가
// 주는 contract context items 목록으로 좁힌다. 없는 context나 읽을 수 없는
// context는 fail-closed로 후보를 전부 비운다(documents/contexts, R12).
import type { Result } from "../../base/mod.ts";

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

// context filter의 근원. documents/contexts read contract(loadContext)가 주는
// items 목록을 주입해 받는다. 없는 context는 빈 목록이다(존재를 새지 않는다).
export type ContextItemSource = {
  // target 중 document 종류만 후보 좁힘에 쓴다.
  items(contextId: string): Result<readonly ContextItemTarget[]>;
};

export type ContextItemTarget = {
  kind: "document" | "app_command";
  document?: string;
  app?: string;
};
