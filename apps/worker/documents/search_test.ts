// documents/outline-and-search#R10·R14: coordinator의 search consumer 조립. core가 보낸 event와
// 원문 바이트로 format runner가 section을 추출하고 결과·cursor를 derived store에 쓴다.
// derived store는 실제 파일 SQLite, 추출은 실제 format runner(권한 없는 호출)다.
import { assert, assertEquals } from "@std/assert";
import { err } from "../../../packages/base/mod.ts";
import type { WorkerRequest } from "../../../packages/protocol/platform/mod.ts";
import { BUILTIN_MODULE_HASH } from "../../../packages/documents/formats/guest/module-hash.ts";
import { createFormatHandlers } from "../../../packages/documents/formats/reads.ts";
import { SEARCH_OPS } from "../../../packages/documents/outline-and-search/mod.ts";
import { searchCursorOf } from "../../../packages/documents/outline-and-search/consumer.ts";
import {
  createSearchServing,
  EXTRACTION_ATTEMPTS,
  openSearchStore,
} from "./search.ts";
import { createByteInbox } from "./validation.ts";

const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const HASH = "a".repeat(64);
const encoder = new TextEncoder();

function root() {
  const directory = Deno.makeTempDirSync({ prefix: "documents-search-" });
  return {
    directory,
    remove: () => Deno.removeSync(directory, { recursive: true }),
  };
}

let counter = 0;
function request(op: string, payload: unknown): WorkerRequest {
  counter += 1;
  return { type: "worker_request", request_id: `req-${counter}`, op, payload };
}

function savedEvent(seq: string, version = VER) {
  return {
    seq,
    type: "DocumentSaved",
    subject: DOC,
    payload: {
      version,
      previous_version: null,
      content_hash: HASH,
      format: { name: "document", module_hash: BUILTIN_MODULE_HASH },
      source: null,
    },
  };
}

function extraction(
  channel: number,
  bytes: number,
  format = { name: "document", module_hash: BUILTIN_MODULE_HASH },
) {
  return {
    document: DOC,
    version: VER,
    content_hash: HASH,
    format,
    files: [{
      path: "a.md",
      media_type: "text/markdown",
      primary: true,
      bytes,
      blob_hash: HASH,
      channel,
    }],
  };
}

const TEXT = "# 계획\n\n## 위험\n\n배포 승인이 늦어질 수 있다.\n";

Deno.test("documents/outline-and-search#R10: 저장 event와 원문 바이트로 section을 추출해 index와 cursor를 쓴다", async () => {
  const dir = root();
  try {
    const store = openSearchStore(dir.directory);
    assert(store.ok, store.ok ? "" : store.error.message);
    const inbox = createByteInbox();
    const formats = createFormatHandlers();
    const serving = createSearchServing({
      store: store.value,
      inbox,
      call: (input) => formats.call(input),
    });
    // 원문은 요청 앞에 byte chunk frame으로 온다.
    const bytes = encoder.encode(TEXT);
    inbox.collect({ kind: "bytes", channel: 5, payload: bytes });
    const answered = await serving.handle(request(SEARCH_OPS.apply, {
      event: savedEvent("4"),
      extraction: extraction(5, bytes.length),
    }));
    assertEquals(answered?.ok, true, JSON.stringify(answered));
    assertEquals(searchCursorOf(store.value.read), "4");
    const sections = store.value.read.sql.all(
      `SELECT key FROM derived_sections WHERE version = ? ORDER BY position`,
      [VER],
    ).map((row) => row["key"]);
    assertEquals(sections, ["_preamble", "위험"]);
    const hit = store.value.read.sql.all(
      `SELECT section_key FROM search_rows WHERE body LIKE '%배포 승인%'`,
      [],
    );
    assertEquals(hit.map((row) => row["section_key"]), ["위험"]);
    // cursor 요청은 같은 자리를 돌려준다.
    const cursor = await serving.handle(request(SEARCH_OPS.cursor, {}));
    assertEquals(
      cursor && cursor.ok ? cursor.payload : null,
      { processed_seq: "4" },
    );
    serving.close();
  } finally {
    dir.remove();
  }
});

Deno.test("documents/outline-and-search#R14: 우리가 실행하지 못하는 format은 미지원으로 남고 읽을 수 없는 판은 확인할 수 없는 판으로 남는다", async () => {
  const dir = root();
  try {
    const store = openSearchStore(dir.directory);
    assert(store.ok);
    const inbox = createByteInbox();
    const formats = createFormatHandlers();
    const serving = createSearchServing({
      store: store.value,
      inbox,
      call: (input) => formats.call(input),
    });
    inbox.collect({ kind: "bytes", channel: 1, payload: encoder.encode("x") });
    const unsupported = await serving.handle(request(SEARCH_OPS.apply, {
      event: savedEvent("2"),
      extraction: extraction(1, 1, {
        name: "unknown-format",
        module_hash: HASH,
      }),
    }));
    assertEquals(unsupported?.ok, true);
    const unreadable = await serving.handle(request(SEARCH_OPS.apply, {
      event: savedEvent("3", "ver_01arz3ndektsv4rrffq69g5fb0"),
      extraction: {
        ...extraction(2, 0),
        version: "ver_01arz3ndektsv4rrffq69g5fb0",
        files: [],
        unverified:
          "format check input is 2097152 bytes, over the 1048576 byte limit",
      },
    }));
    assertEquals(unreadable?.ok, true);
    const status = store.value.read.sql.all(
      `SELECT version, extraction_status FROM derived_versions ORDER BY version`,
      [],
    ).map((row) => `${row["extraction_status"]}`);
    assertEquals(status, ["unsupported", "unverified"]);
    // 이유를 밝힌 미확인이다. 누락 목록에도 그 이유가 보인다.
    const reason = store.value.read.sql.get(
      `SELECT unverified_reason FROM derived_versions WHERE version = ?`,
      ["ver_01arz3ndektsv4rrffq69g5fb0"],
    );
    assertEquals(
      reason?.["unverified_reason"],
      "format check input is 2097152 bytes, over the 1048576 byte limit",
    );
    // 읽을 수 없는 판도 cursor는 진행하고 search 행은 없다.
    assertEquals(searchCursorOf(store.value.read), "3");
    assertEquals(
      store.value.read.sql.all(`SELECT 1 FROM search_rows`, []).length,
      0,
    );
    serving.close();
  } finally {
    dir.remove();
  }
});

Deno.test("documents/outline-and-search#R14: 추출이 끝나지 않으면 처음에는 실패로 답해 다시 받고, 계속 끝나지 않으면 판을 failed로 남기고 cursor를 진행한다", async () => {
  const dir = root();
  try {
    const store = openSearchStore(dir.directory);
    assert(store.ok);
    const inbox = createByteInbox();
    const serving = createSearchServing({
      store: store.value,
      inbox,
      // runner가 계속 실패하는 경우. 실제 runner 호출 대신 실패 결과를 준다.
      call: () =>
        Promise.resolve(
          err({ code: "unavailable", message: "runner did not finish" }),
        ),
    });
    for (let attempt = 1; attempt <= EXTRACTION_ATTEMPTS; attempt++) {
      inbox.collect({
        kind: "bytes",
        channel: attempt,
        payload: encoder.encode("본문"),
      });
      const answered = await serving.handle(request(SEARCH_OPS.apply, {
        event: savedEvent("6"),
        extraction: extraction(attempt, encoder.encode("본문").length),
      }));
      if (attempt < EXTRACTION_ATTEMPTS) {
        // 끝나지 않은 동안은 cursor가 그대로라 core가 같은 event를 다시 보낸다.
        assertEquals(answered?.ok, false);
        assertEquals(searchCursorOf(store.value.read), "0");
      } else {
        assertEquals(answered?.ok, true);
      }
    }
    assertEquals(searchCursorOf(store.value.read), "6");
    const failed = store.value.read.sql.get(
      `SELECT extraction_status, failure_reason FROM derived_versions WHERE version = ?`,
      [VER],
    );
    assertEquals(failed?.["extraction_status"], "failed");
    serving.close();
  } finally {
    dir.remove();
  }
});

Deno.test("documents/outline-and-search#R14: search op가 아니거나 모양이 틀린 요청은 index를 바꾸지 않는다", async () => {
  const dir = root();
  try {
    const store = openSearchStore(dir.directory);
    assert(store.ok);
    const serving = createSearchServing({
      store: store.value,
      inbox: createByteInbox(),
      call: () => Promise.resolve(err({ code: "unavailable", message: "x" })),
    });
    assertEquals(
      serving.handle(request("documents.file_status", {})),
      undefined,
    );
    const bad = await serving.handle(
      request(SEARCH_OPS.apply, { event: { seq: "x" } }),
    );
    assertEquals(bad?.ok, false);
    const badAdvance = await serving.handle(
      request(SEARCH_OPS.advance, { to: "-1" }),
    );
    assertEquals(badAdvance?.ok, false);
    assertEquals(searchCursorOf(store.value.read), "0");
    serving.close();
  } finally {
    dir.remove();
  }
});
