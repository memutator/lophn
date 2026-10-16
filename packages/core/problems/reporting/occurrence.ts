import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  Input,
  Output,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import {
  PROBLEM_MESSAGE_PREVIEW_CHARS,
  problemGetOccurrence,
  type ProblemOccurrence,
} from "../../../protocol/problems/mod.ts";
import { readProblemSnapshot } from "../snapshots/mod.ts";
import { NOT_FOUND, requireOperation, targetVisible } from "./access.ts";
import { reportFacts } from "./reads.ts";

const BROKEN = "저장된 발생을 읽을 수 없다";

// 문제 상세와 한 발생의 읽기가 같이 쓰는 발생 한 줄이다.
export function occurrenceOf(row: Record<string, unknown>): ProblemOccurrence {
  return {
    report: String(row["id"]),
    observed_at: String(row["observed_at"]),
    source: String(row["source"]) as ProblemOccurrence["source"],
    release: row["release"] === null ? null : String(row["release"]),
  };
}

type OccurrenceRead = {
  // preview는 비어 있다. 글 바이트는 blob store에서 읽어 `withMessagePreview`로 채운다.
  view: Output<typeof problemGetOccurrence>;
  message: { hash: string; size_bytes: number } | null;
};

// `problem.get_occurrence`의 ledger 쪽 읽기. 글 바이트는 동기 reader가 못 읽으므로 부르는 쪽이
// blob 통로로 이어 채운다.
export function readOccurrence(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  input: Input<typeof problemGetOccurrence>,
): Result<OccurrenceRead> {
  const granted = requireOperation(ctx, problemGetOccurrence.name);
  if (!granted.ok) return granted;
  const row = snapshot.sql.get(
    `select id, app, problem, source, mode, diagnostic_scope, release, name,
            message, details, snapshot, observed_at
     from reports where id = ?`,
    [input.report],
  );
  const visible = row === undefined
    ? ok(false)
    : targetVisible(snapshot, ctx, problemGetOccurrence.name, reportFacts(row));
  if (!visible.ok) return visible;
  if (row === undefined || !visible.value) {
    return err({ code: "not_found", message: NOT_FOUND });
  }
  const evidence = readProblemSnapshot(snapshot.sql, String(row["snapshot"]));
  if (evidence === undefined) return err({ code: "internal", message: BROKEN });
  let message: OccurrenceRead["message"] = null;
  if (row["message"] !== null) {
    const ref = snapshot.sql.get(
      `select size_bytes from blob_refs
       where owner_kind = 'report' and owner_key = ? and field = 'report_text'`,
      [input.report],
    );
    message = {
      hash: String(row["message"]),
      size_bytes: ref === undefined ? 0 : Number(ref["size_bytes"]),
    };
  }
  return ok({
    view: {
      occurrence: occurrenceOf(row),
      name: String(row["name"]),
      message: message === null
        ? null
        : { hash: message.hash, preview: "", truncated: false },
      details_hash: row["details"] === null ? null : String(row["details"]),
      snapshot: evidence,
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    },
    message,
  });
}

// 글 앞 PROBLEM_MESSAGE_PREVIEW_CHARS자를 미리보기로 채운다. 못 읽었으면(bytes가 null) 비워 두고
// 더 있는 것으로 둔다.
export function withMessagePreview(
  read: OccurrenceRead,
  bytes: Uint8Array | null,
): Output<typeof problemGetOccurrence> {
  if (read.view.message === null || read.message === null) return read.view;
  if (bytes === null) {
    return {
      ...read.view,
      message: { ...read.view.message, preview: "", truncated: true },
    };
  }
  const chars = Array.from(new TextDecoder().decode(bytes));
  const truncated = chars.length > PROBLEM_MESSAGE_PREVIEW_CHARS ||
    bytes.length < read.message.size_bytes;
  return {
    ...read.view,
    message: {
      ...read.view.message,
      preview: chars.slice(0, PROBLEM_MESSAGE_PREVIEW_CHARS).join(""),
      truncated,
    },
  };
}
