import { err, ok, type Result } from "../../../base/mod.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import type {
  RequestPhase,
  RequestRecord,
  SideStart,
  StoredSideStart,
  TestConnection,
} from "./model.ts";
import { flag, nextSeq } from "./sql-value.ts";

const CONFLICT = "같은 요청의 내용이 다르다";

export function currentRunner(records: readonly RequestRecord[]): string {
  const binding = [...records].reverse().find((record) =>
    record.phase === "recovery" || record.phase === "accepted"
  );
  return binding?.runner_principal ?? "";
}

export function loadRecords(
  sql: Pick<Sql, "all">,
  principal: string,
  key: string,
): RequestRecord[] {
  const rows = sql.all(
    `select seq, request_principal, request_key, request_hash, phase, accepted,
            preparation_failed, at, start_unknown, result_ref, runner_principal,
            reason, previous_runner, payload
     from test_requests
     where request_principal = ? and request_key = ?
     order by seq`,
    [principal, key],
  );
  return rows.flatMap((row) => {
    const seq = nextSeq(row.seq);
    if (!seq.ok) return [];
    return [{
      seq: seq.value,
      request_principal: String(row.request_principal),
      request_key: String(row.request_key),
      request_hash: String(row.request_hash),
      phase: String(row.phase) as RequestPhase,
      accepted: flag(row.accepted),
      preparation_failed: flag(row.preparation_failed),
      at: row.at === null ? null : String(row.at),
      start_unknown: flag(row.start_unknown),
      result_ref: row.result_ref === null ? null : String(row.result_ref),
      runner_principal: row.runner_principal === null
        ? null
        : String(row.runner_principal),
      reason: String(row.reason),
      previous_runner: row.previous_runner == null
        ? null
        : String(row.previous_runner),
      payload: JSON.parse(String(row.payload)) as TestConnection,
    }];
  });
}

export function appendRecord(
  tx: Tx,
  record: Omit<RequestRecord, "seq">,
): Result<bigint> {
  const raw = tx.sql.get(
    `select coalesce(max(seq), 0) + 1 as seq from test_requests`,
    [],
  )?.seq;
  const seq = nextSeq(raw);
  if (!seq.ok) return seq;
  tx.sql.run(
    `insert into test_requests (
       seq, request_principal, request_key, request_hash, phase, accepted,
       preparation_failed, at, start_unknown, result_ref, runner_principal,
       reason, previous_runner, payload
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      seq.value,
      record.request_principal,
      record.request_key,
      record.request_hash,
      record.phase,
      record.accepted ? 1 : 0,
      record.preparation_failed ? 1 : 0,
      record.at,
      record.start_unknown ? 1 : 0,
      record.result_ref,
      record.runner_principal,
      record.reason,
      record.previous_runner ?? null,
      JSON.stringify(record.payload),
    ],
  );
  return ok(seq.value);
}

export function loadSideStarts(
  sql: Pick<Sql, "all">,
  principal: string,
  key: string,
  hash: string,
): StoredSideStart[] {
  const rows = sql.all(
    `select request_principal, request_key, request_hash, runner_principal,
            side, bundle_hash, test_hash, started_at
     from test_side_starts
     where request_principal = ? and request_key = ? and request_hash = ?
     order by seq`,
    [principal, key, hash],
  );
  return rows.map((row) => ({
    request_principal: String(row.request_principal),
    request_key: String(row.request_key),
    request_hash: String(row.request_hash),
    runner_principal: String(row.runner_principal),
    side: String(row.side) as SideStart["side"],
    bundle_hash: String(row.bundle_hash),
    test_hash: String(row.test_hash),
    started_at: String(row.started_at),
  }));
}

export function appendSideStart(
  tx: Tx,
  start: StoredSideStart,
): Result<bigint> {
  const existing = loadSideStarts(
    tx.sql,
    start.request_principal,
    start.request_key,
    start.request_hash,
  ).find((row) => row.side === start.side);
  if (existing) {
    const same = existing.bundle_hash === start.bundle_hash &&
      existing.test_hash === start.test_hash &&
      existing.started_at === start.started_at &&
      existing.runner_principal === start.runner_principal;
    if (!same) return err({ code: "conflict", message: CONFLICT });
    const row = tx.sql.get(
      `select seq from test_side_starts where request_principal = ? and request_key = ? and request_hash = ? and side = ?`,
      [
        start.request_principal,
        start.request_key,
        start.request_hash,
        start.side,
      ],
    );
    return nextSeq(row?.seq);
  }
  const raw = tx.sql.get(
    `select coalesce(max(seq), 0) + 1 as seq from test_side_starts`,
    [],
  )?.seq;
  const seq = nextSeq(raw);
  if (!seq.ok) return seq;
  tx.sql.run(
    `insert into test_side_starts (
       seq, request_principal, request_key, request_hash, runner_principal,
       side, bundle_hash, test_hash, started_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      seq.value,
      start.request_principal,
      start.request_key,
      start.request_hash,
      start.runner_principal,
      start.side,
      start.bundle_hash,
      start.test_hash,
      start.started_at,
    ],
  );
  return ok(seq.value);
}
