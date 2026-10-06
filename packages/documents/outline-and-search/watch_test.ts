// documents/contexts#R11·R12: watch가 쓰는 derived 자리. `watch` cursor는 search와 따로 가고 뒤로
// 가지 않으며, 미확인 비교는 저장 event별로 바뀌고, 전후 판의 section 상태는 추출 상태를 구별한다.
import { assert, assertEquals } from "@std/assert";
import { openDerived } from "./adapters/store.ts";
import { applySearchStep, searchCursorOf } from "./consumer.ts";
import type { ExtractionRecord } from "./extraction.ts";
import {
  advanceWatchCursor,
  applyWatchStep,
  listWatchUnverified,
  loadWatchSectionState,
  WATCH_PENDING_REASON,
  watchCursorOf,
} from "./watch.ts";

const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const CTX = "ctx_01arz3ndektsv4rrffq69g5fav";
const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const HASH = "a".repeat(64);

function store() {
  const directory = Deno.makeTempDirSync({ prefix: "watch-derived-" });
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

function extract(
  target: ReturnType<typeof store>,
  extraction: ExtractionRecord["extraction"],
  seq = "1",
) {
  const stepped = applySearchStep(target.store, {
    event: {
      seq,
      type: "DocumentSaved",
      subject: DOC,
      payload: {
        version: VER,
        previous_version: null,
        content_hash: HASH,
        format: { name: "document", module_hash: HASH },
      },
    },
    extraction: {
      document: DOC,
      version: VER,
      content_hash: HASH,
      module_hash: HASH,
      extraction,
    },
  });
  assert(stepped.ok);
}

Deno.test("documents/contexts#R12: watch cursor는 search와 따로 가고 뒤로 가지 않는다", () => {
  const target = store();
  try {
    assertEquals(watchCursorOf(target.store.read), "0");
    const advanced = advanceWatchCursor(target.store, "9");
    assert(advanced.ok);
    assertEquals(advanced.value.processed_seq, "9");
    // 더 앞선 자리는 무시한다.
    const back = advanceWatchCursor(target.store, "4");
    assert(back.ok);
    assertEquals(back.value.processed_seq, "9");
    assertEquals(watchCursorOf(target.store.read), "9");
    // search cursor는 그대로다.
    assertEquals(searchCursorOf(target.store.read), "0");
  } finally {
    target.close();
  }
});

Deno.test("documents/contexts#R11: 미확인 비교는 저장 event별로 바뀌고 cursor와 한 transaction에 쓴다", () => {
  const target = store();
  try {
    const row = (reason: string, section: string | null = "위험") => ({
      context: CTX,
      document: DOC,
      section,
      source_seq: "7",
      context_revision: "3",
      before_version: null,
      after_version: VER,
      reason,
    });
    const first = applyWatchStep(target.store, {
      source_seq: "7",
      unverified: [row("extraction pending"), row("module", "요약")],
    });
    assert(first.ok);
    assertEquals(
      listWatchUnverified(target.store.read).map((found) => [
        found.section,
        found.reason,
      ]),
      [["요약", "module"], ["위험", "extraction pending"]],
    );
    assertEquals(watchCursorOf(target.store.read), "7");
    // 같은 event를 다시 계산하면 그 결과로 바뀐다: 확인된 항목은 사라진다.
    const again = applyWatchStep(target.store, {
      source_seq: "7",
      unverified: [row("extraction failed", "요약")],
    });
    assert(again.ok);
    const rows = listWatchUnverified(target.store.read);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].reason, "extraction failed");
    assertEquals(rows[0].context_revision, "3");
    // 다른 event의 미확인은 건드리지 않는다.
    const other = applyWatchStep(target.store, {
      source_seq: "9",
      unverified: [],
    });
    assert(other.ok);
    assertEquals(listWatchUnverified(target.store.read).length, 1);
    assertEquals(watchCursorOf(target.store.read), "9");
  } finally {
    target.close();
  }
});

Deno.test("documents/contexts#R11: section 상태는 추출 미완료·실패·미지원·미확인을 이유와 함께 구별한다", () => {
  const target = store();
  try {
    // 추출 전에는 그 판을 모른다.
    assertEquals(loadWatchSectionState(target.store.read, VER, "위험"), {
      kind: "unknown",
      reason: WATCH_PENDING_REASON,
    });
    extract(target, { status: "failed", failure_reason: "runner crashed" });
    assertEquals(loadWatchSectionState(target.store.read, VER, "위험"), {
      kind: "unknown",
      reason: "runner crashed",
    });
    extract(target, { status: "unsupported" }, "2");
    assertEquals(loadWatchSectionState(target.store.read, VER, "위험"), {
      kind: "unknown",
      reason: "extraction unsupported",
    });
    extract(target, { status: "unverified", reason: "too large" }, "3");
    assertEquals(loadWatchSectionState(target.store.read, VER, "위험"), {
      kind: "unknown",
      reason: "too large",
    });
    extract(target, { status: "unverified" }, "4");
    assertEquals(loadWatchSectionState(target.store.read, VER, "위험"), {
      kind: "unknown",
      reason: "extraction unverified",
    });
  } finally {
    target.close();
  }
});

Deno.test("documents/contexts#R10: 성공한 추출의 section 상태는 그 key만 읽고 없는 key는 빈 목록이다", () => {
  const target = store();
  try {
    const section = (key: string, position: number, body: string) => ({
      key,
      title: key,
      parent: null,
      position,
      level: 2,
      anchor: null,
      own_ranges: [{ start_line: 1, end_line: 1 }],
      subtree_range: { start_line: 1, end_line: 1 },
      characters: 3,
      body_hash: body,
    });
    extract(target, {
      status: "ready",
      title: "제목",
      text: "본문",
      text_hash: HASH,
      sections: [section("위험", 0, "b".repeat(64)), section("요약", 1, HASH)],
    });
    assertEquals(loadWatchSectionState(target.store.read, VER, "위험"), {
      kind: "ready",
      snapshot: {
        module_hash: HASH,
        sections: [{
          key: "위험",
          title: "위험",
          position: 0,
          body_hash: "b".repeat(64),
        }],
      },
    });
    assertEquals(loadWatchSectionState(target.store.read, VER, "없음"), {
      kind: "ready",
      snapshot: { module_hash: HASH, sections: [] },
    });
  } finally {
    target.close();
  }
});
