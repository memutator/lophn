import { err, ok, type Result } from "../../../base/mod.ts";
import type { RunTrace } from "../../../protocol/lophn-agent/mod.ts";
import { agentTraceExport } from "../../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  Input,
  Output,
  Sql,
} from "../../../protocol/server/mod.ts";
import { mergeTraces } from "./model.ts";
import { loadRun, type Lookup, traceOfCall, traceOfRun } from "./reads.ts";
import {
  type ExcludedValue,
  type ExportedValue,
  exportHeader,
  exportLine,
  type ExportRedactor,
  exportValue,
} from "./export.ts";
export type { ExportRedactor };

// trace export의 무거운 일. trace 조립은
// reads.ts의 같은 accessor를 쓰고, 본문은 blob 참조에서 읽은 뒤 redaction·절단해
// destination 파일에 쓴다. export는 업무 event가 없는 runtime 접수다: 원본·run을
// 바꾸지 않고 event도 만들지 않는다. network 접근은 없다 — destination은
// 로컬 파일 경로뿐이다.

export type TraceExportRequest = Input<typeof agentTraceExport>;
export type TraceExportReply = Output<typeof agentTraceExport>;
type ExportTarget = TraceExportRequest["targets"][number];
type ContentKind = TraceExportRequest["content_kinds"][number];

// export 본문의 blob 통로다. 소유 원본(blob_refs 행)을 가리키고, 등록된 hash의
// 구간을 읽는다. 행이 없으면 원본이 사라진 것이다.
export type ExportBodySource = {
  ref(
    ownerKind: string,
    ownerKey: string,
    field: string,
  ): { hash: string; size_bytes: number } | undefined;
  bytes(
    hash: string,
    offset: number,
    length: number,
  ): Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;
};

export type TraceExportDeps = {
  // ledger snapshot 하나에서 trace를 조립한다. export는 요청 시각의 snapshot 하나만 본다.
  snapshot<T>(read: (sql: Pick<Sql, "get" | "all">) => Result<T>): Result<T>;
  // 본문 blob을 읽는 통로. 없으면 내용을 고른 export는 unavailable이다.
  body: ExportBodySource | undefined;
  // platform redaction과 같은 모양의 주입 값. 없으면 내보내지 않는다(fail-closed).
  redactor: ExportRedactor | undefined;
  // destination에 NDJSON을 쓴다. 로컬 파일·stream뿐이다. 쓴 바이트 수를 돌려준다.
  write(destination: string, lines: string): Promise<Result<number>>;
};

// session 대상은 한 번에 whole session을 묶는다. read의 한 쪽(50)보다 넓은 상한이다.
const SESSION_EXPORT_LIMIT = 100;

type ContentRecord = {
  // export 줄의 kind다. 대상 원본의 owner 종류와 뜻이 같다.
  kind: ContentKind;
  owner_kind: "message" | "model_call" | "tool_call";
  owner_key: string;
  field: string;
}; // trace가 가리키는 원본 참조 중 고른 종류의 것만 모은다. 참조는 소유 원본의 hash다.
function contentRecordsOf(
  trace: RunTrace,
  kinds: readonly ContentKind[],
): ContentRecord[] {
  const records: ContentRecord[] = [];
  const pick = (
    kind: ContentKind,
    ownerKind: ContentRecord["owner_kind"],
    ownerKey: string,
    fields: readonly string[],
  ) => {
    for (const field of fields) {
      records.push({
        kind,
        owner_kind: ownerKind,
        owner_key: ownerKey,
        field,
      });
    }
  };
  if (kinds.includes("message")) {
    for (const id of trace.messages) pick("message", "message", id, ["body"]);
  }
  for (const id of trace.model_calls) {
    if (kinds.includes("model_input")) {
      pick("model_input", "model_call", id, ["input"]);
    }
    if (kinds.includes("model_output")) {
      pick("model_output", "model_call", id, ["context_basis", "output"]);
    }
  }
  for (const id of trace.tool_calls) {
    if (kinds.includes("tool_input")) {
      pick("tool_input", "tool_call", id, [
        "input",
      ]);
    }
    if (kinds.includes("tool_output")) {
      pick("tool_output", "tool_call", id, [
        "output",
      ]);
    }
  }
  return records;
}

// blob을 64KiB 창으로 이어 읽어 통째로 모은다. 본문 상한(64KiB)이 이 창보다 작다.
async function readBodyBytes(
  body: ExportBodySource,
  reference: { hash: string; size_bytes: number },
): Promise<Result<Uint8Array>> {
  const whole = new Uint8Array(reference.size_bytes);
  let offset = 0;
  while (offset < reference.size_bytes) {
    const length = Math.min(65536, reference.size_bytes - offset);
    const read = await body.bytes(reference.hash, offset, length);
    if (
      !read.ok || read.value.hash !== reference.hash ||
      read.value.sizeBytes !== reference.size_bytes ||
      read.value.bytes.length !== length
    ) {
      return err({ code: "unavailable", message: "blob을 읽지 못했다" });
    }
    whole.set(read.value.bytes, offset);
    offset += length;
  }
  return ok(whole);
}

// blob 하나를 redaction 뒤 잘라 하나의 exported 값으로 만든다. 안전화를 끝내지 못한
// 값과 사라진 원본은 본문 대신 별도 필드의 제외 이유로 남는다.
async function exportBlob(
  deps: TraceExportDeps,
  record: ContentRecord,
): Promise<{ value: ExportedValue } | { excluded: ExcludedValue }> {
  const reference = `${record.owner_key}:${record.field}`;
  if (deps.body === undefined || deps.redactor === undefined) {
    return { excluded: { reference, reason: "redaction_failed" } };
  }
  const stored = deps.body.ref(
    record.owner_kind,
    record.owner_key,
    record.field,
  );
  if (stored === undefined) {
    return { excluded: { reference, reason: "original_missing" } };
  }
  const bytes = await readBodyBytes(deps.body, stored);
  if (!bytes.ok) return { excluded: { reference, reason: "original_missing" } };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.value);
  } catch {
    return { excluded: { reference, reason: "original_missing" } };
  }
  return exportValue(deps.redactor, reference, text);
}

// 대상 하나의 trace를 조립한다. run 대상은 run 하나의 trace, session 대상은 그
// session의 run들을 접수 순서로 묶은 trace, 독립 call 대상은 call 하나의 trace다.
function targetTrace(
  deps: TraceExportDeps,
  target: ExportTarget,
): Result<RunTrace> {
  if (target.kind === "run") return runTraceOf(deps, target.run);
  if (target.kind === "model_call") return callTraceOf(deps, target.model_call);
  return sessionTraceOf(deps, target.session);
}

function runTraceOf(deps: TraceExportDeps, run: string): Result<RunTrace> {
  const found = deps.snapshot((sql) => {
    const lookup: Lookup = { sql };
    const row = loadRun(lookup, run);
    return ok(row === undefined ? null : traceOfRun(lookup, row));
  });
  if (!found.ok) return found;
  return found.value === null
    ? err({ code: "not_found", message: "trace not found" })
    : ok(found.value);
}

function callTraceOf(deps: TraceExportDeps, call: string): Result<RunTrace> {
  const found = deps.snapshot((sql) => ok(traceOfCall({ sql }, call)));
  if (!found.ok) return found;
  return found.value === null
    ? err({ code: "not_found", message: "trace not found" })
    : ok(found.value);
}

function sessionTraceOf(
  deps: TraceExportDeps,
  session: string,
): Result<RunTrace> {
  const found = deps.snapshot((sql) => {
    const lookup: Lookup = { sql };
    const rows = lookup.sql.all(
      `select id from runs where session = ?
       order by accepted_seq limit ?`,
      [session, SESSION_EXPORT_LIMIT],
    );
    const sessionRow = sql.get(
      "select assignment from sessions where id = ?",
      [session],
    );
    if (rows.length === 0) return ok(null);
    const traces = rows.flatMap((row) => {
      const run = loadRun(lookup, String(row["id"]));
      return run === undefined ? [] : [traceOfRun(lookup, run)];
    });
    const assignment = sessionRow === undefined
      ? traces[0]?.assignment ?? null
      : String(sessionRow["assignment"]);
    if (assignment === null) return ok(null);
    return ok({ traces, assignment });
  });
  if (!found.ok) return found;
  if (found.value === null) {
    return err({ code: "not_found", message: "trace not found" });
  }
  return ok(mergeTraces(session, found.value.assignment, found.value.traces));
}

// trace 줄 하나와 고른 본문 줄들을 모은다. not_sent는 내보내지 못한 줄 수다.
async function collectLines(
  deps: TraceExportDeps,
  request: TraceExportRequest,
  now: string,
): Promise<
  Result<{
    lines: string;
    sent: number;
    not_sent: number;
    errors: TraceExportReply["errors"];
  }>
> {
  const lines: string[] = [exportLine(exportHeader(now))];
  const errors: TraceExportReply["errors"] = [];
  let sent = 0;
  let not_sent = 0;
  for (const target of request.targets) {
    const trace = await targetTrace(deps, target);
    if (!trace.ok) {
      not_sent += 1;
      errors.push({
        code: trace.error.code === "not_found" ? "not_found" : "unavailable",
        reference: target.kind === "run"
          ? target.run
          : target.kind === "session"
          ? target.session
          : target.model_call,
      });
      continue;
    }
    lines.push(exportLine({ type: "trace", trace: trace.value }));
    sent += 1;
    if (request.content_kinds.length === 0) continue;
    const records = contentRecordsOf(trace.value, request.content_kinds);
    for (const record of records) {
      const made = await exportBlob(deps, record);
      if ("excluded" in made) {
        errors.push({
          code: made.excluded.reason === "original_missing"
            ? "not_found"
            : "unavailable",
          reference: made.excluded.reference,
        });
        continue;
      }
      lines.push(exportLine({
        type: "content",
        record: record.kind,
        field: record.field,
        value: made.value,
      }));
      sent += 1;
    }
  }
  return ok({ lines: lines.join(""), sent, not_sent, errors });
}

export function createTraceExport(
  deps: TraceExportDeps,
  options: {
    // snapshot 접수 시각이다. export 첫 줄의 generated_at에 남는다.
    now(): string;
  },
) {
  return {
    async export(input: TraceExportRequest): Promise<Result<TraceExportReply>> {
      const collected = await collectLines(deps, input, options.now());
      if (!collected.ok) return collected;
      const written = await deps.write(
        input.destination,
        collected.value.lines,
      );
      if (!written.ok) {
        return ok({
          sent: 0,
          not_sent: collected.value.sent + collected.value.not_sent,
          errors: [{ code: "unavailable", reference: input.destination }],
        });
      }
      return ok({
        sent: collected.value.sent,
        not_sent: collected.value.not_sent,
        errors: collected.value.errors,
      });
    },
  };
}

// export의 route 등록 자리다. 실제 실행은 ledger writer 처리기 밖에서 한다(파일
// 쓰기가 transaction 안에 있을 수 없다). 등록은 writer 앞 처리기가 볼
// 이름과 대상 route를 여는 자리다(connection test와 같은 모양).
export const traceExportCommand: CommandDefinition<typeof agentTraceExport> = {
  route: agentTraceExport,
  handle() {
    return err({
      code: "unavailable",
      message: "trace export runs outside the ledger writer",
    });
  },
};
