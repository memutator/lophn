// snapshots 조립의 테스트. 이름은 요구 번호로 시작한다(dev/tasks.md). 실제 임시
// 준비 폴더와 실제 SHA-256 준비 경계(testing/mod.ts)를 쓴다. raw stack은 조립
// 결과에 남지 않고 permanent content는 hash뿐이다.
import { assert, assertEquals } from "@std/assert";
import {
  exceptionObservationInputSchema,
  snapshotInputSchema,
} from "../../protocol/problems/mod.ts";
import { assembleException } from "./work.ts";
import type { ObservedExceptionInput } from "../../protocol/problems/mod.ts";
import { preparedFolder, realPrepare } from "./testing/mod.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const BUNDLE = "ab".repeat(32);
const CAPTURED = "2026-10-04T12:00:01.000Z";
const OBSERVED = "2026-10-04T12:00:00.000Z";
const SOURCE_MAP = {
  version: 3,
  sources: ["src/save.ts", "node:internal/modules/cjs/loader", "../outside.ts"],
  mappings: "AAAA,CAAC;AAAD,aAAC;AAAA",
};

function observation(
  error: ObservedExceptionInput["error"],
): ObservedExceptionInput {
  const parsed = exceptionObservationInputSchema.safeParse({
    report_id: "rpt_01arz3ndektsv4rrffq69g5fav",
    observed_at: OBSERVED,
    observation: "error",
    error,
    error_missing_reason: error === null ? { reason: "collector" } : null,
    invocation: null,
  });
  assert(parsed.success, JSON.stringify(parsed.error?.issues));
  return parsed.data as ObservedExceptionInput;
}

Deno.test("problems/snapshots#R6 R11: process stack은 준비 폴더 source map으로 원래 상대 path를 찾고 runtime 소스는 위치에서 빠진다", async () => {
  const folder = preparedFolder();
  const prepare = realPrepare();
  try {
    await folder.seal(APP, BUNDLE, [
      {
        path: "manifest.json",
        content: JSON.stringify({
          entrypoint: "app.js",
          files: [{ path: "app.js", hash: BUNDLE }],
          sdk_dependencies: [],
        }),
      },
      { path: "app.js.map", content: JSON.stringify(SOURCE_MAP) },
    ]);
    const assembled = await assembleException(
      observation({
        name: "TypeError",
        message: "cannot read x",
        message_missing_reason: null,
        stack:
          "TypeError: cannot read x\n    at saveDocument (file:///app/app.js:1:1)",
        stack_missing_reason: null,
      }),
      { app: APP, bundle_hash: BUNDLE },
      {
        blobPrepare: { prepare: prepare.prepare },
        folder: { appsRoot: folder.root },
        nowAt: CAPTURED,
        principal: "collector-1",
      },
    );
    assert(assembled.ok, assembled.ok ? "" : assembled.error.message);
    const snapshot = assembled.value.snapshot;
    assert(snapshot.error !== null);
    // 준비 폴더 안 소스만 원래 상대 path로 남는다(R6).
    assertEquals(snapshot.error.frames.length, 1);
    assertEquals(snapshot.error.frames[0]!.path, "src/save.ts");
    assertEquals(snapshot.error.frames[0]!.line, 1);
    assertEquals(snapshot.error.frames[0]!.column, 1);
    assertEquals(snapshot.error.source_missing_reason, null);
    // runtime 소스(node:internal)·준비 폴더 밖(..)은 위치를 남기지 않는다(R6).
    // source map 위치 찾기 결과는 지문 key에도 같은 frame만 취한다(grouping#R2).
    const frames = snapshot.error.frames.map((frame) => ({
      path: frame.path,
      function: frame.function,
    }));
    assertEquals(frames, [{ path: "src/save.ts", function: null }]);
  } finally {
    folder.close();
  }
});

Deno.test("problems/snapshots#R11: map·manifest·준비 폴더가 없으면 공백 아닌 source_missing_reason을 남긴다", async () => {
  const prepare = realPrepare();
  // appsRoot가 없다: 준비 폴더 자체가 없는 출처다.
  const withoutRoot = await assembleException(
    observation({
      name: "TypeError",
      message: "x",
      message_missing_reason: null,
      stack: "TypeError: x\n    at run (app.js:1:1)",
      stack_missing_reason: null,
    }),
    { app: APP, bundle_hash: null },
    {
      blobPrepare: { prepare: prepare.prepare },
      folder: { appsRoot: null },
      nowAt: CAPTURED,
      principal: "collector-1",
    },
  );
  assert(withoutRoot.ok);
  assert(withoutRoot.value.snapshot.error !== null);
  assertEquals(withoutRoot.value.snapshot.error.frames, []);
  assertEquals(
    withoutRoot.value.snapshot.error.source_missing_reason?.reason,
    "release 준비 폴더가 없다",
  );
  // 준비 폴더가 있어도 map이 없다(R11).
  const folder = preparedFolder();
  try {
    await folder.seal(APP, BUNDLE, [
      {
        path: "manifest.json",
        content: JSON.stringify({
          entrypoint: "app.js",
          files: [],
          sdk_dependencies: [],
        }),
      },
    ]);
    const withoutMap = await assembleException(
      observation({
        name: "TypeError",
        message: "x",
        message_missing_reason: null,
        stack: "TypeError: x\n    at run (app.js:1:1)",
        stack_missing_reason: null,
      }),
      { app: APP, bundle_hash: BUNDLE },
      {
        blobPrepare: { prepare: prepare.prepare },
        folder: { appsRoot: folder.root },
        nowAt: CAPTURED,
        principal: "collector-1",
      },
    );
    assert(withoutMap.ok);
    assert(withoutMap.value.snapshot.error !== null);
    assertEquals(
      withoutMap.value.snapshot.error.source_missing_reason?.reason,
      "파일을 읽지 못했다",
    );
    // 이유는 공백 아닌 문자열 하나다(snapshots#R4).
    assert(
      (withoutMap.value.snapshot.error.source_missing_reason?.reason
        .length ?? 0) > 0,
    );
  } finally {
    folder.close();
  }
});

Deno.test("problems/snapshots#R6: 준비 폴더 밖 path·symlink는 읽지 않고 이유를 남긴다", async () => {
  const folder = preparedFolder();
  const prepare = realPrepare();
  try {
    // symlink인 map은 읽지 않는다. sandbox가 밖을 가리키는 symlink를 만들지
    // 않으므로 같은 사본 안 manifest.json을 가리킨다: 내용이 map 형식이
    // 아니어도 symlink refusal이 원본 읽기보다 앞선다.
    await folder.seal(APP, BUNDLE, [
      {
        path: "manifest.json",
        content: JSON.stringify({
          entrypoint: "app.js",
          files: [],
          sdk_dependencies: [],
        }),
      },
    ]);
    await folder.symlink(APP, BUNDLE, "app.js.map", "manifest.json");
    const refused = await assembleException(
      observation({
        name: "TypeError",
        message: "x",
        message_missing_reason: null,
        stack: "TypeError: x\n    at run (app.js:1:1)",
        stack_missing_reason: null,
      }),
      { app: APP, bundle_hash: BUNDLE },
      {
        blobPrepare: { prepare: prepare.prepare },
        folder: { appsRoot: folder.root },
        nowAt: CAPTURED,
        principal: "collector-1",
      },
    );
    assert(refused.ok);
    assert(refused.value.snapshot.error !== null);
    assertEquals(refused.value.snapshot.error.frames, []);
    assertEquals(
      refused.value.snapshot.error.source_missing_reason?.reason,
      "path가 symlink라 읽지 않는다",
    );
    // smylink 실패 이유가 파일 내용보다 앞선다: manifest.json을 가리키지만
    // refusal 이유는 symlink라는 점이다.
    assertEquals(
      refused.value.snapshot.error?.source_missing_reason?.reason,
      "path가 symlink라 읽지 않는다",
    );
  } finally {
    folder.close();
  }
});

Deno.test("problems/snapshots#R6 R10: 준비 폴더 밖 path는 읽지 않고..\ 따르는 위치도 원본은 남지 않는다", async () => {
  const folder = preparedFolder();
  const prepare = realPrepare();
  try {
    await folder.seal(APP, BUNDLE, [
      {
        path: "manifest.json",
        content: JSON.stringify({
          entrypoint: "app.js",
          files: [],
          sdk_dependencies: [],
        }),
      },
      // sources가 준비 폴더 밖 path만 담는다.
      {
        path: "app.js.map",
        content: JSON.stringify({
          version: 3,
          sources: ["/abs/path.ts", "node:internal/x", "../up.ts"],
          mappings: "AAAA,CAAC",
        }),
      },
    ]);
    const outside = await assembleException(
      observation({
        name: "TypeError",
        message: "x",
        message_missing_reason: null,
        stack: "TypeError: x\n    at run (app.js:1:1)",
        stack_missing_reason: null,
      }),
      { app: APP, bundle_hash: BUNDLE },
      {
        blobPrepare: { prepare: prepare.prepare },
        folder: { appsRoot: folder.root },
        nowAt: CAPTURED,
        principal: "collector-1",
      },
    );
    assert(outside.ok);
    assert(outside.value.snapshot.error !== null);
    // 분류 가능한 앱 frame이 0개면 원본 없이 이유만 남는다(snapshots#R4 짝).
    assertEquals(outside.value.snapshot.error.frames, []);
    assert(outside.value.snapshot.error.source_missing_reason !== null);
  } finally {
    folder.close();
  }
});

Deno.test("problems/snapshots#R10 R20: 오류 frame은 최대 32개고 redaction된 stack은 최대 16,384 bytes다", async () => {
  const folder = preparedFolder();
  const prepare = realPrepare();
  try {
    // 40개 소스의 mappings: frame은 32개만 남는다(R10).
    const sources: string[] = [];
    const lines: string[] = [];
    for (let index = 0; index < 40; index++) {
      sources.push(`src/f${index}.ts`);
      lines.push("AAAA");
    }
    await folder.seal(APP, BUNDLE, [
      {
        path: "manifest.json",
        content: JSON.stringify({
          entrypoint: "app.js",
          files: [],
          sdk_dependencies: [],
        }),
      },
      {
        path: "app.js.map",
        content: JSON.stringify({
          version: 3,
          sources,
          mappings: lines.join(";"),
        }),
      },
    ]);
    const longStack = `TypeError: big\n    at f (${
      "".padEnd(
        20_000,
        "x",
      )
    })`;
    const assembled = await assembleException(
      observation({
        name: "TypeError",
        message: "big",
        message_missing_reason: null,
        stack: longStack,
        stack_missing_reason: null,
      }),
      { app: APP, bundle_hash: BUNDLE },
      {
        blobPrepare: { prepare: prepare.prepare },
        folder: { appsRoot: folder.root },
        nowAt: CAPTURED,
        principal: "collector-1",
      },
    );
    assert(assembled.ok, assembled.ok ? "" : assembled.error.message);
    const snapshot = assembled.value.snapshot;
    assert(snapshot.error !== null);
    assertEquals(snapshot.error.frames.length, 32);
    // stack은 최대 16,384 bytes만 보존한다(R20).
    assert(snapshot.error.stack !== null);
    const stackEntry = prepare.calls.find((call) =>
      call.purpose === "snapshot_stack"
    );
    assert(stackEntry !== undefined);
    assertEquals(stackEntry.size_bytes, 16_384);
    assertEquals(
      snapshot.error.truncation_notes.some((note) =>
        note.includes("16,384") || note.includes("16384")
      ),
      true,
      JSON.stringify(snapshot.error.truncation_notes),
    );
    // 넘치지 않는 stack은 잘림 노트가 없다.
    const short = await assembleException(
      observation({
        name: "TypeError",
        message: "small",
        message_missing_reason: null,
        stack: "TypeError: small\n    at f (app.js:1:1)",
        stack_missing_reason: null,
      }),
      { app: APP, bundle_hash: BUNDLE },
      {
        blobPrepare: { prepare: prepare.prepare },
        folder: { appsRoot: folder.root },
        nowAt: CAPTURED,
        principal: "collector-1",
      },
    );
    assert(short.ok);
    assert(short.value.snapshot.error !== null);
    assertEquals(short.value.snapshot.error.truncation_notes, []);
  } finally {
    folder.close();
  }
});

Deno.test("problems/snapshots#R5: 큰 자료 준비 2,359,296 bytes 상한에서 실패한 항목은 이유를 고정하고 남은 자료로 접수한다", async () => {
  const prepare = realPrepare();
  // stack 준비가 실패해도 snapshot 조립은 이유를 고정하고 남은 자료로 접수한다(R5).
  prepare.fail("blob 저장소 여유가 없다");
  const assembled = await assembleException(
    observation({
      name: "TypeError",
      message: "x",
      message_missing_reason: null,
      stack: "TypeError: x\n    at run (app.js:1:1)",
      stack_missing_reason: null,
    }),
    { app: APP, bundle_hash: BUNDLE },
    {
      blobPrepare: { prepare: prepare.prepare },
      folder: { appsRoot: null },
      nowAt: CAPTURED,
      principal: "collector-1",
    },
  );
  assert(assembled.ok, assembled.ok ? "" : assembled.error.message);
  const snapshot = assembled.value.snapshot;
  assert(snapshot.error !== null);
  // 실패한 항목은 이유를 고정한다: stack hash는 남기지 않는다(R5).
  assertEquals(snapshot.error.stack, null);
  assertEquals(
    snapshot.error.stack_missing_reason,
    { reason: "collector" },
  );
  assertEquals(
    snapshot.error.truncation_notes.some((note) =>
      note.includes("stack blob 준비 실패")
    ),
    true,
    JSON.stringify(snapshot.error.truncation_notes),
  );
  // 나머지 자료는 그대로 접수값에 있다(R5).
  assertEquals(snapshot.error.name, "TypeError");
  assertEquals(snapshot.error.message, "x");
  assertEquals(snapshot.captured_at, CAPTURED);
});

Deno.test("problems/snapshots#R5: 작은 Report·Snapshot도 저장 못 하면 접수 실패 이유를 남긴다", async () => {
  const prepare = realPrepare();
  prepare.fail("작은 내용도 쓰지 못했다");
  const assembled = await assembleException(
    observation({
      name: "RangeError",
      message: null,
      message_missing_reason: { reason: "redaction" },
      stack: null,
      stack_missing_reason: { reason: "collector" },
    }),
    { app: APP, bundle_hash: null },
    {
      blobPrepare: { prepare: prepare.prepare },
      folder: { appsRoot: null },
      nowAt: CAPTURED,
      principal: "collector-1",
    },
  );
  assert(assembled.ok);
  const snapshot = assembled.value.snapshot;
  assert(snapshot.error !== null);
  assertEquals(snapshot.error.message, null);
  assertEquals(
    snapshot.error.message_missing_reason,
    { reason: "redaction" },
  );
});

Deno.test("problems/snapshots#R8 R9: SDK가 실제 연결한 invocation ID만 닿고 기록이 아직 없으면 ID와 record_missing_reason을 남긴다", async () => {
  const prepare = realPrepare();
  const parsed = exceptionObservationInputSchema.safeParse({
    report_id: "rpt_01arz3ndektsv4rrffq69g5fav",
    observed_at: OBSERVED,
    observation: "unhandledrejection",
    error: {
      name: "TypeError",
      message: "x",
      message_missing_reason: null,
      stack: null,
      stack_missing_reason: { reason: "collector" },
    },
    error_missing_reason: null,
    invocation: {
      id: "inv_01arz3ndektsv4rrffq69g5fav",
      binding: "sdk_context",
      record_missing_reason: { reason: "deadline" },
    },
  });
  assert(parsed.success, JSON.stringify(parsed.error?.issues));
  const assembled = await assembleException(
    parsed.data as ObservedExceptionInput,
    { app: APP, bundle_hash: null },
    {
      blobPrepare: { prepare: prepare.prepare },
      folder: { appsRoot: null },
      nowAt: CAPTURED,
      principal: "collector-1",
    },
  );
  assert(assembled.ok);
  const snapshot = assembled.value.snapshot;
  // ID는 남기고 기록 여부 판정은 근접 추정 없이 그 이유만 남는다(R8, R9).
  assertEquals(snapshot.invocation, {
    id: "inv_01arz3ndektsv4rrffq69g5fav",
    binding: "sdk_context",
    record_missing_reason: { reason: "deadline" },
  });
  assertEquals(snapshot.invocation_missing_reason, null);
  // invocation을 연결하지 않았으면 이유 하나로 남는다(R9).
  const unbound = await assembleException(
    observation({
      name: "TypeError",
      message: "x",
      message_missing_reason: null,
      stack: null,
      stack_missing_reason: { reason: "collector" },
    }),
    { app: APP, bundle_hash: null },
    {
      blobPrepare: { prepare: prepare.prepare },
      folder: { appsRoot: null },
      nowAt: CAPTURED,
      principal: "collector-1",
    },
  );
  assert(unbound.ok);
  assertEquals(unbound.value.snapshot.invocation, null);
  assert(unbound.value.snapshot.invocation_missing_reason !== null);
});

Deno.test("problems/snapshots#R1 R2: captured_at과 observed_at은 따로 두고 나중 자료로 UPDATE하지 않는 조립값은 snapshot 하나다", async () => {
  const prepare = realPrepare();
  const assembled = await assembleException(
    observation({
      name: "TypeError",
      message: "x",
      message_missing_reason: null,
      stack: "TypeError: x\n    at run (app.js:1:1)",
      stack_missing_reason: null,
    }),
    { app: APP, bundle_hash: null },
    {
      blobPrepare: { prepare: prepare.prepare },
      folder: { appsRoot: null },
      nowAt: CAPTURED,
      principal: "collector-1",
    },
  );
  assert(assembled.ok);
  const snapshot = assembled.value.snapshot;
  // captured_at(수집 시각)은 observation의 observed_at과 같은 값이 아니다(R1).
  assertEquals(snapshot.id, "snp_01arz3ndektsv4rrffq69g5fav");
  assertEquals(snapshot.captured_at, CAPTURED);
  assert(snapshot.captured_at !== OBSERVED);
  // snapshot input schema를 그대로 통과한다: 나중 UPDATE 경로가 없다(R2).
  const parsed = snapshotInputSchema.safeParse(snapshot);
  assertEquals(parsed.success, true, JSON.stringify(parsed.error?.issues));
});
