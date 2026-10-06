// context watch가 쓰는 derived 자리(documents#T24): `watch` cursor와 `watch_unverified`, 그리고
// 전후 판의 section 상태 읽기. search consumer(consumer.ts)와 같은 derived store를 쓰지만 cursor가
// 따로라서 서로를 기다리지 않는다. 한 판의 비교가 끝나면 미확인 목록과 cursor를 한 derived
// transaction에 쓴다. ledger에는 아무것도 쓰지 않고 model·agent run을 시작하지 않는다.
// core graph가 mod.ts로 이 파일을 import하므로 derived store 어댑터(node:sqlite)에 닿지 않고
// 구조 type만 쓴다. DerivedStore가 이 모양을 그대로 만족한다.
import { ok, type Result } from "../../base/mod.ts";
import type { SqlParams } from "../../contracts/platform/mod.ts";
import type { SectionSnapshot } from "./model.ts";
import { WATCH_CONSUMER } from "./work-consumers.ts";

type WatchSql = {
  run(sql: string, params: SqlParams): unknown;
  get(sql: string, params: SqlParams): Record<string, unknown> | undefined;
  all(sql: string, params: SqlParams): Record<string, unknown>[];
};

export type WatchRead = { sql: WatchSql };

export type WatchStore = {
  transaction<T>(handle: (tx: { sql: WatchSql }) => Result<T>): Result<T>;
  readonly read: WatchRead;
};

// 한 판의 한 section 상태. ready는 그 key의 section(없으면 빈 목록)이고 unknown은 추출 미완료·
// 실패·미지원·미확인이라 section을 말할 수 없는 판이다(contexts#R11).
export type DerivedSectionState =
  | { kind: "ready"; snapshot: SectionSnapshot }
  | { kind: "unknown"; reason: string };

export const WATCH_PENDING_REASON = "extraction pending";

export function watchCursorOf(read: WatchRead): string {
  const row = read.sql.get(
    `SELECT processed_seq FROM derived_cursors WHERE consumer = ?`,
    [WATCH_CONSUMER],
  );
  return row === undefined ? "0" : String(row["processed_seq"]);
}

// 뒤로 가지 않는다. 같은 자리면 다시 쓰지 않는다.
function setWatchCursor(sql: WatchSql, seq: string): void {
  const current = sql.get(
    `SELECT processed_seq FROM derived_cursors WHERE consumer = ?`,
    [WATCH_CONSUMER],
  );
  if (
    current !== undefined &&
    BigInt(String(current["processed_seq"])) >= BigInt(seq)
  ) {
    return;
  }
  sql.run(
    `INSERT INTO derived_cursors (consumer, processed_seq, rebuilding, rebuild_basis_seq)
     VALUES (?, ?, 0, NULL)
     ON CONFLICT(consumer) DO UPDATE SET processed_seq = excluded.processed_seq`,
    [WATCH_CONSUMER, seq],
  );
}

// 확인할 일이 없는 event를 지나 cursor만 앞으로 보낸다.
export function advanceWatchCursor(
  store: WatchStore,
  seq: string,
): Result<{ processed_seq: string }> {
  return store.transaction((tx) => {
    setWatchCursor(tx.sql, seq);
    return ok({ processed_seq: watchCursorOf({ sql: tx.sql }) });
  });
}

export type WatchUnverifiedRow = {
  context: string;
  document: string;
  // null이면 문서 전체다. section watch만 미확인이 된다.
  section: string | null;
  source_seq: string;
  context_revision: string;
  before_version: string | null;
  after_version: string;
  reason: string;
};

export function listWatchUnverified(read: WatchRead): WatchUnverifiedRow[] {
  return read.sql.all(
    `SELECT context, document, section, source_seq, context_revision,
            before_version, after_version, reason
     FROM watch_unverified
     ORDER BY CAST(source_seq AS INTEGER), context, document, section`,
    [],
  ).map((row) => ({
    context: String(row["context"]),
    document: String(row["document"]),
    section: row["section"] === null ? null : String(row["section"]),
    source_seq: String(row["source_seq"]),
    context_revision: String(row["context_revision"]),
    before_version: row["before_version"] === null
      ? null
      : String(row["before_version"]),
    after_version: String(row["after_version"]),
    reason: String(row["reason"]),
  }));
}

// 한 저장 event의 비교가 끝났다: 그 event의 미확인 목록을 이번 결과로 바꾸고(이전에 미확인이던
// 것이 확인되거나 낡았으면 사라진다) cursor를 그 event까지 진행한다. command가 수락된 뒤에만
// 부른다.
export function applyWatchStep(
  store: WatchStore,
  step: { source_seq: string; unverified: readonly WatchUnverifiedRow[] },
): Result<{ processed_seq: string }> {
  return store.transaction((tx) => {
    tx.sql.run(`DELETE FROM watch_unverified WHERE source_seq = ?`, [
      step.source_seq,
    ]);
    for (const row of step.unverified) {
      tx.sql.run(
        `INSERT OR REPLACE INTO watch_unverified
           (context, target_key, document, section, source_seq, context_revision,
            before_version, after_version, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.context,
          // 같은 문서·section은 한 행이다. 읽을 때는 아래 두 열을 쓴다.
          `${row.document}\u0000${row.section ?? ""}`,
          row.document,
          row.section,
          row.source_seq,
          row.context_revision,
          row.before_version,
          row.after_version,
          row.reason,
        ],
      );
    }
    setWatchCursor(tx.sql, step.source_seq);
    return ok({ processed_seq: watchCursorOf({ sql: tx.sql }) });
  });
}

// 한 판에서 key 하나의 section 상태. 이 key의 section만 읽는다.
export function loadWatchSectionState(
  read: WatchRead,
  version: string,
  key: string,
): DerivedSectionState {
  const row = read.sql.get(
    `SELECT module_hash, extraction_status, failure_reason, unverified_reason
     FROM derived_versions WHERE version = ?`,
    [version],
  );
  if (row === undefined) {
    return { kind: "unknown", reason: WATCH_PENDING_REASON };
  }
  const status = String(row["extraction_status"]);
  if (status === "failed") {
    return {
      kind: "unknown",
      reason: row["failure_reason"] === null
        ? "extraction failed"
        : String(row["failure_reason"]),
    };
  }
  if (status === "unsupported") {
    return { kind: "unknown", reason: "extraction unsupported" };
  }
  if (status !== "ready") {
    return {
      kind: "unknown",
      reason: row["unverified_reason"] === null ||
          row["unverified_reason"] === undefined
        ? "extraction unverified"
        : String(row["unverified_reason"]),
    };
  }
  const section = read.sql.get(
    `SELECT key, title, position, body_hash FROM derived_sections
     WHERE version = ? AND key = ?`,
    [version, key],
  );
  return {
    kind: "ready",
    snapshot: {
      module_hash: String(row["module_hash"]),
      sections: section === undefined ? [] : [{
        key: String(section["key"]),
        title: String(section["title"]),
        position: Number(section["position"]),
        body_hash: String(section["body_hash"]),
      }],
    },
  };
}
