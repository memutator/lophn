// documents/formats#R4, documents/file-tracking#R5: 준비 route의 format 검사. 원문 바이트는
// 요청 앞에 byte chunk frame으로 오고, coordinator가 format runner로 검사한다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../../base/mod.ts";
import { VALIDATE_INPUT_MAX_BYTES } from "../../file-tracking/mod.ts";
import type { FormatCall } from "../reads.ts";
import { createFormatHandlers } from "../reads.ts";
import { BUILTIN_MODULE_HASH } from "../guest/module-hash.ts";
import { createByteInbox, validateFiles } from "./validation.ts";

const encoder = new TextEncoder();

function bytesFrame(channel: number, payload: Uint8Array) {
  return { kind: "bytes" as const, channel, payload };
}

Deno.test("documents/formats#R4: 같은 channel의 chunk는 이어 붙여 요청이 가져가고 한 번 가져가면 비운다", () => {
  const inbox = createByteInbox();
  inbox.collect(bytesFrame(1, encoder.encode("ab")));
  inbox.collect(bytesFrame(1, encoder.encode("cd")));
  inbox.collect(bytesFrame(2, encoder.encode("zz")));
  const taken = inbox.take(1, 4);
  assert(taken.ok);
  assertEquals(new TextDecoder().decode(taken.value), "abcd");
  // 한 번 가져간 channel은 없다.
  assert(!inbox.take(1, 4).ok);
  const other = inbox.take(2, 2);
  assert(other.ok);
});

Deno.test("documents/formats#R4: 길이가 다르거나 오지 않은 바이트는 통과로 꾸미지 않고 unavailable이다", () => {
  const inbox = createByteInbox();
  inbox.collect(bytesFrame(1, encoder.encode("ab")));
  const short = inbox.take(1, 5);
  assert(!short.ok);
  assertEquals(short.error.code, "unavailable");
  const missing = inbox.take(9, 3);
  assert(!missing.ok);
  // 빈 파일은 바이트 frame이 없어도 빈 바이트다.
  const empty = inbox.take(10, 0);
  assert(empty.ok);
  assertEquals(empty.value.length, 0);
});

Deno.test("documents/formats#R4: 입력 상한을 넘게 쌓인 channel은 버리고 가져가도 실패한다", () => {
  const inbox = createByteInbox();
  const chunk = new Uint8Array(1024 * 1024);
  for (
    let count = 0;
    count <= VALIDATE_INPUT_MAX_BYTES / chunk.length;
    count++
  ) {
    inbox.collect(bytesFrame(1, chunk));
  }
  assert(!inbox.take(1, VALIDATE_INPUT_MAX_BYTES).ok);
});

Deno.test("documents/formats#R4: 요청이 오지 않은 channel이 쌓이면 오래된 것부터 버린다", () => {
  const inbox = createByteInbox(2);
  inbox.collect(bytesFrame(1, encoder.encode("a")));
  inbox.collect(bytesFrame(2, encoder.encode("b")));
  inbox.collect(bytesFrame(3, encoder.encode("c")));
  assert(!inbox.take(1, 1).ok);
  assert(inbox.take(2, 1).ok);
  assert(inbox.take(3, 1).ok);
});

const FORMAT = {
  name: "document",
  module_hash: BUILTIN_MODULE_HASH,
  explicit: false,
};

const BLOB_HASH = "ab".repeat(32);

function request(bytes: number, media = "text/markdown") {
  return {
    files: [{
      path: "a.md",
      media_type: media,
      primary: true,
      bytes,
      blob_hash: BLOB_HASH,
      channel: 1 as number | null,
    }],
    format: FORMAT,
  };
}

Deno.test("documents/formats#R4: 가져온 바이트는 guest 입력으로 바뀌어 runner 호출에 간다", async () => {
  const inbox = createByteInbox();
  inbox.collect(bytesFrame(1, encoder.encode("# a\n")));
  let seen: FormatCall | undefined;
  const result = await validateFiles(request(4), {
    inbox,
    call(input) {
      seen = input;
      return Promise.resolve(ok({ status: "passed" }));
    },
  });
  assert(result.ok);
  assertEquals(seen?.operation, "validate");
  assertEquals(seen?.name, "document");
  assertEquals(seen?.module_hash, BUILTIN_MODULE_HASH);
  assertEquals(seen?.input.files[0].path, "a.md");
  assertEquals(seen?.input.files[0].primary, true);
  assertEquals(seen?.input.files[0].content, [...encoder.encode("# a\n")]);
});

Deno.test("documents/formats#R4: 바이트가 오지 않았으면 runner를 부르지 않고 실패한다", async () => {
  let called = false;
  const result = await validateFiles(request(4), {
    inbox: createByteInbox(),
    call() {
      called = true;
      return Promise.resolve(ok({}));
    },
  });
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
  assertEquals(called, false);
});

Deno.test("documents/formats#R4: 모르는 format 이름은 미지원이고 통과로 꾸미지 않는다", async () => {
  const inbox = createByteInbox();
  inbox.collect(bytesFrame(1, encoder.encode("x")));
  const result = await validateFiles(
    { ...request(1), format: { ...FORMAT, name: "custom" } },
    {
      inbox,
      call: () => Promise.resolve(err({ code: "internal", message: "no" })),
    },
  );
  assert(!result.ok);
  assertEquals(result.error.code, "not_found");
});

Deno.test("documents/formats#R4: 실제 format runner가 Markdown 원문을 검사해 통과시킨다", async () => {
  const inbox = createByteInbox();
  inbox.collect(bytesFrame(1, encoder.encode("# 제목\n\n본문\n")));
  const formats = createFormatHandlers();
  const result = await validateFiles(
    request(encoder.encode("# 제목\n\n본문\n").length),
    {
      inbox,
      call: (input) => formats.call(input),
    },
  );
  assert(result.ok, result.ok ? "" : result.error.message);
  const outcome = result.value as { status: string; error_count: number };
  assertEquals(outcome.status, "passed");
  assertEquals(outcome.error_count, 0);
});

Deno.test("documents/formats#R4: 실제 format runner는 document format에 맞지 않는 형식을 실패로 돌려준다", async () => {
  const inbox = createByteInbox();
  const png = encoder.encode("plain text declared as png");
  inbox.collect(bytesFrame(1, png));
  const formats = createFormatHandlers();
  const result = await validateFiles(request(png.length, "image/png"), {
    inbox,
    call: (input) => formats.call(input),
  });
  assert(result.ok, result.ok ? "" : result.error.message);
  const outcome = result.value as {
    status: string;
    diagnostics: { code: string }[];
  };
  assertEquals(outcome.status, "failed");
  assertEquals(outcome.diagnostics[0].code, "unsupported_media_type");
});

Deno.test("documents/formats#R4: channel이 없는 첨부는 바이트 없이 경로만 guest로 가고 대표 파일 바이트는 그대로 간다", async () => {
  const inbox = createByteInbox();
  inbox.collect(bytesFrame(1, encoder.encode("# a\n")));
  let seen: FormatCall | undefined;
  const result = await validateFiles({
    files: [
      { ...request(4).files[0], media_type: "text/html" },
      {
        path: "big.png",
        media_type: "image/png",
        primary: false,
        bytes: 64 * 1024 * 1024,
        blob_hash: "cd".repeat(32),
        channel: null,
      },
    ],
    format: FORMAT,
  }, {
    inbox,
    call(input) {
      seen = input;
      return Promise.resolve(ok({ status: "passed" }));
    },
  });
  assert(result.ok);
  assertEquals(seen?.input.files[1].path, "big.png");
  assertEquals(seen?.input.files[1].content, []);
  assertEquals(seen?.input.files[0].content, [...encoder.encode("# a\n")]);
});

Deno.test("documents/formats#R4: 바이트를 읽지 않는 format의 대표 파일은 바이트 없이 요청의 blob hash가 input_hash다", async () => {
  let seen: FormatCall | undefined;
  const result = await validateFiles({
    files: [{
      path: "scan.pdf",
      media_type: "application/pdf",
      primary: true,
      bytes: 200 * 1024 * 1024,
      blob_hash: BLOB_HASH,
      channel: null,
    }],
    format: { ...FORMAT, name: "pdf" },
  }, {
    inbox: createByteInbox(),
    call(input) {
      seen = input;
      return Promise.resolve(ok({ status: "passed" }));
    },
  });
  assert(result.ok);
  assertEquals(seen?.input.input_hash, BLOB_HASH);
  assertEquals(seen?.input.files[0].content, []);
});

Deno.test("documents/formats#R4: 바이트를 읽는 format의 대표 파일에 바이트가 없으면 빈 입력으로 통과시키지 않는다", async () => {
  let called = false;
  const result = await validateFiles(
    {
      files: [{ ...request(4).files[0], channel: null }],
      format: FORMAT,
    },
    {
      inbox: createByteInbox(),
      call() {
        called = true;
        return Promise.resolve(ok({}));
      },
    },
  );
  assert(!result.ok);
  assertEquals(result.error.code, "invalid_input");
  assertEquals(called, false);
});
