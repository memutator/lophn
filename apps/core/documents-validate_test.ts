// documents/formats#R4, documents/file-tracking#R5: 준비 route의 format 검사 통로. core는 원문
// blob을 창 단위로 읽어 coordinator pipe로 보내고, 같은 channel을 가리키는 요청을 한 번에
// 하나씩 보낸다. 통로가 하나라도 끊기면 통과로 꾸미지 않고 unavailable이다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../packages/base/mod.ts";
import { FORMAT_CHECK_CONTENT_MAX_BYTES } from "../../packages/protocol/projects/mod.ts";
import { BLOB_READ_MAX_BYTES } from "../../packages/protocol/server/mod.ts";
import { DOCUMENT_OPS } from "../../packages/core/projects/file-tracking/mod.ts";
import { createValidatePort, type ValidateDeps } from "./documents-validate.ts";

const HASH = "ab".repeat(32);
const FORMAT = { name: "document", module_hash: HASH, explicit: false };

function file(path: string, bytes: number, primary = true) {
  return {
    path,
    blob_hash: HASH,
    bytes,
    media_type: "text/markdown",
    primary,
  };
}

const PASSED = {
  input_hash: HASH,
  module_hash: HASH,
  status: "passed",
  error_count: 0,
  warning_count: 0,
  diagnostics: [],
};

type Trace = {
  reads: { offset: number; length: number }[];
  sent: { channel: number; length: number }[];
  requests: { op: string; payload: unknown }[];
};

function deps(
  over: Partial<ValidateDeps> = {},
): { deps: ValidateDeps; trace: Trace } {
  const trace: Trace = { reads: [], sent: [], requests: [] };
  return {
    trace,
    deps: {
      readBlob: (_hash, offset, length) => {
        trace.reads.push({ offset, length });
        return Promise.resolve(ok({
          hash: HASH,
          sizeBytes: 0,
          bytes: new Uint8Array(length),
        }));
      },
      sendBytes: (channel, chunk) => {
        trace.sent.push({ channel, length: chunk.length });
        return Promise.resolve(true);
      },
      request: (op, payload) => {
        trace.requests.push({ op, payload });
        return Promise.resolve(ok(PASSED));
      },
      ...over,
    },
  };
}

Deno.test("documents/formats#R4: 원문은 읽기 창 단위로 pipe에 가고 요청은 channel과 길이로 그 바이트를 가리킨다", async () => {
  const size = BLOB_READ_MAX_BYTES * 2 + 10;
  const wired = deps();
  const validate = createValidatePort(wired.deps);
  const result = await validate([file("a.md", size)], FORMAT);
  assert(result.ok, result.ok ? "" : result.error.message);
  assertEquals(result.value.status, "passed");
  assertEquals(
    wired.trace.reads.map((read) => [read.offset, read.length]),
    [
      [0, BLOB_READ_MAX_BYTES],
      [BLOB_READ_MAX_BYTES, BLOB_READ_MAX_BYTES],
      [BLOB_READ_MAX_BYTES * 2, 10],
    ],
  );
  assertEquals(
    wired.trace.sent.reduce((sum, item) => sum + item.length, 0),
    size,
  );
  const [request] = wired.trace.requests;
  assertEquals(request.op, DOCUMENT_OPS.validateFiles);
  const body = request.payload as {
    files: { bytes: number; channel: number }[];
    format: unknown;
  };
  assertEquals(body.files[0].bytes, size);
  assertEquals(body.files[0].channel, wired.trace.sent[0].channel);
  assertEquals(body.format, FORMAT);
});

Deno.test("documents/formats#R4: 바이트는 대표 파일만 보내고 첨부는 channel 없이 크기만 알린다", async () => {
  const wired = deps();
  const validate = createValidatePort(wired.deps);
  // 첨부가 한도보다 커도 검사 입력이 아니다.
  const attachment = FORMAT_CHECK_CONTENT_MAX_BYTES * 8;
  const result = await validate(
    [file("a.md", 3), file("b.png", attachment, false)],
    FORMAT,
  );
  assert(result.ok, result.ok ? "" : result.error.message);
  const body = wired.trace.requests[0].payload as {
    files: {
      path: string;
      bytes: number;
      blob_hash: string;
      channel: number | null;
    }[];
  };
  assertEquals(body.files.map((entry) => entry.path), ["a.md", "b.png"]);
  assertEquals(body.files[0].channel, wired.trace.sent[0].channel);
  assertEquals(body.files[1].channel, null);
  assertEquals(body.files[1].bytes, attachment);
  assertEquals(body.files[1].blob_hash, HASH);
  assertEquals(wired.trace.sent.reduce((sum, item) => sum + item.length, 0), 3);
  assertEquals(wired.trace.reads.length, 1);
});

Deno.test("documents/formats#R4: 바이트를 읽지 않는 format(pdf·image·data)은 큰 대표 파일도 읽지 않고 검사한다", async () => {
  const wired = deps();
  const validate = createValidatePort(wired.deps);
  const size = 200 * 1024 * 1024;
  const result = await validate([file("scan.pdf", size)], {
    ...FORMAT,
    name: "pdf",
  });
  assert(result.ok, result.ok ? "" : result.error.message);
  assertEquals(wired.trace.reads.length, 0);
  assertEquals(wired.trace.sent.length, 0);
  const body = wired.trace.requests[0].payload as {
    files: { bytes: number; channel: number | null }[];
  };
  assertEquals(body.files[0].channel, null);
  assertEquals(body.files[0].bytes, size);
});

Deno.test("documents/formats#R4: 명시 format의 대표 파일이 입력 한도를 넘으면 읽지도 않고 한도를 밝힌 error로 실패한다", async () => {
  const wired = deps();
  const validate = createValidatePort(wired.deps);
  const over = FORMAT_CHECK_CONTENT_MAX_BYTES + 1;
  const result = await validate([file("a.md", over)], {
    ...FORMAT,
    explicit: true,
  });
  assert(result.ok, result.ok ? "" : result.error.message);
  assertEquals(result.value.status, "failed");
  assertEquals(result.value.error_count, 1);
  assertEquals(result.value.input_hash, HASH);
  const [diagnostic] = result.value.diagnostics;
  assertEquals(diagnostic.severity, "error");
  assertEquals(diagnostic.code, "check_skipped");
  assertEquals(diagnostic.file, "a.md");
  assert(diagnostic.message.includes(String(FORMAT_CHECK_CONTENT_MAX_BYTES)));
  assert(diagnostic.message.includes(String(over)));
  assertEquals(wired.trace.reads.length, 0);
  assertEquals(wired.trace.requests.length, 0);
});

Deno.test("documents/formats#R5: 미지정 format의 대표 파일이 입력 한도를 넘으면 읽지도 않고 한도를 밝힌 warning으로 통과한다", async () => {
  const wired = deps();
  const validate = createValidatePort(wired.deps);
  const over = FORMAT_CHECK_CONTENT_MAX_BYTES * 32;
  const result = await validate([file("a.md", over)], FORMAT);
  assert(result.ok, result.ok ? "" : result.error.message);
  assertEquals(result.value.status, "passed");
  assertEquals(result.value.error_count, 0);
  assertEquals(result.value.warning_count, 1);
  const [diagnostic] = result.value.diagnostics;
  assertEquals(diagnostic.severity, "warning");
  assertEquals(diagnostic.code, "check_skipped");
  assert(diagnostic.message.includes(String(FORMAT_CHECK_CONTENT_MAX_BYTES)));
  assertEquals(wired.trace.reads.length, 0);
  assertEquals(wired.trace.requests.length, 0);
});

Deno.test("documents/formats#R4: 한도 정확히까지의 대표 파일은 검사한다", async () => {
  const wired = deps();
  const result = await createValidatePort(wired.deps)(
    [file("a.md", FORMAT_CHECK_CONTENT_MAX_BYTES)],
    FORMAT,
  );
  assert(result.ok, result.ok ? "" : result.error.message);
  assertEquals(wired.trace.requests.length, 1);
});

Deno.test("documents/formats#R4: blob을 읽지 못하거나 pipe에 쓰지 못하면 요청하지 않고 unavailable이다", async () => {
  const unreadable = deps({
    readBlob: () =>
      Promise.resolve(err({ code: "unavailable", message: "blob 읽기 없음" })),
  });
  const first = await createValidatePort(unreadable.deps)(
    [file("a.md", 3)],
    FORMAT,
  );
  assert(!first.ok);
  assertEquals(first.error.code, "unavailable");
  assertEquals(unreadable.trace.requests.length, 0);
  const unsent = deps({ sendBytes: () => Promise.resolve(false) });
  const second = await createValidatePort(unsent.deps)(
    [file("a.md", 3)],
    FORMAT,
  );
  assert(!second.ok);
  assertEquals(unsent.trace.requests.length, 0);
});

Deno.test("documents/formats#R4: 읽기가 일찍 끝나면 모자란 바이트로 검사하지 않는다", async () => {
  const short = deps({
    readBlob: () =>
      Promise.resolve(
        ok({ hash: HASH, sizeBytes: 0, bytes: new Uint8Array() }),
      ),
  });
  const result = await createValidatePort(short.deps)(
    [file("a.md", 3)],
    FORMAT,
  );
  assert(!result.ok);
  assertEquals(short.trace.requests.length, 0);
});

Deno.test("documents/formats#R4: coordinator가 답하지 못하거나 모양이 틀린 답은 통과로 꾸미지 않는다", async () => {
  const down = deps({
    request: () =>
      Promise.resolve(err({ code: "unavailable", message: "no worker" })),
  });
  const first = await createValidatePort(down.deps)([file("a.md", 3)], FORMAT);
  assert(!first.ok);
  assertEquals(first.error.code, "unavailable");
  const missing = deps({
    request: () =>
      Promise.resolve(err({ code: "not_found", message: "format" })),
  });
  const second = await createValidatePort(missing.deps)(
    [file("a.md", 3)],
    FORMAT,
  );
  assert(!second.ok);
  assertEquals(second.error.code, "not_found");
  const garbage = deps({
    request: () => Promise.resolve(ok({ status: "passed" })),
  });
  const third = await createValidatePort(garbage.deps)(
    [file("a.md", 3)],
    FORMAT,
  );
  assert(!third.ok);
  assertEquals(third.error.code, "unavailable");
  // 진단이 blob 참조로 온 답은 준비 조립이 쓰지 못한다.
  const blobbed = deps({
    request: () =>
      Promise.resolve(
        ok({ ...PASSED, diagnostics: { hash: HASH, size_bytes: 1 } }),
      ),
  });
  const fourth = await createValidatePort(blobbed.deps)(
    [file("a.md", 3)],
    FORMAT,
  );
  assert(!fourth.ok);
});

Deno.test("documents/formats#R4: 검사 실패 판정(failed)은 그대로 돌려준다", async () => {
  const failed = {
    ...PASSED,
    status: "failed",
    error_count: 1,
    diagnostics: [{
      severity: "error",
      code: "invalid_structure",
      message: "broken",
      file: "a.md",
      start_line: 1,
      end_line: 1,
      column: 1,
    }],
  };
  const wired = deps({ request: () => Promise.resolve(ok(failed)) });
  const result = await createValidatePort(wired.deps)(
    [file("a.md", 3)],
    FORMAT,
  );
  assert(result.ok);
  assertEquals(result.value.status, "failed");
  assertEquals(result.value.diagnostics.length, 1);
});

Deno.test("documents/formats#R4: 동시에 온 검사는 한 번에 하나씩 보낸다", async () => {
  let active = 0;
  let overlapped = false;
  const wired = deps({
    request: async () => {
      active += 1;
      if (active > 1) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return ok(PASSED);
    },
  });
  const validate = createValidatePort(wired.deps);
  const results = await Promise.all([
    validate([file("a.md", 3)], FORMAT),
    validate([file("b.md", 3)], FORMAT),
    validate([file("c.md", 3)], FORMAT),
  ]);
  assert(results.every((result) => result.ok));
  assertEquals(overlapped, false);
});
