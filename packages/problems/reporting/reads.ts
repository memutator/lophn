import { err, ok, type Result } from "../../base/mod.ts";
import {
  NOT_FOUND,
  parseSeqCursor,
  requireOperation,
  scanVisible,
  targetVisible,
} from "./access.ts";
import type {
  Input,
  Output,
  ReadSnapshot,
  RequestContext,
} from "../../contracts/platform/mod.ts";
import type { z } from "zod";
import {
  getReport,
  getSnapshot,
  listReports,
  type snapshotItemSchema,
} from "../../contracts/problems/mod.ts";

type SnapshotItem = z.infer<typeof snapshotItemSchema>;

const REPORT_PAGE = 100;

type ReportRowSeq = { seq: bigint; row: Record<string, unknown> };

// list는 problem 하나 또는 app+diagnostic scope로 묻는다(input schema가 필수를 검증한다).
// problem이 있는 Report는 운영 보고뿐이라 test·preview 진단은 해당 scope로만 나오고 운영 집계에
// 들어가지 않는다. 정렬은 접수 event seq 내림차순이고 cursor는 마지막 seq다.
export const listReportsRead = {
  route: listReports,
  handle(
    snapshot: ReadSnapshot,
    ctx: RequestContext,
    input: Input<typeof listReports>,
  ): Result<Output<typeof listReports>> {
    const granted = requireOperation(ctx, listReports.name);
    if (!granted.ok) return granted;
    const cursor = parseSeqCursor(input.cursor);
    if (!cursor.ok) return cursor;
    const where: string[] = [];
    const filter: (string | number)[] = [];
    if (input.problem !== undefined) {
      where.push("r.problem = ?");
      filter.push(input.problem);
    }
    if (input.app !== undefined) {
      where.push("r.app = ?");
      filter.push(input.app);
    }
    if (input.diagnostic_scope !== undefined) {
      where.push("r.diagnostic_scope = ?");
      filter.push(input.diagnostic_scope);
    }
    const page = scanVisible<ReportRowSeq>({
      limit: REPORT_PAGE,
      before: cursor.value,
      load: (before, size) => {
        const clauses = before === null ? where : [...where, "e.seq < ?"];
        const params: (string | number | bigint)[] = before === null
          ? [...filter]
          : [...filter, before];
        params.push(size);
        return snapshot.sql.all(
          `select r.id, r.app, r.problem, r.source, r.mode, r.diagnostic_scope, r.code,
                  r.snapshot, r.observed_at, r.release, e.seq as seq
           from reports r join events e on e.subject = r.id and e.type = 'ReportRecorded'
           where ${clauses.join(" and ")} order by e.seq desc limit ?`,
          params,
        ).map((row) => ({ seq: BigInt(String(row["seq"])), row }));
      },
      visible: ({ row }) =>
        targetVisible(snapshot, ctx, listReports.name, reportFacts(row)),
    });
    if (!page.ok) return page;
    return ok({
      reports: page.value.rows.map(({ row }) => summaryOf(row)),
      as_of_seq: snapshot.as_of_seq,
      next_cursor: page.value.next,
    });
  },
};

function reportFacts(row: Record<string, unknown>) {
  return {
    app: String(row["app"]),
    problem: row["problem"] === null ? null : String(row["problem"]),
    mode: String(row["mode"]),
    diagnostic_scope: row["diagnostic_scope"] === null
      ? null
      : String(row["diagnostic_scope"]),
  };
}

function summaryOf(row: Record<string, unknown>): {
  id: string;
  app: string;
  problem: string | null;
  source: "app" | "exception" | "feedback";
  mode: "live" | "preview" | "test";
  code: string;
  snapshot: string;
  observed_at: string;
  release: string | null;
} {
  return {
    id: String(row["id"]),
    app: String(row["app"]),
    problem: row["problem"] === null ? null : String(row["problem"]),
    source: String(row["source"]) as "app" | "exception" | "feedback",
    mode: String(row["mode"]) as "live" | "preview" | "test",
    code: String(row["code"]),
    snapshot: String(row["snapshot"]),
    observed_at: String(row["observed_at"]),
    release: row["release"] === null ? null : String(row["release"]),
  };
}

// 조회 응답의 report는 text·details Principled hash를 포함한다(raw stack은 snapshot item read 권한이다).
function fullReportOf(row: Record<string, unknown>): {
  id: string;
  app: string;
  mode: "live" | "preview" | "test";
  source: "app" | "exception" | "feedback";
  diagnostic_scope: string | null;
  release: string | null;
  release_missing_reason: string | null;
  bundle_hash: string | null;
  code: string;
  text: string | null;
  details: string | null;
  snapshot: string;
  observed_at: string;
  principal: string;
  content_hash: string;
  problem: string | null;
} {
  return {
    id: String(row["id"]),
    app: String(row["app"]),
    mode: String(row["mode"]) as "live" | "preview" | "test",
    source: String(row["source"]) as "app" | "exception" | "feedback",
    diagnostic_scope: row["diagnostic_scope"] === null
      ? null
      : String(row["diagnostic_scope"]),
    release: row["release"] === null ? null : String(row["release"]),
    release_missing_reason: row["release_missing_reason"] === null
      ? null
      : String(row["release_missing_reason"]),
    bundle_hash: row["bundle_hash"] === null
      ? null
      : String(row["bundle_hash"]),
    code: String(row["code"]),
    text: row["text"] === null ? null : String(row["text"]),
    details: row["details"] === null ? null : String(row["details"]),
    snapshot: String(row["snapshot"]),
    observed_at: String(row["observed_at"]),
    principal: String(row["principal"]),
    content_hash: String(row["content_hash"]),
    problem: row["problem"] === null ? null : String(row["problem"]),
  };
}

const SNAPSHOT_COLUMNS = `id, captured_at,
  invocation, invocation_binding, invocation_record_missing_reason, invocation_missing_reason,
  error_name, error_missing_reason, error_message, error_message_missing_reason, error_frames, error_source_missing_reason, error_stack, error_stack_missing_reason, error_truncation_notes,
  logs_blob, logs_line_count, logs_truncated, logs_scope, logs_from_at, logs_to_at, logs_collected_at, logs_missing_reason,
  screen_name, screen_observed_at, screen_state, screen_state_missing_reason, screen_screenshot, screen_screenshot_missing_reason, screen_missing_reason`;

// 상세는 수리 조회 권한(credential의 GetReport)이 있을 때만 열린다. 저장된 값은 저장 전
// redaction을 거친 것이고 stack·log·글 원문은 hash 참조뿐이다(blob은 일반 read가 없다).
// 범위 밖 Report는 없는 Report와 같은 not_found다.
export const getReportRead = {
  route: getReport,
  handle(
    snapshot: ReadSnapshot,
    ctx: RequestContext,
    input: Input<typeof getReport>,
  ): Result<Output<typeof getReport>> {
    const granted = requireOperation(ctx, getReport.name);
    if (!granted.ok) return granted;
    const row = snapshot.sql.get(
      `select id, app, problem, source, mode, diagnostic_scope, release, release_missing_reason, bundle_hash, code, text, details, snapshot, observed_at, principal, content_hash from reports where id = ?`,
      [input.report],
    );
    const visible = row === undefined
      ? ok(false)
      : targetVisible(snapshot, ctx, getReport.name, reportFacts(row));
    if (!visible.ok) return visible;
    if (row === undefined || !visible.value) {
      return err({ code: "not_found", message: NOT_FOUND });
    }
    const snapshotRow = snapshot.sql.get(
      `select ${SNAPSHOT_COLUMNS} from snapshots where id = ?`,
      [String(row["snapshot"])],
    );
    return ok({
      report: fullReportOf(row),
      attachments: snapshot.sql.all(
        "select field, hash, size_bytes from blob_refs where owner_kind = ? and owner_key = ?",
        ["report", input.report],
      ).map((ref) => ({ field: String(ref.field), hash: String(ref.hash), size_bytes: Number(ref.size_bytes) })),
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
      snapshot: snapshotRow === undefined ? null : snapshotOf(snapshotRow),
      missing: {
        invocation: itemMissingOf(snapshotRow, "invocation"),
        error: itemMissingOf(snapshotRow, "error"),
        logs: itemMissingOf(snapshotRow, "logs"),
        screen: itemMissingOf(snapshotRow, "screen"),
      },
    });
  },
};

// 항목이 없으면 그 이유, invocation은 ID만 알고 기록이 아직 없으면 그 이유다.
function itemMissingOf(
  row: Record<string, unknown> | undefined,
  item: SnapshotItem,
): { reason: string } | null {
  return missingOf(row, `${item}_missing_reason`) ??
    (item === "invocation"
      ? missingOf(row, "invocation_record_missing_reason")
      : null);
}

function missingOf(
  row: Record<string, unknown> | undefined,
  column: string,
): { reason: string } | null {
  const value = row?.[column];
  return value === null || value === undefined || value === ""
    ? null
    : { reason: String(value) };
}

type SnapshotShape = NonNullable<
  Output<typeof getReport>["snapshot"]
>;

function snapshotOf(row: Record<string, unknown>): SnapshotShape {
  return {
    id: String(row["id"]),
    captured_at: String(row["captured_at"]),
    invocation_missing_reason: missingOf(row, "invocation_missing_reason"),
    error_missing_reason: missingOf(row, "error_missing_reason"),
    logs_missing_reason: missingOf(row, "logs_missing_reason"),
    screen_missing_reason: missingOf(row, "screen_missing_reason"),
    invocation: row["invocation"] === null ? null : {
      id: String(row["invocation"]),
      binding: String(row["invocation_binding"]) as
        | "sdk_context"
        | "view_context",
      record_missing_reason: missingOf(row, "invocation_record_missing_reason"),
    },
    error: row["error_name"] === null ? null : {
      name: String(row["error_name"]),
      message: row["error_message"] === null
        ? null
        : String(row["error_message"]),
      message_missing_reason: missingOf(row, "error_message_missing_reason"),
      frames: row["error_frames"] === null
        ? []
        : JSON.parse(String(row["error_frames"])),
      source_missing_reason: missingOf(row, "error_source_missing_reason"),
      stack: row["error_stack"] === null ? null : String(row["error_stack"]),
      stack_missing_reason: missingOf(row, "error_stack_missing_reason"),
      truncation_notes: JSON.parse(
        String(row["error_truncation_notes"] ?? "[]"),
      ),
    },
    logs: row["logs_blob"] === null ? null : {
      blob: String(row["logs_blob"]),
      line_count: Number(row["logs_line_count"]),
      truncated: row["logs_truncated"] === 1 || row["logs_truncated"] === true,
      scope: String(row["logs_scope"]),
      from_at: row["logs_from_at"] === null
        ? null
        : String(row["logs_from_at"]),
      to_at: row["logs_to_at"] === null ? null : String(row["logs_to_at"]),
      collected_at: String(row["logs_collected_at"]),
    },
    screen: row["screen_name"] === null ? null : {
      name: String(row["screen_name"]),
      observed_at: String(row["screen_observed_at"]),
      state: row["screen_state"] === null ? null : String(row["screen_state"]),
      state_missing_reason: missingOf(row, "screen_state_missing_reason"),
      screenshot: row["screen_screenshot"] === null
        ? null
        : String(row["screen_screenshot"]),
      screenshot_missing_reason: missingOf(
        row,
        "screen_screenshot_missing_reason",
      ),
    },
  };
}

export const getSnapshotRead = {
  route: getSnapshot,
  handle(
    snapshot: ReadSnapshot,
    ctx: RequestContext,
    input: Input<typeof getSnapshot>,
  ): Result<Output<typeof getSnapshot>> {
    const granted = requireOperation(ctx, getSnapshot.name);
    if (!granted.ok) return granted;
    const row = snapshot.sql.get(
      `select ${SNAPSHOT_COLUMNS} from snapshots where id = ?`,
      [input.snapshot],
    );
    // Snapshot은 Report 하나에만 붙는다. 범위는 그 Report의 앱·문제·진단 범위가 정한다.
    const owner = row === undefined ? undefined : snapshot.sql.get(
      `select app, problem, mode, diagnostic_scope from reports where snapshot = ?`,
      [input.snapshot],
    );
    const visible = owner === undefined
      ? ok(false)
      : targetVisible(snapshot, ctx, getSnapshot.name, reportFacts(owner));
    if (!visible.ok) return visible;
    if (row === undefined || !visible.value) {
      return err({ code: "not_found", message: NOT_FOUND });
    }
    const item = input.item === undefined ? null : readItem(row, input.item);
    const blobs = [
      ["snapshot_stack", row["error_stack"]],
      ["snapshot_logs", row["logs_blob"]],
      ["feedback_state", row["screen_state"]],
      ["feedback_screenshot", row["screen_screenshot"]],
    ].filter(([, hash]) => hash !== null && hash !== undefined).map((
      [purpose, hash],
    ) => ({ purpose: String(purpose), hash: String(hash) }));
    return ok({
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
      snapshot: snapshotOf(row),
      item: item as Output<typeof getSnapshot>["item"],
      blobs,
      missing: input.item === undefined ? null : itemMissingOf(row, input.item),
    });
  },
};

function readItem(
  row: Record<string, unknown>,
  item: SnapshotItem | undefined,
): unknown {
  switch (item) {
    case "invocation":
      return snapshotOf(row)["invocation"];
    case "error":
      return snapshotOf(row)["error"];
    case "logs":
      return snapshotOf(row)["logs"];
    case "screen":
      return snapshotOf(row)["screen"];
  }
}
