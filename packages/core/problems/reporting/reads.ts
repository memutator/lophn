import { err, ok, type Result } from "../../../base/mod.ts";
import { NOT_FOUND, requireOperation, targetVisible } from "./access.ts";
import type {
  Input,
  Output,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import { getReport } from "../../../protocol/problems/mod.ts";

export function reportFacts(row: Record<string, unknown>) {
  return {
    app: String(row["app"]),
    problem: row["problem"] === null ? null : String(row["problem"]),
    mode: String(row["mode"]),
    diagnostic_scope: row["diagnostic_scope"] === null
      ? null
      : String(row["diagnostic_scope"]),
  };
}

// 옛 GetReport의 code는 이름이 아니라 선언한 code라서, 이름은 옛 모양에 맞는 값으로만 접어 보인다.
function legacyCode(source: string, name: string): string {
  if (source === "exception") return "_exception";
  if (source === "feedback") return "_feedback";
  return /^[a-z][a-z0-9_]{1,47}$/.test(name) ? name : "_invalid_report";
}

const optionalText = (value: unknown) =>
  value === null || value === undefined ? null : String(value);

// `problems.report_body`가 보고를 볼 수 있는지 판정하는 문이다. 새 읽기는 `problem.get_occurrence`이고,
// 이 읽기는 report_body의 판정이 그쪽으로 옮겨 가면 지운다. 근거 snapshot은 싣지 않는다.
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
      `select id, app, problem, source, mode, diagnostic_scope, release, release_missing_reason,
              bundle_hash, name, message, details, snapshot, observed_at, principal, content_hash
       from reports where id = ?`,
      [input.report],
    );
    const visible = row === undefined
      ? ok(false)
      : targetVisible(snapshot, ctx, getReport.name, reportFacts(row));
    if (!visible.ok) return visible;
    if (row === undefined || !visible.value) {
      return err({ code: "not_found", message: NOT_FOUND });
    }
    const source = String(row["source"]) as "app" | "exception" | "feedback";
    return ok({
      report: {
        id: String(row["id"]),
        app: String(row["app"]),
        mode: String(row["mode"]) as "live" | "preview" | "test",
        source,
        diagnostic_scope: optionalText(row["diagnostic_scope"]),
        release: optionalText(row["release"]),
        release_missing_reason: optionalText(row["release_missing_reason"]),
        bundle_hash: optionalText(row["bundle_hash"]),
        code: legacyCode(source, String(row["name"])),
        text: optionalText(row["message"]),
        details: optionalText(row["details"]),
        snapshot: String(row["snapshot"]),
        observed_at: String(row["observed_at"]),
        principal: String(row["principal"]),
        content_hash: String(row["content_hash"]),
        problem: optionalText(row["problem"]),
      },
      attachments: snapshot.sql.all(
        "select field, hash, size_bytes from blob_refs where owner_kind = ? and owner_key = ?",
        ["report", input.report],
      ).map((ref) => ({
        field: String(ref.field),
        hash: String(ref.hash),
        size_bytes: Number(ref.size_bytes),
      })),
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
      snapshot: null,
      missing: { invocation: null, error: null, logs: null, screen: null },
    });
  },
};
