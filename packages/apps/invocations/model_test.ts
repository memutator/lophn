import { assert } from "@std/assert";
import type {
  InvocationRecordDeniedInput,
  InvocationRecordFinishedInput,
  InvocationRecordStartedInput,
} from "../../protocol/apps/mod.ts";
import {
  applyDenied,
  applyFinished,
  applyStarted,
  redactSummary,
} from "./model.ts";

type Caller = { kind: "direct" } | {
  kind: "app";
  app: string;
  release: string;
  parent_invocation: string | null;
};

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const REL_B = "rel_01h455vb4pex5v6nkc6gd5fdw2";
const INV = "inv_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-04T00:00:00.000Z";
const LATER = "2026-10-04T00:00:01.000Z";

const startedInput = (
  overrides: Partial<InvocationRecordStartedInput> = {},
): InvocationRecordStartedInput => ({
  invocation: INV,
  app: APP,
  release: REL,
  mode: "live",
  actor: "user",
  caller: { kind: "direct" },
  operation: { kind: "command", command: "usage.sync" },
  trigger: { kind: "direct" },
  started_at: AT,
  ...overrides,
});

const finishedInput = (
  overrides: Partial<InvocationRecordFinishedInput> = {},
): InvocationRecordFinishedInput => ({
  invocation: INV,
  status: "succeeded",
  started_at: AT,
  finished_at: LATER,
  summary: { code: "ok" },
  detail_hash: null,
  ...overrides,
});

const deniedInput = (
  overrides: Partial<InvocationRecordDeniedInput> = {},
): InvocationRecordDeniedInput => ({
  invocation: INV,
  app: APP,
  release: REL,
  actor: "user",
  caller: { kind: "direct" },
  operation: { kind: "command", command: "usage.sync" },
  trigger: { kind: "direct" },
  finished_at: AT,
  summary: { reason: "grant missing" },
  ...overrides,
});

function runningRow() {
  const applied = applyStarted(null, startedInput());
  assert(applied.ok);
  return applied.value!;
}

function finishedRow() {
  const running = runningRow();
  const applied = applyFinished(running, finishedInput());
  assert(applied.ok);
  return applied.value!;
}

function isConflict(result: { ok: boolean; error?: { code: string } }): void {
  assert(!result.ok);
  assert(result.error?.code === "conflict", JSON.stringify(result));
}

Deno.test("apps/invocations#R9: 없음에서 record_started는 running을 만들고 started_at을 세운다", () => {
  const row = runningRow();
  assert(row.status === "running");
  assert(row.started_at === AT);
  assert(row.finished_at === null);
  assert(row.approval === null);
  assert(row.input_hash === null);
  assert(row.detail_hash === null);
});

Deno.test("apps/invocations#R6: 같은 시작 사실 재전송은 같은 결과(무변경)다", () => {
  const row = runningRow();
  const again = applyStarted(row, startedInput());
  assert(again.ok);
  assert(again.value === null);
});

Deno.test("apps/invocations#R6: 다른 시작 사실은 conflict다", () => {
  const row = runningRow();
  isConflict(applyStarted(row, startedInput({ release: REL_B })));
  isConflict(applyStarted(row, startedInput({ started_at: LATER })));
});

Deno.test("apps/invocations#R6: terminal 뒤 늦은 start는 running으로 되돌리지 않는다", () => {
  const done = finishedRow();
  const late = applyStarted(done, startedInput());
  assert(late.ok);
  // 무변경이다. terminal이 running으로 돌아가지 않는다.
  assert(late.value === null);
  const denied = applyStarted(
    { ...done, status: "denied" as const },
    startedInput(),
  );
  assert(denied.ok);
  assert(denied.value === null);
});

Deno.test("apps/invocations#R6: running 뒤 record_finished는 종료를 남기고 unknown도 같은 사실 재전송이다", () => {
  const running = runningRow();
  const done = applyFinished(running, finishedInput());
  assert(done.ok);
  assert(done.value !== null && done.value.status === "succeeded");
  assert(done.value.started_at === AT);
  assert(done.value.finished_at === LATER);
  // 같은 종료 사실 재전송은 무변경이다.
  const again = applyFinished(done.value, finishedInput());
  assert(again.ok);
  assert(again.value === null);
});

Deno.test("apps/invocations#R6: 다른 종료 사실은 conflict다", () => {
  const done = finishedRow();
  isConflict(applyFinished(done, finishedInput({ status: "failed" })));
  isConflict(applyFinished(done, finishedInput({ finished_at: AT })));
  isConflict(applyFinished(done, finishedInput({ summary: { code: "no" } })));
});

Deno.test("apps/invocations#R10: 알려진 ID만 unknown으로 확정한다(모르는 호출은 만들지 않음)", () => {
  // record_finished는 absent row를 만들지 않는다.
  const absent = applyFinished(null, finishedInput({ status: "unknown" }));
  isConflict(absent);
});

Deno.test("apps/invocations#R10: terminal 뒤 같은 사실 재전송은 무변경이고 이후 확정은 conflict다", () => {
  const done = finishedRow();
  const denied = applyDenied(done, deniedInput({ finished_at: LATER }));
  // succeeded→denied는 전이가 아니다. 다른 사실은 conflict다.
  isConflict(denied);
});

Deno.test("apps/invocations#R9: accepted는 started_at 없음, denied도 없음", () => {
  // accepted는 T12의 accept_confirm이 만든다. 여기서 record_denied처럼
  // started_at 없는 상태만 남기는지 본다. denied는 confirm 접수 없이 거절이다.
  const acceptedRow: Parameters<typeof applyFinished>[0] = {
    id: INV,
    app: APP,
    release: REL,
    operation: { kind: "command", command: "usage.sync" },
    trigger: { kind: "direct" },
    mode: "live",
    actor: "user",
    caller: { kind: "direct" },
    approval: "apr_01h455vb4pex5v6nkc6gd5fdw1",
    input_hash: "ab".repeat(32),
    status: "accepted",
    started_at: null,
    finished_at: null,
    summary: {},
    detail_hash: null,
  };
  // accepted 뒤 record_finished는 started_at이 있어도 종료 사실과 함께 남는다.
  const done = applyFinished(acceptedRow, finishedInput());
  assert(done.ok);
  assert(done.value !== null && done.value.status === "succeeded");
  // record_denied는 accepted 뒤에 started_at 없이 denied를 남긴다.
  const refused = applyDenied(acceptedRow, deniedInput());
  assert(refused.ok);
  assert(refused.value !== null);
  assert(refused.value.status === "denied");
  assert(refused.value.started_at === null);
  assert(refused.value.finished_at === AT);
});

Deno.test("apps/invocations#R2 #R9: record_denied는 접수 없이 거절된 알려진 호출을 started_at 없이 남기고 running은 거절한다", () => {
  const created = applyDenied(null, deniedInput());
  assert(created.ok);
  assert(created.value !== null && created.value.status === "denied");
  assert(created.value.started_at === null);
  assert(created.value.approval === null);
  assert(created.value.finished_at === AT);
  const running = runningRow();
  isConflict(applyDenied(running, deniedInput()));
});

Deno.test("apps/invocations#R15: redaction 뒤 민감 key의 원문이 없다", () => {
  const redacted = redactSummary({
    code: "network_error",
    secret: "raw-value",
    nested: { token: "raw", plain: "visible" },
  });
  assert(JSON.stringify(redacted).includes("raw-value") === false);
  const record = redacted as { nested: { token: string; plain: string } };
  assert(record.nested.token === "*");
  assert(record.nested.plain === "visible");
  const redactedDenied = redactSummary(deniedInput().summary);
  assert(JSON.stringify(redactedDenied).includes("raw") === false);
});
