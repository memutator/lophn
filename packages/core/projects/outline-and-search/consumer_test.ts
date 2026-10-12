import { assert, assertEquals } from "@std/assert";
import { openDerived } from "./adapters/store.ts";
import {
  advanceSearchCursor,
  applySearchStep,
  searchCursorOf,
} from "./consumer.ts";
import type { ExtractionRecord } from "./extraction.ts";
import { extractionTargetOf, SEARCH_CONSUMED_EVENTS } from "./ipc.ts";
import type { ConsumerEvent } from "./work.ts";

const HASH = "a".repeat(64);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const VER_1 = "ver_01arz3ndektsv4rrffq69g5fav";
const VER_2 = "ver_01arz3ndektsv4rrffq69g5fb0";

function store() {
  const directory = Deno.makeTempDirSync({ prefix: "search-consumer-" });
  const opened = openDerived(`${directory}/documents.sqlite`);
  if (!opened.ok) throw new Error(opened.error.message);
  return {
    store: opened.value,
    close() {
      opened.value.close();
      Deno.removeSync(directory, { recursive: true });
    },
  };
}

function saved(seq: string, version: string): ConsumerEvent {
  return {
    seq,
    type: "DocumentSaved",
    subject: DOC,
    payload: {
      version,
      previous_version: null,
      content_hash: HASH,
      format: { name: "document", module_hash: HASH },
      source: null,
    },
  };
}

function record(version: string, text: string): ExtractionRecord {
  return {
    document: DOC,
    version,
    content_hash: HASH,
    module_hash: HASH,
    extraction: {
      status: "ready",
      title: "제목",
      text,
      text_hash: HASH,
      sections: [],
    },
  };
}

function rows(fx: ReturnType<typeof store>): string[] {
  return fx.store.read.sql.all(
    `SELECT version, body FROM search_rows ORDER BY rowid`,
    [],
  ).map((row) => `${row["version"]}:${row["body"]}`);
}

Deno.test("documents/outline-and-search#R10: 저장 event의 결과와 cursor는 한 transaction에 서고 새 판이 낡은 index 행을 바꾼다", () => {
  const fx = store();
  try {
    assertEquals(searchCursorOf(fx.store.read), "0");
    const first = applySearchStep(fx.store, {
      event: saved("3", VER_1),
      extraction: record(VER_1, "처음 본문"),
    });
    assert(first.ok);
    assertEquals(first.value, { applied: true, processed_seq: "3" });
    assertEquals(rows(fx), [`${VER_1}:처음 본문`]);
    assertEquals(searchCursorOf(fx.store.read), "3");

    const second = applySearchStep(fx.store, {
      event: saved("7", VER_2),
      extraction: record(VER_2, "고친 본문"),
    });
    assert(second.ok);
    assertEquals(rows(fx), [`${VER_2}:고친 본문`]);
    assertEquals(searchCursorOf(fx.store.read), "7");
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R14: 이미 지난 seq의 event는 다시 와도 아무것도 바꾸지 않는다(at-least-once)", () => {
  const fx = store();
  try {
    applySearchStep(fx.store, {
      event: saved("5", VER_2),
      extraction: record(VER_2, "최신 본문"),
    });
    // 지난 seq의 옛 event가 늦게 다시 와도 최신 index를 되돌리지 않는다.
    const replay = applySearchStep(fx.store, {
      event: saved("3", VER_1),
      extraction: record(VER_1, "처음 본문"),
    });
    assert(replay.ok);
    assertEquals(replay.value, { applied: false, processed_seq: "5" });
    assertEquals(rows(fx), [`${VER_2}:최신 본문`]);
    assertEquals(searchCursorOf(fx.store.read), "5");
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R14: 실패한 판은 이유를 남기고 cursor는 진행하며 ready 행은 남지 않는다", () => {
  const fx = store();
  try {
    const failed = applySearchStep(fx.store, {
      event: saved("4", VER_1),
      extraction: {
        document: DOC,
        version: VER_1,
        content_hash: HASH,
        module_hash: HASH,
        extraction: { status: "failed", failure_reason: "extraction failed" },
      },
    });
    assert(failed.ok);
    assertEquals(rows(fx), []);
    assertEquals(searchCursorOf(fx.store.read), "4");
    const status = fx.store.read.sql.get(
      `SELECT extraction_status, failure_reason FROM derived_versions WHERE version = ?`,
      [VER_1],
    );
    assertEquals(status, {
      extraction_status: "failed",
      failure_reason: "extraction failed",
    });
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R16: consumer가 쓰지 않는 event는 cursor만 앞으로 보내고 뒤로 가지 않는다", () => {
  const fx = store();
  try {
    applySearchStep(fx.store, {
      event: saved("2", VER_1),
      extraction: record(VER_1, "본문"),
    });
    const advanced = advanceSearchCursor(fx.store, "9");
    assert(advanced.ok);
    assertEquals(advanced.value.processed_seq, "9");
    // 낮은 값으로는 뒤로 가지 않는다. 낡은 index 행도 그대로다.
    const back = advanceSearchCursor(fx.store, "4");
    assert(back.ok);
    assertEquals(back.value.processed_seq, "9");
    assertEquals(rows(fx), [`${VER_1}:본문`]);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R14: 이미 만든 derived 파일을 다시 열어도 표와 cursor가 남는다", () => {
  const directory = Deno.makeTempDirSync({ prefix: "search-consumer-" });
  try {
    const first = openDerived(`${directory}/documents.sqlite`);
    assert(first.ok);
    applySearchStep(first.value, {
      event: saved("6", VER_1),
      extraction: record(VER_1, "남는 본문"),
    });
    first.value.close();
    const again = openDerived(`${directory}/documents.sqlite`);
    assert(again.ok, again.ok ? "" : again.error.message);
    assertEquals(searchCursorOf(again.value.read), "6");
    assertEquals(
      again.value.read.sql.all(`SELECT body FROM search_rows`, []).length,
      1,
    );
    again.value.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("documents/outline-and-search#R10: 저장·복원 event만 판을 추출하고 consumer가 이해하는 event 목록은 대상 불명 무효화를 부르지 않는다", () => {
  assertEquals(extractionTargetOf(saved("1", VER_1)), {
    document: DOC,
    version: VER_1,
  });
  assertEquals(
    extractionTargetOf({
      seq: "2",
      type: "DocumentRestored",
      subject: DOC,
      payload: {
        restore_version: VER_1,
        previous_version: VER_1,
        version: VER_2,
      },
    }),
    { document: DOC, version: VER_2 },
  );
  assertEquals(
    extractionTargetOf({
      seq: "3",
      type: "DocumentArchived",
      subject: DOC,
      payload: {},
    }),
    undefined,
  );
  // DocumentCreated·SourceChanged는 consumer가 쓰지 않는다(쓰면 전체 무효화다).
  assertEquals(SEARCH_CONSUMED_EVENTS.has("DocumentCreated"), false);
  assertEquals(SEARCH_CONSUMED_EVENTS.has("DocumentSourceChanged"), false);
});
