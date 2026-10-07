import { err, ok, type Result } from "../../base/mod.ts";
import { RepairContextMoreInputSchema } from "../../contracts/coding-agent/mod.ts";
import type { RepairReadPort, ReportSummary } from "./model.ts";
import { UNREADABLE_MESSAGE } from "./model.ts";
import type { CursorState, RepairCursor } from "./cursor.ts";
import { inlineFence, utf8Bytes } from "./text.ts";

type Page = { problem: string; kind: string; source: string; item: unknown; blobs: { purpose: string; hash: string }[]; missing: { reason: string } | null; next_cursor: string | null; as_of_seq: string };

// offset는 원문 code point 위치다. 큰 한 줄도 다음 페이지에서 정확히 이어진다.
export function textPage(text: string, offset: number, lineLimit: number): { text: string; next: number | null } {
  const points = Array.from(text);
  let end = offset;
  let lines = 1;
  let bytes = utf8Bytes(inlineFence("evidence", ""));
  while (end < points.length) {
    const point = points[end];
    const cost = utf8Bytes(point === "\n" ? " ⏎ " : point === "<" ? "\\<" : point);
    if (bytes + cost > 24_000 || (point === "\n" && lines >= lineLimit)) break;
    bytes += cost;
    if (point === "\n") lines += 1;
    end += 1;
  }
  return { text: inlineFence("evidence", points.slice(offset, end).join("")), next: end < points.length ? end : null };
}

export async function repairMore(port: RepairReadPort, input: unknown, principal: string, cursor: RepairCursor): Promise<Result<Page>> {
  const parsed = RepairContextMoreInputSchema.safeParse(input);
  if (!parsed.success) return err({ code: "invalid_input", message: "invalid input" });
  const request = parsed.data;
  const problem = await port.problem(request.problem);
  if (!problem.ok) return err({ code: problem.error.code === "forbidden" ? "not_found" : problem.error.code, message: UNREADABLE_MESSAGE });
  const base: Page = { problem: request.problem, kind: request.kind, source: request.source, item: null, blobs: [], missing: null, next_cursor: null, as_of_seq: problem.value.as_of_seq };
  let state: CursorState = { principal, app: problem.value.problem.app, problem: request.problem, kind: request.kind, source: request.source, fixed: "", offset: 0, high_water: problem.value.as_of_seq };
  if (request.cursor) {
    const decoded = await cursor.decode(request.cursor);
    if (!decoded.ok) return decoded;
    if (["principal", "app", "problem", "kind", "source"].some((key) => decoded.value[key as keyof CursorState] !== state[key as keyof CursorState])) return err({ code: "invalid_input", message: "cursor 조건이 다르다" });
    state = decoded.value;
  }
  const missing = (reason: string) => ok({ ...base, missing: { reason } });
  if (request.kind === "source_diff") {
    // release read 계약에는 보존 source 파일·diff 참조가 없다. 현재 작업 파일로 보충하지 않는다.
    return missing("첫 발생 전 고정 release와 현재 고정 release의 보존 source diff 읽기 근거가 없다");
  }
  if (request.kind === "occurrences") {
    const rows: ReportSummary[] = [];
    let before: string | undefined = (BigInt(state.high_water) + 1n).toString();
    while (rows.length <= state.offset + 20) {
      const read = await port.reports(request.problem, before);
      if (!read.ok) return missing("발생 목록을 읽지 못했다");
      rows.push(...read.value.reports);
      if (read.value.next_cursor === null) break;
      before = read.value.next_cursor;
    }
    const selected = rows.slice(state.offset, state.offset + 20);
    const safe = await port.redact(JSON.stringify(selected));
    if (safe === null) return missing("redaction을 완료하지 못했다");
    base.item = JSON.parse(safe);
    if (rows.length > state.offset + 20) base.next_cursor = await cursor.encode({ ...state, offset: state.offset + 20 });
    return ok(base);
  }
  if (request.kind === "fix_records" || request.kind === "verifications") {
    const read = request.kind === "fix_records" ? await port.fixes(request.problem) : await port.verifications(state.app, request.problem);
    if (!read.ok) return missing("보존 기록을 읽지 못했다");
    const safe = await port.redact(JSON.stringify(read.value));
    if (safe === null) return missing("redaction을 완료하지 못했다");
    const page = textPage(safe, state.offset, 300);
    base.item = page.text;
    if (page.next !== null) base.next_cursor = await cursor.encode({ ...state, offset: page.next });
    return ok(base);
  }
  const reports: ReportSummary[] = [];
  let before: string | undefined = (BigInt(state.high_water) + 1n).toString();
  for (;;) {
    const list = await port.reports(request.problem, before);
    if (!list.ok) return missing("보고 근거를 읽지 못했다");
    reports.push(...list.value.reports);
    if (list.value.next_cursor === null) break;
    before = list.value.next_cursor;
  }
  const report = reports.find((row) => request.source === `report:${row.id}` || request.source === `snapshot:${row.snapshot}` || (request.source === `problem:${request.problem}` && row.id === (state.fixed || reports[0]?.id)));
  if (!report) return err({ code: "not_found", message: UNREADABLE_MESSAGE });
  if (state.fixed && state.fixed !== report.id) return err({ code: "invalid_input", message: "고정 근거가 다르다" });
  state.fixed = report.id;
  const detail = await port.report(report.id);
  if (!detail.ok || detail.value.report.problem !== request.problem) return err({ code: "not_found", message: UNREADABLE_MESSAGE });
  if (request.kind === "image") {
    const screen = detail.value.snapshot?.screen;
    return missing(screen?.screenshot ? "이미지 redaction·허용 첨부 열기 통로가 없어 제공하지 않는다 (상한 2097152 bytes)" : "보존 이미지가 없다");
  }
  const field = request.kind === "log" ? "snapshot_logs" : "report_text";
  const blob = await port.blob({ owner_kind: "report", owner_key: report.id, field }, 262_144);
  if (blob.kind !== "text") return missing(blob.reason);
  const safe = await port.redact(blob.text);
  if (safe === null) return missing("redaction을 완료하지 못했다");
  const page = textPage(safe, state.offset, request.kind === "log" ? 200 : 300);
  base.item = page.text;
  if (page.next !== null) base.next_cursor = await cursor.encode({ ...state, offset: page.next });
  return ok(base);
}
