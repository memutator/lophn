import type { Result } from "../../base/mod.ts";
import { ok } from "../../base/mod.ts";
import type {
  BlobRefRegistration,
  RequestContext,
  Sql,
  SqlParams,
  SqlRow,
  Tx,
} from "../../contracts/platform/mod.ts";
import { TEST_SCHEMA_STEPS } from "./schema.ts";

type Memory = { rows: Map<string, SqlRow[]> };

function table(sql: string): string {
  const match = /\b(?:into|from)\s+([a-z_]+)/i.exec(sql);
  return match?.[1] ?? "";
}

export function memorySql(): Sql & { rows: (name: string) => SqlRow[] } {
  const memory: Memory = { rows: new Map() };
  const sql: Sql & { rows: (name: string) => SqlRow[] } = {
    rows: (name) => memory.rows.get(name) ?? [],
    run(statement, params) {
      const name = table(statement);
      if (statement.trim().startsWith("insert")) {
        const columns = statement.slice(
          statement.indexOf("(") + 1,
          statement.indexOf(")"),
        ).split(",").map((column) => column.trim());
        const row: SqlRow = {};
        columns.forEach((column, index) => {
          row[column] = params[index] ?? null;
        });
        const existing = memory.rows.get(name) ?? [];
        existing.push(row);
        memory.rows.set(name, existing);
        return { changes: 1, lastInsertRowid: existing.length };
      }
      return { changes: 0, lastInsertRowid: 0 };
    },
    get(statement, params) {
      return sql.all(statement, params)[0];
    },
    all(statement, params) {
      const name = statement.includes("where app = ?")
        ? "verifications"
        : table(statement);
      let rows = [...(memory.rows.get(name) ?? [])];
      if (statement.includes("where app = ?")) {
        const [app, problem, , ticket, , kind, , after, asOf] = params;
        const limit = params[params.length - 1];
        const columns = [...statement.matchAll(/([a-z_]+) is \?/g)].map((
          match,
        ) => match[1]);
        const scoped = rows.filter((row) =>
          columns.every((column, index) => row[column] === params[9 + index])
        );
        return scoped.filter((row) =>
          row.app === app &&
          (problem === null || row.problem === problem) &&
          (ticket === null || row.ticket === ticket) &&
          (kind === null || row.kind === kind) &&
          BigInt(String(row.recorded_seq)) > BigInt(String(after)) &&
          BigInt(String(row.recorded_seq)) <= BigInt(String(asOf))
        ).sort((left, right) => {
          const a = BigInt(String(left.recorded_seq));
          const b = BigInt(String(right.recorded_seq));
          return a < b ? -1 : a > b ? 1 : 0;
        }).slice(0, Number(limit));
      }
      if (statement.includes("request_principal = ?")) {
        rows = rows.filter((row) =>
          row.request_principal === params[0] && row.request_key === params[1]
        );
      }
      if (
        statement.includes("test_side_starts") &&
        statement.includes("and side = ?")
      ) {
        rows = rows.filter((row) =>
          row.request_hash === params[2] && row.side === params[3]
        );
      }
      if (statement.includes("verifications where id")) {
        rows = rows.filter((row) => row.id === params[0]);
      }
      if (statement.includes("verification_reports where verification")) {
        rows = rows.filter((row) => row.verification === params[0]);
      }
      if (statement.includes("max(seq)")) {
        const max = rows.reduce((best, row) => {
          const seq = typeof row.seq === "bigint"
            ? row.seq
            : BigInt(Number(row.seq));
          return seq > best ? seq : best;
        }, 0n);
        return [{ seq: max + 1n }];
      }
      if (statement.includes("order by seq")) {
        rows.sort((left, right) => {
          const a = typeof left.seq === "bigint"
            ? left.seq
            : BigInt(Number(left.seq));
          const b = typeof right.seq === "bigint"
            ? right.seq
            : BigInt(Number(right.seq));
          return a < b ? -1 : a > b ? 1 : 0;
        });
      }
      if (statement.includes("recorded_seq as integer) <= ?")) {
        rows = rows.filter((row) =>
          BigInt(String(row.recorded_seq)) <= BigInt(String(params[1]))
        );
      }
      return rows;
    },
  };
  return sql;
}

export function fakeTx(options: {
  now?: string;
  ids?: string[];
  blob?: (
    reference: BlobRefRegistration,
  ) => Result<{
    owner_kind: string;
    owner_key: string;
    field: string;
    hash: string;
    registered_seq: string;
  }>;
} = {}): Tx & { events: unknown[]; sql: ReturnType<typeof memorySql> } {
  const sql = memorySql();
  const ids = [...(options.ids ?? [])];
  let eventSeq = 1;
  const events: unknown[] = [];
  return {
    sql,
    events,
    now: () => options.now ?? "2026-10-04T00:00:00.000Z",
    newId: () => ids.shift() ?? "vrf_01ary8h2z3n4p5q6r7s8t9v0wx",
    port: () => {
      throw new Error("no port");
    },
    registerBlobRef: (reference) =>
      options.blob?.(reference) ?? ok({
        owner_kind: reference.owner_kind,
        owner_key: reference.owner_key,
        field: reference.field,
        hash: reference.source.kind === "prepared"
          ? reference.source.blob.hash
          : reference.source.reference.hash,
        registered_seq: reference.registered_seq,
      }),
    advanceSubscriberCursor: () => ok(undefined),
    useApproval: () => {
      throw new Error("no approval");
    },
    call: () => {
      throw new Error("no call");
    },
    emit(_event, subject, payload) {
      const seq = String(eventSeq++);
      events.push({ seq, subject, payload });
      return seq;
    },
  };
}

export function ctx(patch: Partial<RequestContext> = {}): RequestContext {
  return {
    principal: "runner-1",
    actor: "machine",
    scope: { operations: [], targets: {} },
    conditions: {},
    credential_ref: "cred-1",
    ...patch,
  };
}

export function schemaSql(): string {
  return TEST_SCHEMA_STEPS.map((step) => step.sql).join("\n");
}

export type { SqlParams };
