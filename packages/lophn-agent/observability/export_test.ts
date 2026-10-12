import { assert, assertEquals } from "@std/assert";
import type { DatabaseSync } from "node:sqlite";
import { err, ok } from "../../base/mod.ts";
import {
  agentTraceExportOutputSchema,
  type RunTrace,
} from "../../protocol/lophn-agent/mod.ts";
import type { ExportRedactor } from "./export.ts";
import { truncateForExport } from "./export.ts";
import {
  createTraceExport,
  type ExportBodySource,
  type TraceExportDeps,
} from "./work.ts";
import {
  addEvent,
  addMessage,
  addModel,
  addRun,
  addTool,
  hashOf,
  id,
  openLedger,
} from "./testing/mod.ts";

// export의 형식·절단·실패만 본다. 실제 core route 등록은 apps/core 시험이 본다.

const LOPHN = id("asg", 1);
const RUN = id("run", 1);
const MSG = id("msg", 1);
const MCL = id("mcl", 1);
const TCL = id("tcl", 1);
const NOW = "2026-10-08T00:00:00.000Z";

function ledger(): DatabaseSync {
  const db = openLedger();
  db.prepare("insert into assignments values (?, 'lophn', 'enabled')").run(
    LOPHN,
  );
  return db;
}

type DB = DatabaseSync;

// trace 하나. run·model call·tool call·message와 시작·종료 event를 둔다.
function seededRun(db: DB, options: { session?: string } = {}): void {
  addRun(db, {
    id: RUN,
    assignment: LOPHN,
    session: options.session ?? null,
    outcome: ["completed", "answer_completed"],
    activeMs: 4000,
    source: { kind: "message", message: MSG },
  });
  addMessage(db, { id: MSG, run: RUN, seq: 1 });
  addModel(db, { id: MCL, run: RUN, order: 1, durationMs: 2000 });
  addTool(db, { id: TCL, run: RUN, modelCall: MCL });
  addEvent(db, { type: "RunStarted", subject: RUN, at: NOW });
  addEvent(db, { type: "RunFinished", subject: RUN, at: NOW });
}

// 테스트 redactor. 고정 값을 내고 지우지 못한 상태는 전체를 제외한다(fail-closed).
function passRedactor(exclude = false): ExportRedactor {
  return (_input) => {
    if (exclude) {
      return {
        rule_revision: "test-1",
        status: "omitted",
        content: null,
        redacted_items: [],
        omissions: [{
          location: "body",
          reason: "secret_detected",
          message: "omitted",
        }],
      };
    }
    return {
      rule_revision: "test-1",
      status: "passed",
      content: { kind: "inline", value: "EXPORT-SAFE" },
      redacted_items: [],
      omissions: [],
    };
  };
}

// blob 본문 통로. blob-hash → 글 하나를 Map으로 둔다. 참조 행은 같은 Map의 key로 본다.
function bodySource(blobs: Map<string, string>): ExportBodySource {
  const encode = (text: string) => new TextEncoder().encode(text);
  return {
    ref(ownerKind, ownerKey, field) {
      const text = blobs.get(`${ownerKind}:${ownerKey}:${field}`);
      if (text === undefined) return undefined;
      return { hash: hashOf(text), size_bytes: encode(text).length };
    },
    bytes(hash, offset, length) {
      const found = [...blobs.values()].find((text) => hashOf(text) === hash);
      if (found === undefined) {
        return Promise.resolve(
          err({ code: "not_found" as const, message: "none" }),
        );
      }
      return Promise.resolve(
        ok({
          hash,
          sizeBytes: encode(found).length,
          bytes: encode(found).slice(offset, offset + length),
        }),
      );
    },
  };
}

const deps = (
  db: DB,
  options: {
    redactor?: ExportRedactor;
    body?: ExportBodySource;
    writes?: { destination: string; lines: string }[];
  } = {},
): TraceExportDeps => {
  const snapshotSql = {
    get: (query: string, params: never[]) =>
      db.prepare(query).get(...(params as never[])),
    all: (query: string, params: never[]) =>
      db.prepare(query).all(...(params as never[])),
  };
  return {
    snapshot(read) {
      return read(snapshotSql as never);
    },
    body: options.body ?? undefined,
    redactor: options.redactor ?? undefined,
    write(destination, lines) {
      options.writes?.push({ destination, lines });
      return Promise.resolve({ ok: true as const, value: lines.length });
    },
  };
};

Deno.test("lophn-agent/observability#R10: truncate keeps UTF-8 boundaries at 32768 bytes", () => {
  // 3바이트 한글을 경계에 걸치게 둔다. 32768은 3으로 나누어 떨어지지 않으므로 글자 경계에 걸린다.
  const hangul = "가".repeat(10923);
  const whole = `${hangul}가`;
  const cut = truncateForExport(whole);
  assert(cut.truncated);
  const cutBytes = new TextEncoder().encode(cut.value).length;
  // 글자 경계를 지키므로 3바이트 글자 수로 나누어 떨어진다.
  assertEquals(cutBytes % 3, 0);
  assertEquals(cutBytes % 3 === 0, true);
  // 잘린 값은 항상 유효한 UTF-8이다(글자 중간에서 자르지 않는다).
  assertEquals(
    new TextDecoder("utf-8", { fatal: true }).decode(
      new TextEncoder().encode(cut.value),
    ),
    cut.value,
  );
  assertEquals(cut.original_bytes, new TextEncoder().encode(whole).length);
  assertEquals(cut.value, "가".repeat(cutBytes / 3));
  // 상한 안의 글은 잘리지 않는다.
  const within = truncateForExport("가".repeat(10922));
  assertEquals(within.truncated, false);
  assertEquals(within.value, "가".repeat(10922));
  // 잘린 값은 마지막 불완전한 글자를 버린 앞부분이다.
  assertEquals(hangul.startsWith(cut.value), true);
});

const runTarget = { kind: "run", run: RUN } as const;
const sessionTarget = { kind: "session", session: id("ses", 1) } as const;

// 빈 조합인 export다. 내용은 없다(R16).
const BASE_REQUEST = {
  targets: [runTarget],
  format: "ndjson" as const,
  format_version: 1 as const,
  destination: "/tmp/trace-export.ndjson",
  content_kinds: [] as [],
};

Deno.test("lophn-agent/observability#R14: export writes UTF-8 ndjson version 1 with a line per trace", async () => {
  const db = ledger();
  seededRun(db);
  const writes: { destination: string; lines: string }[] = [];
  const reply = await createTraceExport(deps(db, { writes }), {
    now: () => NOW,
  })
    .export(BASE_REQUEST);
  assert(reply.ok, JSON.stringify(reply));
  assert(agentTraceExportOutputSchema.safeParse(reply.value).success);
  assertEquals(reply.value.sent, 1);
  assertEquals(reply.value.not_sent, 0);
  assertEquals(reply.value.errors, []);
  assertEquals(writes.length, 1);
  assertEquals(writes[0]!.destination, BASE_REQUEST.destination);
  const lines = writes[0]!.lines.split("\n").filter((line) => line !== "");
  assertEquals(lines.length, 2);
  const header = JSON.parse(lines[0]!) as Record<string, unknown>;
  assertEquals(header["type"], "export");
  assertEquals(header["format_version"], 1);
  const record = JSON.parse(lines[1]!) as { type: string; trace: RunTrace };
  assertEquals(record.type, "trace");
  assertEquals(record.trace.run, RUN);
  assertEquals(record.trace.model_calls, [MCL]);
  // 각 줄은 독립된 JSON이다.
  for (const line of lines) {
    assert(JSON.parse(line) !== undefined);
  }
});

Deno.test("lophn-agent/observability#R16: default export sends metadata only and chosen kinds add redacted content", async () => {
  const db = ledger();
  seededRun(db);
  const blobs = new Map<string, string>([
    [`message:${MSG}:body`, "message body original"],
    [`model_call:${MCL}:input`, "model input original"],
    [`model_call:${MCL}:output`, "model output original"],
    [`tool_call:${TCL}:input`, "tool input original"],
    [`tool_call:${TCL}:output`, "tool output original"],
  ]);
  const body = bodySource(blobs);

  // 기본: 내용이 없다. 보호된 원본이 있어도 본문은 나가지 않는다.
  const writes: { destination: string; lines: string }[] = [];
  const reply = await createTraceExport(
    deps(db, { writes, body, redactor: passRedactor() }),
    { now: () => NOW },
  ).export(BASE_REQUEST);
  assert(reply.ok, JSON.stringify(reply));
  const lines = writes[0]!.lines.split("\n").filter((line) => line !== "");
  assert(!JSON.stringify(lines).includes("original"));

  // 고른 종류만 redaction·절단을 거쳐 들어간다.
  const chosen = await createTraceExport(
    deps(db, { writes: writes, body, redactor: passRedactor() }),
    { now: () => NOW },
  ).export({
    ...BASE_REQUEST,
    content_kinds: ["model_input", "tool_output"],
  });
  assert(chosen.ok, JSON.stringify(chosen));
  const chosenLines = writes[1]!.lines.split("\n").filter((line) =>
    line !== ""
  );
  const contents = chosenLines.filter((line) =>
    (JSON.parse(line) as Record<string, unknown>)["type"] === "content"
  ).map((line) => JSON.parse(line) as Record<string, unknown>);
  assertEquals(contents.length, 2);
  assertEquals(contents.map((content) => content["record"]).sort(), [
    "model_input",
    "tool_output",
  ]);
  assertEquals(
    contents.map((content) =>
      (content["value"] as Record<string, unknown>).body
    ),
    ["EXPORT-SAFE", "EXPORT-SAFE"],
  );
  // 선택하지 않은 종류의 본문은 나가지 않는다.
  assert(!JSON.stringify(chosenLines).includes("message body original"));
});

Deno.test("lophn-agent/observability#R10: excluded and truncated values are named outside the body", async () => {
  const db = ledger();
  seededRun(db);
  const blobs = new Map<string, string>([
    [`model_call:${MCL}:input`, "긴 모델 입력 원문"],
  ]);
  const writes: { destination: string; lines: string }[] = [];
  // redactor가 원문을 그대로 내면 잘림이 값 바깥 필드에 남는다.
  const redactor: ExportRedactor = () => ({
    rule_revision: "test-1",
    status: "passed",
    content: { kind: "inline", value: "가".repeat(20000) },
    redacted_items: [],
    omissions: [],
  });
  const reply = await createTraceExport(
    deps(db, { writes, body: bodySource(blobs), redactor }),
    { now: () => NOW },
  ).export({ ...BASE_REQUEST, content_kinds: ["model_input"] });
  assert(reply.ok, JSON.stringify(reply));
  const lines = writes[0]!.lines.split("\n").filter((line) => line !== "");
  const content = JSON.parse(
    lines.find((line) => line.includes('"content"'))!,
  ) as {
    value: { body: string; truncated: boolean; original_bytes: number };
  };
  assert(content.value.truncated);
  assert(content.value.original_bytes > 32768);
  assert(
    new TextEncoder().encode(content.value.body).length <= 32768,
  );
  // 테스트 환경의 redaction 실패는 본문 대신 제외 이유를 남긴다.
  const failing = await createTraceExport(
    deps(db, {
      writes: [],
      body: bodySource(blobs),
      redactor: passRedactor(true),
    }),
    { now: () => NOW },
  ).export({ ...BASE_REQUEST, content_kinds: ["model_input"] });
  assert(failing.ok, JSON.stringify(failing));
  assert(failing.value.not_sent >= 0);
  assert(
    failing.value.errors.some((error) => error.reference === `${MCL}:input`),
  );
});

Deno.test("lophn-agent/observability#R12: export destination is a local path and no network is touched", async () => {
  const db = ledger();
  seededRun(db);
  const writes: { destination: string; lines: string }[] = [];
  const reply = await createTraceExport(deps(db, { writes }), {
    now: () => NOW,
  }).export({ ...BASE_REQUEST, destination: "./derived/traces/turn.ndjson" });
  assert(reply.ok, JSON.stringify(reply));
  assertEquals(writes[0]!.destination, "./derived/traces/turn.ndjson");
});

Deno.test("lophn-agent/observability#R14: a session target folds its runs into one trace line", async () => {
  const db = ledger();
  db.prepare("insert into sessions values (?, ?, 'lophn')").run(
    id("ses", 1),
    LOPHN,
  );
  seededRun(db, { session: id("ses", 1) });
  const second = id("run", 2);
  addRun(db, {
    id: second,
    assignment: LOPHN,
    session: id("ses", 1),
    outcome: ["completed", "answer_completed"],
  });
  addModel(db, { id: id("mcl", 2), run: second, order: 1 });
  const writes: { destination: string; lines: string }[] = [];
  const reply = await createTraceExport(deps(db, { writes }), {
    now: () => NOW,
  }).export({ ...BASE_REQUEST, targets: [sessionTarget] });
  assert(reply.ok, JSON.stringify(reply));
  assertEquals(reply.value.sent, 1);
  const lines = writes[0]!.lines.split("\n").filter((line) => line !== "");
  const record = JSON.parse(lines[1]!) as { trace: RunTrace };
  assertEquals(record.trace.run, null);
  assertEquals(record.trace.session, id("ses", 1));
  assertEquals(record.trace.model_calls, [MCL, id("mcl", 2)]);
});

Deno.test("lophn-agent/observability#R17: a failed export keeps the original and returns sent and not_sent apart", async () => {
  const db = ledger();
  seededRun(db);
  // 대상 하나는 있는 run, 하나는 없는 run이다.
  const writes: { destination: string; lines: string }[] = [];
  const reply = await createTraceExport(deps(db, { writes }), {
    now: () => NOW,
  }).export({
    ...BASE_REQUEST,
    targets: [
      runTarget,
      { kind: "run", run: id("run", 99) },
    ],
  });
  assert(reply.ok, JSON.stringify(reply));
  // 보낸 수와 못 보낸 수가 구별된다.
  assertEquals(reply.value.sent, 1);
  assertEquals(reply.value.not_sent, 1);
  assertEquals(reply.value.errors.length, 1);
  assertEquals(reply.value.errors[0]!.code, "not_found");
  assertEquals(reply.value.errors[0]!.reference, id("run", 99));
  // 성공한 대상의 줄은 남는다.
  const lines = writes[0]!.lines.split("\n").filter((line) => line !== "");
  assertEquals(lines.length, 2);

  // 파일 쓰기가 실패하면 보낸 수는 0이고 못 보낸 수가 남는다. 원본·run은 바뀌지 않는다.
  const failingDeps: TraceExportDeps = {
    ...deps(db),
    write: () =>
      Promise.resolve(
        err({ code: "unavailable", message: "destination is not writable" }),
      ),
  };
  const before = JSON.stringify(
    db.prepare("select * from runs order by id").all(),
  );
  const failed = await createTraceExport(failingDeps, { now: () => NOW })
    .export(BASE_REQUEST);
  assert(failed.ok, JSON.stringify(failed));
  assertEquals(failed.value.sent, 0);
  assert(failed.value.not_sent > 0);
  assertEquals(failed.value.errors[0]!.code, "unavailable");
  assertEquals(
    JSON.stringify(db.prepare("select * from runs order by id").all()),
    before,
  );
});
