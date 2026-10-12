// snapshot 로그 증거의 테스트. 이름은 요구 번호로 시작한다(dev/tasks.md). 앱 buffer는
// apps.logs contract 모양의 memory source로 바꿔 끼우고(testing/mod.ts), blob 준비는
// 실제 SHA-256 경계를 쓴다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import {
  exceptionObservationInputSchema,
  logEvidenceInputSchema,
  type ObservedExceptionInput,
  snapshotInputSchema,
} from "../../../protocol/problems/mod.ts";
import { TEST_BLOB_FIELDS } from "../tests/mod.ts";
import { reportBlobField } from "./blobs.ts";
import { collectLogEvidence, type LogCollectionDeps } from "./logs.ts";
import { readLogFragment } from "./reads.ts";
import { memoryLogSource, preparedFolder, realPrepare } from "./testing/mod.ts";
import { assembleException } from "./work.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const OTHER_APP = "app_01arz3ndektsv4rrffq69g5faw";
const INV = "inv_01arz3ndektsv4rrffq69g5fav";
const AT = "2026-10-04T12:00:01.000Z";

type Setup = ReturnType<typeof setup>;

function setup(overrides: Partial<LogCollectionDeps> = {}) {
  const prepare = realPrepare();
  const logs = memoryLogSource();
  const deps: LogCollectionDeps = {
    detailCollection: true,
    source: logs.source,
    blobPrepare: { prepare: prepare.prepare },
    principal: "collector",
    redact: (text) => Promise.resolve(text),
    nowAt: AT,
    remainingMs: 2_000,
    remainingLargeBytes: 2_359_296,
    ...overrides,
  };
  return { prepare, logs, deps };
}

function fill(logs: Setup["logs"], count: number, invocation?: string) {
  for (let index = 1; index <= count; index++) {
    logs.add(`line ${index}`, invocation);
  }
}

Deno.test("problems/snapshots#R12: 알려진 invocation으로 좁힌 최근 30줄과 실제 범위·수집 시각·잘림을 남긴다", async () => {
  const { prepare, logs, deps } = setup();
  fill(logs, 45, INV);
  fill(logs, 3);
  const result = await collectLogEvidence({ app: APP, invocation: INV }, deps);
  assertEquals(logs.queries, [{
    app: APP,
    invocation: INV,
    limit: 30,
    max_bytes: 65_536,
  }]);
  assert(result.logs !== null && result.prepared !== null);
  assertEquals(result.logs_missing_reason, null);
  assertEquals(result.logs.line_count, 30);
  assertEquals(result.logs.truncated, true);
  assertEquals(result.logs.collected_at, "2026-10-04T12:00:00.500Z");
  assert(result.logs.scope.includes(INV));
  // 줄 시각을 source가 주지 않으면 범위를 추정하지 않는다.
  assertEquals(result.logs.from_at, null);
  assertEquals(result.logs.to_at, null);
  assertEquals(result.prepared.purpose, "snapshot_logs");
  assertEquals(result.prepared.hash, result.logs.blob);
  const text = new TextDecoder().decode(prepare.stored.get(result.logs.blob));
  assertEquals(text.split("\n")[0], "line 16");
  assertEquals(text.split("\n").at(-1), "line 45");
  assert(!text.includes("line 1\n"));
  assert(logEvidenceInputSchema.safeParse(result.logs).success);
});

Deno.test("problems/snapshots#R12: 연결 없는 로그는 앱 로그 조각이라고 표시하고 invocation 줄을 섞지 않는다", async () => {
  const { logs, deps } = setup();
  fill(logs, 4, INV);
  logs.add("unattached one");
  logs.add("unattached two");
  const result = await collectLogEvidence({ app: APP, invocation: null }, deps);
  assertEquals("invocation" in logs.queries[0]!, false);
  assert(result.logs !== null);
  assert(result.logs.scope.startsWith("앱 로그 조각"));
  assertEquals(result.logs.line_count, 2);
  assertEquals(result.logs.truncated, false);
});

Deno.test("problems/snapshots#R12 R20: 한 줄 길이를 자르지 않고 총 65,536 bytes만 지킨다", async () => {
  const { prepare, logs, deps } = setup();
  const long = "x".repeat(3_000);
  for (let index = 0; index < 30; index++) logs.add(`${index} ${long}`);
  const result = await collectLogEvidence({ app: APP, invocation: null }, deps);
  assert(result.logs !== null && result.prepared !== null);
  assert(result.prepared.size_bytes <= 65_536);
  assertEquals(result.logs.truncated, true);
  assert(result.logs.line_count < 30);
  const lines = new TextDecoder().decode(prepare.stored.get(result.logs.blob))
    .split("\n");
  assertEquals(lines.length, result.logs.line_count);
  // 남긴 줄은 통째로이고 가장 최근 줄이 남는다.
  for (const line of lines) assertEquals(line.length >= 3_000, true);
  assert(lines.at(-1)!.startsWith("29 "));
});

Deno.test("problems/snapshots#R4: 로그 0줄·source 없음·수집 꺼짐·기한 내 미수신·읽기 실패는 서로 다른 이유다", async () => {
  const reasons = new Map<string, string>();
  const record = async (name: string, run: Setup, deps?: Setup["deps"]) => {
    const result = await collectLogEvidence(
      { app: APP, invocation: null },
      deps ?? run.deps,
    );
    assertEquals(result.logs, null);
    assertEquals(result.prepared, null);
    const reason = result.logs_missing_reason?.reason ?? "";
    assert(/\S/.test(reason));
    reasons.set(name, reason);
  };
  await record("empty", setup());
  const none = setup();
  none.logs.respond(() =>
    Promise.resolve(
      ok({ state: "none", lines: [], collected_at: null, truncated: false }),
    )
  );
  await record("none", none);
  const off = setup();
  off.logs.respond(() =>
    Promise.resolve(
      ok({ state: "off", lines: [], collected_at: null, truncated: false }),
    )
  );
  await record("off", off);
  const timeout = setup();
  timeout.logs.respond(() =>
    Promise.resolve(
      ok({ state: "timeout", lines: [], collected_at: null, truncated: true }),
    )
  );
  await record("timeout", timeout);
  const failing = setup();
  failing.logs.respond(() =>
    Promise.resolve({
      ok: false as const,
      error: { code: "unavailable" as const, message: "boom" },
    })
  );
  await record("failing", failing);
  const evicted = setup();
  evicted.logs.respond(() =>
    Promise.resolve(
      ok({ state: "ok", lines: [], collected_at: null, truncated: true }),
    )
  );
  await record("evicted", evicted);
  assert(reasons.get("empty")!.includes("0줄"));
  // 수집 꺼짐(설정)과 source가 끈 것은 같은 사람 말이고, 나머지는 서로 다르다.
  assertEquals(reasons.get("off")!.includes("꺼져"), true);
  const distinct = new Set([
    reasons.get("empty"),
    reasons.get("none"),
    reasons.get("off"),
    reasons.get("timeout"),
    reasons.get("failing"),
    reasons.get("evicted"),
  ]);
  assertEquals(distinct.size, 6);
});

Deno.test("problems/snapshots#R4 R12: timeout이어도 받은 줄은 잘림으로 표시해 남긴다", async () => {
  const { logs, deps } = setup();
  logs.respond(() =>
    Promise.resolve(
      ok({
        state: "timeout",
        lines: ["only partial"],
        collected_at: "2026-10-04T12:00:00.100Z",
        truncated: false,
      }),
    )
  );
  const result = await collectLogEvidence({ app: APP, invocation: INV }, deps);
  assert(result.logs !== null);
  assertEquals(result.logs.truncated, true);
  assert(result.logs.scope.includes("일부만"));
});

Deno.test("problems/snapshots#R7: 수집 꺼짐은 source를 부르지 않고 이유를 남기며 invocation 연결은 그대로다", async () => {
  const folder = preparedFolder();
  const { prepare, logs, deps } = setup({ detailCollection: false });
  try {
    fill(logs, 5, INV);
    // 꺼지기 전에 고정한 snapshot은 꺼진 뒤에도 정책대로 읽힌다.
    const existing = await collectLogEvidence(
      { app: APP, invocation: INV },
      { ...deps, detailCollection: true },
    );
    assert(existing.logs !== null);
    logs.queries.length = 0;
    const stillReadable = await readLogFragment({
      actor: "user",
      snapshot: { logs: existing.logs, logs_missing_reason: null },
      read: prepare.read,
    });
    assert(stillReadable.ok && stillReadable.value.kind === "fragment");
    const direct = await collectLogEvidence(
      { app: APP, invocation: INV },
      deps,
    );
    assertEquals(direct.logs, null);
    assert(direct.logs_missing_reason!.reason.includes("꺼져"));
    assertEquals(logs.queries.length, 0);
    const observation = exceptionObservationInputSchema.parse({
      report_id: "rpt_01arz3ndektsv4rrffq69g5fav",
      observed_at: "2026-10-04T12:00:00.000Z",
      observation: "error",
      error: {
        name: "TypeError",
        message: "x",
        message_missing_reason: null,
        stack: null,
        stack_missing_reason: { reason: "none" },
      },
      error_missing_reason: null,
      invocation: {
        id: INV,
        binding: "sdk_context",
        record_missing_reason: null,
      },
    }) as ObservedExceptionInput;
    const assembled = await assembleException(
      observation,
      { app: APP, bundle_hash: null },
      {
        blobPrepare: { prepare: prepare.prepare },
        folder: { appsRoot: folder.root },
        nowAt: AT,
        principal: "collector",
        logs: {
          detailCollection: false,
          source: logs.source,
          redact: deps.redact,
        },
      },
    );
    assert(assembled.ok);
    // 새 로그는 없고 invocation 연결은 그대로 남는다.
    assertEquals(assembled.value.snapshot.logs, null);
    assert(
      assembled.value.snapshot.logs_missing_reason!.reason.includes("꺼져"),
    );
    assertEquals(assembled.value.snapshot.invocation?.id, INV);
    assertEquals(logs.queries.length, 0);
    assert(snapshotInputSchema.safeParse(assembled.value.snapshot).success);
  } finally {
    folder.close();
  }
});

Deno.test("problems/snapshots#R6: 로그는 credential의 앱만 묻고 redaction을 못 지나면 제외하며 저장 내용은 redaction 결과다", async () => {
  const { prepare, logs, deps } = setup({
    redact: (text) =>
      Promise.resolve(text.replaceAll("secret-42", "[redacted]")),
  });
  logs.add("password=secret-42 ok");
  const redacted = await collectLogEvidence(
    { app: APP, invocation: null },
    deps,
  );
  assertEquals(logs.queries.map((query) => query.app), [APP]);
  assert(redacted.logs !== null);
  const text = new TextDecoder().decode(prepare.stored.get(redacted.logs.blob));
  assertEquals(text, "password=[redacted] ok");

  for (
    const failing of [() => Promise.resolve(null), () => {
      throw new Error("engine down");
    }]
  ) {
    const closed = setup({ redact: failing });
    closed.logs.add("password=secret-42 ok");
    const result = await collectLogEvidence(
      { app: APP, invocation: null },
      closed.deps,
    );
    assertEquals(result.logs, null);
    assert(result.logs_missing_reason!.reason.includes("redaction"));
    // 원문은 blob으로도 준비되지 않는다.
    assertEquals(closed.prepare.calls.length, 0);
  }
  assertNotEquals(OTHER_APP, APP);
});

Deno.test("problems/snapshots#R5 R19: 저장 공간이 부족하면 새 로그만 제외하고 기존 자료는 그대로이며 내보내기·한도 조정을 안내한다", async () => {
  const { prepare, logs, deps } = setup();
  logs.add("first fixed");
  const first = await collectLogEvidence({ app: APP, invocation: null }, deps);
  assert(first.logs !== null);
  const hash = first.logs.blob;
  prepare.fail("디스크 여유가 부족하다");
  logs.add("second");
  const second = await collectLogEvidence(
    { app: APP, invocation: null },
    deps,
  );
  assertEquals(second.logs, null);
  const reason = second.logs_missing_reason!.reason;
  assert(reason.includes("내보내기"));
  assert(reason.includes("한도 조정"));
  assert(reason.includes("지우지 않았다"));
  // 기존 snapshot의 고정 blob은 그대로 읽힌다.
  assert(prepare.stored.has(hash));
  // 저장 공간 문제가 아닌 실패는 다른 이유다.
  prepare.fail("bad", "invalid_input");
  const third = await collectLogEvidence({ app: APP, invocation: null }, deps);
  assertNotEquals(third.logs_missing_reason!.reason, reason);
});

Deno.test("problems/snapshots#R18 R20: 남은 기한·큰 자료 예산이 없으면 source를 부르지 않고, 응답이 없으면 기한에 끝난다", async () => {
  const noTime = setup({ remainingMs: 0 });
  noTime.logs.add("x");
  const late = await collectLogEvidence(
    { app: APP, invocation: null },
    noTime.deps,
  );
  assertEquals(late.logs, null);
  assertEquals(noTime.logs.queries.length, 0);

  const noBytes = setup({ remainingLargeBytes: 0 });
  noBytes.logs.add("x");
  const over = await collectLogEvidence(
    { app: APP, invocation: null },
    noBytes.deps,
  );
  assertEquals(over.logs, null);
  assertEquals(noBytes.logs.queries.length, 0);
  assertNotEquals(
    over.logs_missing_reason!.reason,
    late.logs_missing_reason!.reason,
  );

  const small = setup({ remainingLargeBytes: 12 });
  small.logs.add("0123456789");
  small.logs.add("abcdefghij");
  const fit = await collectLogEvidence(
    { app: APP, invocation: null },
    small.deps,
  );
  assertEquals(small.logs.queries[0]!.max_bytes, 12);
  assert(fit.logs !== null && fit.prepared!.size_bytes <= 12);
  assertEquals(fit.logs.line_count, 1);
  assertEquals(fit.logs.truncated, true);

  const hanging = setup({ remainingMs: 20 });
  hanging.logs.respond(() => new Promise(() => {}));
  const started = Date.now();
  const missed = await collectLogEvidence(
    { app: APP, invocation: null },
    hanging.deps,
  );
  assert(Date.now() - started < 1_000);
  assertEquals(missed.logs, null);
  assert(missed.logs_missing_reason!.reason.includes("기한"));
});

Deno.test("problems/snapshots#R13: 앱 buffer를 비워도 고정한 로그 조각이 읽히고 app actor는 읽지 못한다", async () => {
  const { prepare, logs, deps } = setup();
  logs.add("kept one", INV);
  logs.add("kept two", INV);
  const collected = await collectLogEvidence(
    { app: APP, invocation: INV },
    deps,
  );
  assert(collected.logs !== null);
  logs.clear();
  const after = await collectLogEvidence({ app: APP, invocation: INV }, deps);
  assertEquals(after.logs, null);
  const user = await readLogFragment({
    actor: "user",
    snapshot: { logs: collected.logs, logs_missing_reason: null },
    read: prepare.read,
  });
  assert(user.ok && user.value.kind === "fragment");
  assertEquals(user.value.lines, ["kept one", "kept two"]);
  assertEquals(user.value.scope, collected.logs.scope);
  assertEquals(user.value.collected_at, collected.logs.collected_at);
  // 공백 이유도 그대로 읽힌다.
  const absent = await readLogFragment({
    actor: "user",
    snapshot: { logs: null, logs_missing_reason: after.logs_missing_reason },
    read: prepare.read,
  });
  assert(absent.ok && absent.value.kind === "absent");
  assertEquals(absent.value.reason, after.logs_missing_reason!.reason);
});

Deno.test("problems/snapshots#R16: 앱 프로세스·잘못된 actor는 snapshot 첨부를 읽지 못하고 없는 것과 같은 답을 받는다", async () => {
  const { prepare, logs, deps } = setup();
  logs.add("one");
  const collected = await collectLogEvidence(
    { app: APP, invocation: null },
    deps,
  );
  const snapshot = { logs: collected.logs, logs_missing_reason: null };
  const denied = [];
  for (const actor of [`app:${APP}`, "app:nope", "", "stranger"]) {
    const result = await readLogFragment({
      actor,
      snapshot,
      read: prepare.read,
    });
    assert(!result.ok);
    denied.push(result.error);
  }
  for (const error of denied) {
    assertEquals(error.code, "not_found");
    assertEquals(error.message, denied[0]!.message);
  }
  for (
    const actor of [
      "user",
      "machine",
      "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
      "agent:asg_01arz3ndektsv4rrffq69g5fav",
    ]
  ) {
    const result = await readLogFragment({
      actor,
      snapshot,
      read: prepare.read,
    });
    assert(result.ok && result.value.kind === "fragment");
  }
});

Deno.test("problems/snapshots#R14: 잘린 로그 조각에서 전체 실패율 같은 값을 만들지 않는다", async () => {
  const { prepare, logs, deps } = setup();
  for (let index = 0; index < 40; index++) logs.add(`error ${index}`);
  const collected = await collectLogEvidence(
    { app: APP, invocation: null },
    deps,
  );
  assert(collected.logs !== null && collected.logs.truncated);
  const read = await readLogFragment({
    actor: "user",
    snapshot: { logs: collected.logs, logs_missing_reason: null },
    read: prepare.read,
  });
  assert(read.ok && read.value.kind === "fragment");
  const keys = Object.keys(read.value).join(",");
  assert(!/rate|ratio|percent|total|fail/i.test(keys));
  assert(read.value.observation.includes("전체 비율을 계산하지 않는다"));
});

Deno.test("problems/snapshots#R17: 정리된 로그 조각은 부재 이유와 고정 범위를 보이고 큰 자료만 용량 상한 등급이다", async () => {
  const { logs, deps } = setup();
  logs.add("one");
  const collected = await collectLogEvidence(
    { app: APP, invocation: null },
    deps,
  );
  assert(collected.logs !== null);
  const pruned = await readLogFragment({
    actor: "user",
    snapshot: { logs: collected.logs, logs_missing_reason: null },
    read: () => Promise.resolve({ status: "unavailable", reason: "pruned" }),
  });
  assert(pruned.ok && pruned.value.kind === "unavailable");
  assert(pruned.value.reason.includes("정리"));
  assertEquals(pruned.value.scope, collected.logs.scope);

  const capacity = {
    kind: "capacity",
    category: "snapshot_attachment",
  } as const;
  for (
    const field of ["snapshot_stack", "snapshot_logs", "feedback_screenshot"]
  ) {
    assertEquals(reportBlobField(field).retention, capacity);
    assertEquals(reportBlobField(field).owner_kind, "report");
  }
  for (const field of ["report_text", "report_details", "feedback_state"]) {
    assertEquals(reportBlobField(field).retention, { kind: "permanent" });
  }
  // Verification 결과 blob은 영구 등급이고 닫힘이 정리 계기가 아니다.
  assert(TEST_BLOB_FIELDS.length > 0);
  for (const field of TEST_BLOB_FIELDS) {
    assertEquals(field.retention, { kind: "permanent" });
  }
  // 원문 stack은 일반 읽기가 없고 로그 조각만 허용된 조회로 읽는다.
  assertEquals(reportBlobField("snapshot_stack").general_read, false);
  assertEquals(reportBlobField("snapshot_logs").general_read, true);
});

Deno.test("problems/snapshots#R5 R20: 조립은 stack과 로그 blob을 따로 준비하고 snapshot schema를 통과한다", async () => {
  const folder = preparedFolder();
  const { prepare, logs, deps } = setup();
  try {
    logs.add("before crash", INV);
    const observation = exceptionObservationInputSchema.parse({
      report_id: "rpt_01arz3ndektsv4rrffq69g5fav",
      observed_at: "2026-10-04T12:00:00.000Z",
      observation: "error",
      error: {
        name: "TypeError",
        message: "boom",
        message_missing_reason: null,
        stack: "TypeError: boom\n    at run (app.js:1:1)",
        stack_missing_reason: null,
      },
      error_missing_reason: null,
      invocation: {
        id: INV,
        binding: "sdk_context",
        record_missing_reason: null,
      },
    }) as ObservedExceptionInput;
    const assembled = await assembleException(
      observation,
      { app: APP, bundle_hash: null },
      {
        blobPrepare: { prepare: prepare.prepare },
        folder: { appsRoot: folder.root },
        nowAt: AT,
        principal: "collector",
        logs: {
          detailCollection: true,
          source: logs.source,
          redact: deps.redact,
        },
      },
    );
    assert(assembled.ok);
    const value = assembled.value;
    assertEquals(value.stack_prepared?.purpose, "snapshot_stack");
    assertEquals(value.logs_prepared?.purpose, "snapshot_logs");
    assertEquals(value.snapshot.logs?.blob, value.logs_prepared?.hash);
    assertEquals(logs.queries[0]!.app, APP);
    assertEquals(logs.queries[0]!.invocation, INV);
    assert(snapshotInputSchema.safeParse(value.snapshot).success);
    // 로그 blob 준비가 실패해도 오류 증거와 stack은 접수된다.
    prepare.calls.length = 0;
    prepare.fail("디스크 여유가 부족하다");
    const degraded = await assembleException(
      observation,
      { app: APP, bundle_hash: null },
      {
        blobPrepare: { prepare: prepare.prepare },
        folder: { appsRoot: folder.root },
        nowAt: AT,
        principal: "collector",
        logs: {
          detailCollection: true,
          source: logs.source,
          redact: deps.redact,
        },
      },
    );
    assert(degraded.ok);
    assertEquals(degraded.value.snapshot.logs, null);
    assert(
      degraded.value.snapshot.logs_missing_reason!.reason.includes("내보내기"),
    );
    assertEquals(degraded.value.snapshot.error?.name, "TypeError");
  } finally {
    folder.close();
  }
});
