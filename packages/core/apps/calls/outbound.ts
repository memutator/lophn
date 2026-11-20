import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AppRemoteCallRecord,
  appRemoteCallRecordSchema,
  appRemoteCalls,
} from "../../../protocol/apps/calls/mod.ts";
import { type Id, idSchema } from "../../../protocol/base/ids.ts";
import type {
  ReadDefinition,
  Sql,
  SqlParam,
  Tx,
} from "../../../protocol/server/mod.ts";

type Query = Pick<Sql, "get" | "all">;

const PAGE = 50;
const ERROR_MAX = 512;

export type OutboundCalls = {
  // 보내기 전에 남긴다. 실패하면 부른 쪽은 기록 없이 보내지 않는다.
  begin(call: {
    id: Id<"rcl">;
    caller: AppRemoteCallRecord["caller"];
    machine: Id<"mch">;
    computer: string;
    app: Id<"app">;
    command: string;
    at: string;
  }): Result<void>;
  finish(
    id: Id<"rcl">,
    end: {
      status: Exclude<AppRemoteCallRecord["status"], "running">;
      error: string | null;
      at: string;
    },
  ): Result<void>;
  // 기동 때 running으로 남은 줄은 그 호출의 끝을 본 근거가 없다.
  closeStale(at: string): Result<void>;
};

type Deps = {
  transaction<T>(fn: (tx: Tx) => Result<T>): Result<T>;
  // 줄을 쓴 transaction이 commit된 뒤 부른다. 대상 앱과 부른 앱의 화면이 다시 읽게 알린다.
  changed(app: string, callerApp: string | null): void;
};

export function createOutboundCalls(deps: Deps): OutboundCalls {
  return {
    begin(call) {
      const by = call.caller;
      const done = deps.transaction((tx) => {
        tx.sql.run(
          `INSERT INTO app_remote_calls
             (id, caller, caller_app, session, machine, computer, app, command, status, started_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
          [
            call.id,
            JSON.stringify(by),
            by.kind === "app" ? by.app : null,
            by.kind === "agent" ? by.session : null,
            call.machine,
            call.computer,
            call.app,
            call.command,
            call.at,
          ],
        );
        return ok(undefined);
      });
      if (done.ok) deps.changed(call.app, by.kind === "app" ? by.app : null);
      return done;
    },
    finish(id, end) {
      let targetApp = "";
      let callerApp: string | null = null;
      const done = deps.transaction((tx) => {
        const row = tx.sql.get(
          "SELECT app, caller_app FROM app_remote_calls WHERE id = ?",
          [id],
        );
        if (row === undefined) {
          return err({
            code: "not_found",
            message: "remote call not recorded",
          });
        }
        targetApp = String(row["app"]);
        callerApp = (row["caller_app"] as string | null) ?? null;
        tx.sql.run(
          `UPDATE app_remote_calls SET status = ?, finished_at = ?, error = ?
            WHERE id = ? AND status = 'running'`,
          [end.status, end.at, end.error?.slice(0, ERROR_MAX) ?? null, id],
        );
        return ok(undefined);
      });
      if (done.ok) deps.changed(targetApp, callerApp);
      return done;
    },
    closeStale(at) {
      return deps.transaction((tx) => {
        tx.sql.run(
          `UPDATE app_remote_calls
              SET status = 'unknown', finished_at = ?, error = 'result_not_observed'
            WHERE status = 'running'`,
          [at],
        );
        return ok(undefined);
      });
    },
  };
}

function recordOf(row: Record<string, unknown>): Result<AppRemoteCallRecord> {
  const parsed = appRemoteCallRecordSchema.safeParse({
    id: row["id"],
    caller: JSON.parse(String(row["caller"])),
    machine: row["machine"],
    computer: row["computer"],
    app: row["app"],
    command: row["command"],
    status: row["status"],
    started_at: row["started_at"],
    finished_at: row["finished_at"],
    error: row["error"],
  });
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "internal", message: "invalid stored remote call" });
}

// 새 것부터(id는 시간 순서다).
export function listOutboundCalls(
  sql: Query,
  filter: {
    app?: string;
    caller_app?: string;
    session?: string;
    cursor?: string;
    limit?: number;
  },
): Result<{ calls: AppRemoteCallRecord[]; next_cursor: string | null }> {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (filter.app !== undefined) {
    where.push("app = ?");
    params.push(filter.app);
  }
  if (filter.caller_app !== undefined) {
    where.push("caller_app = ?");
    params.push(filter.caller_app);
  }
  if (filter.session !== undefined) {
    where.push("session = ?");
    params.push(filter.session);
  }
  if (filter.cursor !== undefined) {
    where.push("id < ?");
    params.push(filter.cursor);
  }
  const limit = filter.limit ?? PAGE;
  const rows = sql.all(
    `SELECT * FROM app_remote_calls ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`}
      ORDER BY id DESC LIMIT ?`,
    [...params, limit + 1],
  );
  const calls: AppRemoteCallRecord[] = [];
  for (const row of rows.slice(0, limit)) {
    const record = recordOf(row);
    if (!record.ok) return record;
    calls.push(record.value);
  }
  return ok({
    calls,
    next_cursor: rows.length > limit ? calls[calls.length - 1].id : null,
  });
}

export function createOutboundCallReads(): {
  list: ReadDefinition<typeof appRemoteCalls>;
} {
  return {
    list: {
      route: appRemoteCalls,
      handle(snapshot, _ctx, input) {
        if (
          input.cursor !== undefined &&
          !idSchema("rcl").safeParse(input.cursor).success
        ) {
          return err({ code: "invalid_input", message: "invalid cursor" });
        }
        const listed = listOutboundCalls(snapshot.sql, input);
        if (!listed.ok) return listed;
        return ok({ ...listed.value, as_of_seq: snapshot.as_of_seq });
      },
    },
  };
}
