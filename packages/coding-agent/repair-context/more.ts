import { err, ok, type Result } from "../../base/mod.ts";
import { RepairContextMoreInputSchema } from "../../contracts/coding-agent/mod.ts";
import type { RepairReadPort, ReportSummary } from "./model.ts";
import { UNREADABLE_MESSAGE } from "./model.ts";
import type { CursorState, RepairCursor } from "./cursor.ts";
import { FENCE_CLOSE, fenceOpen, normalizeNewlines, utf8Bytes } from "./text.ts";

function dataFence(text: string): string {
  return `${fenceOpen("evidence")}\n${text.split("<<<").join("<<\\<").split("\n").map((line) => `| ${line}`).join("\n")}\n${FENCE_CLOSE}`;
}
async function fingerprint(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Page = { problem: string; kind: string; source: string; item: unknown; blobs: { purpose: string; hash: string }[]; missing: { reason: string } | null; next_cursor: string | null; as_of_seq: string };

// offset는 원문 code point 위치다. 큰 한 줄도 다음 페이지에서 정확히 이어진다.
export function textPage(text: string, offset: number, lineLimit: number): { text: string; next: number | null } {
  const points = Array.from(normalizeNewlines(text));
  let end = offset;
  let lines = 1;
  let bytes = utf8Bytes(dataFence(""));
  while (end < points.length) {
    const point = points[end];
    const cost = utf8Bytes(point === "\n" ? "\n| " : point === "<" ? "\\<" : point);
    if (bytes + cost > 18_000 || (point === "\n" && lines >= lineLimit)) break;
    bytes += cost;
    if (point === "\n") lines += 1;
    end += 1;
  }
  return { text: dataFence(points.slice(offset, end).join("")), next: end < points.length ? end : null };
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
    base.item = dataFence(JSON.stringify(JSON.parse(safe)));
    if (rows.length > state.offset + 20) base.next_cursor = await cursor.encode({ ...state, offset: state.offset + 20 });
    return ok(base);
  }
  if (request.kind === "fix_records" || request.kind === "verifications") {
    const read = request.kind === "fix_records" ? await port.fixes(request.problem) : await port.verifications(state.app, request.problem);
    if (!read.ok) return missing("보존 기록을 읽지 못했다");
    const records = read.value;
    const serialized = JSON.stringify(records);
    const fixed = await fingerprint(serialized);
    if (state.fixed && state.fixed !== fixed) return missing("기록이 바뀌었다. 첫 페이지부터 다시 읽는다");
    state.fixed = fixed;
    const rows: unknown[] = "fixes" in records ? records.fixes : records.verifications;
    let end = state.offset;
    let safe = "[]";
    while (end < rows.length) {
      const next = await port.redact(JSON.stringify(rows.slice(state.offset, end + 1)));
      if (next === null) return missing("redaction을 완료하지 못했다");
      if (utf8Bytes(dataFence(next)) > 18_000) break;
      safe = JSON.stringify(JSON.parse(next));
      end += 1;
    }
    if (end === state.offset && end < rows.length) return missing("기록 한 항목이 페이지 예산을 넘는다");
    base.item = dataFence(safe);
    if (end < rows.length) base.next_cursor = await cursor.encode({ ...state, offset: end });
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
    const attachment = detail.value.attachments?.find((item) => item.field === "feedback_screenshot" && item.hash === screen?.screenshot);
    if (!attachment) return missing("보존 이미지 또는 첨부 크기 근거가 없다");
    if (attachment.size_bytes > 2_097_152) return missing("이미지 크기가 2097152 bytes를 넘는다");
    base.item = { open: { kind: "report_attachment", problem: request.problem, report: report.id, field: "feedback_screenshot" }, media_type: "image/png", size_bytes: attachment.size_bytes };
    base.missing = { reason: "이 채널은 image/png redaction을 지원하지 않아 이미지 내용 대신 현재 연결로 허용된 첨부 참조만 제공한다" };
    return ok(base);
  }
  const field = request.kind === "log" ? "snapshot_logs" : request.kind === "screen" ? "feedback_state" : "report_text";
  const blob = await port.blob({ owner_kind: "report", owner_key: report.id, field }, 262_144);
  if (blob.kind !== "text") return missing(blob.reason);
  const safe = await port.redact(blob.text);
  if (safe === null) return missing("redaction을 완료하지 못했다");
  const page = textPage(safe, state.offset, request.kind === "log" ? 200 : 300);
  base.item = page.text;
  if (page.next !== null) base.next_cursor = await cursor.encode({ ...state, offset: page.next });
  return ok(base);
}
