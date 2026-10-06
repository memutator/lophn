// documents/contexts#R9·R10·R11·R12: coordinator의 watch consumer. derived store(실제 파일
// SQLite)의 section으로 전후 고정 판을 비교하고, 확인된 변화만 command로 제출하며, command가
// 수락된 뒤에만 watch cursor를 진행한다. 제출은 주입한 fake다. 데이터 root는 temp dir다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import type { LophnError } from "../../../packages/base/mod.ts";
import type { WorkerRequest } from "../../../packages/contracts/platform/mod.ts";
import type { WatchedItemComparison } from "../../../packages/documents/contexts/mod.ts";
import { applySearchStep } from "../../../packages/documents/outline-and-search/consumer.ts";
import type { ExtractionRecord } from "../../../packages/documents/outline-and-search/extraction.ts";
import {
  listWatchUnverified,
  WATCH_OPS,
  watchCursorOf,
} from "../../../packages/documents/outline-and-search/mod.ts";
import {
  createWatchServing,
  WATCH_CONFLICT_ATTEMPTS,
  WATCH_CONFLICT_REASON,
} from "./watch.ts";
import { openSearchStore } from "./search.ts";

const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const CTX = "ctx_01arz3ndektsv4rrffq69g5fav";
const VER_1 = "ver_01arz3ndektsv4rrffq69g5fav";
const VER_2 = "ver_01arz3ndektsv4rrffq69g5fb0";
const MODULE = "c".repeat(64);
const OTHER_MODULE = "d".repeat(64);
const H = (letter: string) => letter.repeat(64);

let counter = 0;
function request(op: string, payload: unknown): WorkerRequest {
  counter += 1;
  return { type: "worker_request", request_id: `req-${counter}`, op, payload };
}

function root() {
  const directory = Deno.makeTempDirSync({ prefix: "documents-watch-" });
  return {
    directory,
    remove: () => Deno.removeSync(directory, { recursive: true }),
  };
}

function section(key: string, body: string, position = 0) {
  return {
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
  };
}

function ready(
  version: string,
  sections: ReturnType<typeof section>[],
  module = MODULE,
): ExtractionRecord {
  return {
    document: DOC,
    version,
    content_hash: H("a"),
    module_hash: module,
    extraction: {
      status: "ready",
      title: "제목",
      text: "본문",
      text_hash: H("e"),
      sections,
    },
  };
}

function failed(version: string): ExtractionRecord {
  return {
    document: DOC,
    version,
    content_hash: H("a"),
    module_hash: MODULE,
    extraction: { status: "failed", failure_reason: "extraction crashed" },
  };
}

type Opened = ReturnType<typeof open>;

function open(
  submit: (
    comparison: WatchedItemComparison,
    base: string,
  ) => Promise<Result<unknown, LophnError>>,
) {
  const dir = root();
  const store = openSearchStore(dir.directory);
  assert(store.ok, store.ok ? "" : store.error.message);
  const calls: { comparison: WatchedItemComparison; base: string }[] = [];
  const serving = createWatchServing({
    store: store.value,
    submit: (comparison, base) => {
      calls.push({ comparison, base });
      return submit(comparison, base);
    },
  });
  let seq = 0;
  return {
    store: store.value,
    calls,
    // 추출 결과를 심는다(search consumer의 한 걸음).
    extract(record: ExtractionRecord) {
      seq += 1;
      const stepped = applySearchStep(store.value, {
        event: {
          seq: String(seq),
          type: "DocumentSaved",
          subject: DOC,
          payload: {
            version: record.version,
            previous_version: null,
            content_hash: record.content_hash,
            format: { name: "document", module_hash: record.module_hash },
          },
        },
        extraction: record,
      });
      assert(stepped.ok, stepped.ok ? "" : stepped.error.message);
    },
    async apply(
      sourceSeq: string,
      targets: { section: string | null }[],
      hashes: { before: string; after: string } = {
        before: H("1"),
        after: H("2"),
      },
    ) {
      const answered = await serving.handle(request(WATCH_OPS.apply, {
        event: {
          seq: sourceSeq,
          document: DOC,
          version: VER_2,
          previous_version: VER_1,
        },
        before: {
          version: VER_1,
          content_hash: hashes.before,
          module_hash: MODULE,
        },
        after: {
          version: VER_2,
          content_hash: hashes.after,
          module_hash: MODULE,
        },
        targets: targets.map((target) => ({
          context: CTX,
          context_revision: "1",
          section: target.section,
        })),
      }));
      assert(answered !== undefined);
      return answered;
    },
    async call(op: string, payload: unknown) {
      const answered = await serving.handle(request(op, payload));
      assert(answered !== undefined);
      return answered;
    },
    cursor: () => watchCursorOf(store.value.read),
    close() {
      store.value.close();
      dir.remove();
    },
  } satisfies Record<string, unknown>;
}

function accepted() {
  return Promise.resolve(ok({}));
}

Deno.test("documents/contexts#R10: 문서 전체는 content_hash 차이로 내용 변화를 제출하고 수락된 뒤에 cursor가 진행한다", async () => {
  const opened = open(accepted);
  try {
    const answered = await opened.apply("7", [{ section: null }]);
    assertEquals(answered.ok, true, JSON.stringify(answered));
    assertEquals(opened.calls.length, 1);
    const call = opened.calls[0];
    assertEquals(call.comparison.result, "content_changed");
    assertEquals(call.comparison.before_version, VER_1);
    assertEquals(call.comparison.after_version, VER_2);
    assertEquals(call.comparison.source_seq, "7");
    assertEquals(call.base, "1");
    assertEquals(opened.cursor(), "7");
    // format만 바뀌어 내용 hash가 같은 저장은 제출하지 않고 cursor만 진행한다.
    await opened.apply("9", [{ section: null }], {
      before: H("1"),
      after: H("1"),
    });
    assertEquals(opened.calls.length, 1);
    assertEquals(opened.cursor(), "9");
  } finally {
    opened.close();
  }
});

Deno.test("documents/contexts#R10: section watch는 같은 key의 본문 변화와 소실을 확인하고 제목만 바뀐 같은 본문은 제출하지 않는다", async () => {
  const opened = open(accepted);
  try {
    opened.extract(
      ready(VER_1, [section("위험", H("1")), section("요약", H("3"), 1)]),
    );
    opened.extract(ready(VER_2, [section("요약", H("3"), 0)]));
    await opened.apply("7", [{ section: "위험" }, { section: "요약" }]);
    // 위험은 소실, 요약은 같은 본문이라 제출하지 않는다.
    assertEquals(
      opened.calls.map((call) => [
        call.comparison.target.kind === "document"
          ? call.comparison.target.section
          : null,
        call.comparison.result,
      ]),
      [["위험", "section_missing"]],
    );
    assertEquals(opened.calls[0].comparison.after_hash, null);
    assertEquals(opened.calls[0].comparison.before_hash, H("1"));
    assertEquals(opened.cursor(), "7");
    assertEquals(listWatchUnverified(opened.store.read), []);
  } finally {
    opened.close();
  }
});

Deno.test("documents/contexts#R9: key가 사라지면 소실로 남기고 같은 본문의 비슷한 key로 대신하지 않는다", async () => {
  const opened = open(accepted);
  try {
    opened.extract(ready(VER_1, [section("위험", H("1"))]));
    // 이름을 바꿔 같은 본문이 새 key로 옮겨 갔다.
    opened.extract(ready(VER_2, [section("리스크", H("1"))]));
    await opened.apply("7", [{ section: "위험" }]);
    assertEquals(opened.calls.length, 1);
    assertEquals(opened.calls[0].comparison.result, "section_missing");
    assertEquals(opened.calls[0].comparison.target, {
      kind: "document",
      document: DOC,
      section: "위험",
    });
  } finally {
    opened.close();
  }
});

Deno.test("documents/contexts#R11: 추출 미완료는 미확인으로 남기고 cursor를 진행한 뒤 추출이 끝나면 다시 확인해 지운다", async () => {
  const opened = open(accepted);
  try {
    opened.extract(ready(VER_1, [section("위험", H("1"))]));
    // 새 판은 아직 추출되지 않았다.
    await opened.apply("7", [{ section: "위험" }]);
    assertEquals(opened.calls.length, 0);
    assertEquals(opened.cursor(), "7");
    const rows = listWatchUnverified(opened.store.read);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].reason, "after version: extraction pending");
    // 아직 풀리지 않았으니 다시 확인할 것이 없다.
    const none = await opened.call(WATCH_OPS.pending, {});
    assertEquals(none.ok && none.payload, { source_seqs: [] });
    // 추출이 끝나면 같은 저장 event를 다시 확인한다.
    opened.extract(ready(VER_2, [section("위험", H("2"))]));
    const again = await opened.call(WATCH_OPS.pending, {});
    assertEquals(again.ok && again.payload, { source_seqs: ["7"] });
    await opened.apply("7", [{ section: "위험" }]);
    assertEquals(opened.calls.length, 1);
    assertEquals(opened.calls[0].comparison.result, "content_changed");
    assertEquals(listWatchUnverified(opened.store.read), []);
    assertEquals(opened.cursor(), "7");
  } finally {
    opened.close();
  }
});

Deno.test("documents/contexts#R11: extractor 실패와 비교할 수 없는 module 변경은 소실로 단정하지 않고 이유와 함께 미확인으로 남는다", async () => {
  const opened = open(accepted);
  try {
    opened.extract(ready(VER_1, [section("위험", H("1"))]));
    opened.extract(failed(VER_2));
    await opened.apply("7", [{ section: "위험" }]);
    assertEquals(opened.calls.length, 0);
    assertEquals(
      listWatchUnverified(opened.store.read)[0].reason,
      "after version: extraction crashed",
    );
    // 이유가 그대로인 실패는 다시 확인 목록에 오르지 않는다.
    const stuck = await opened.call(WATCH_OPS.pending, {});
    assertEquals(stuck.ok && stuck.payload, { source_seqs: [] });
    // module이 달라진 두 판은 비교 규약을 모른다.
    opened.extract(ready(VER_2, [], OTHER_MODULE));
    await opened.apply("7", [{ section: "위험" }]);
    assertEquals(opened.calls.length, 0);
    assertEquals(
      listWatchUnverified(opened.store.read)[0].reason,
      "format module changed",
    );
  } finally {
    opened.close();
  }
});

Deno.test("documents/contexts#R12: 제출하지 못하면 cursor를 진행하지 않고 같은 결과를 다시 받아도 같은 제출이다", async () => {
  let reachable = false;
  const opened = open(() =>
    Promise.resolve(
      reachable
        ? ok({})
        : err({ code: "unavailable" as const, message: "core is down" }),
    )
  );
  try {
    const down = await opened.apply("7", [{ section: null }]);
    assertEquals(down.ok, false);
    assertEquals(opened.cursor(), "0");
    reachable = true;
    const up = await opened.apply("7", [{ section: null }]);
    assertEquals(up.ok, true);
    assertEquals(opened.cursor(), "7");
    // 재전달은 command의 중복키가 한 번만 기록한다. 같은 비교를 보낸다.
    await opened.apply("7", [{ section: null }]);
    assertEquals(opened.calls.length, 3);
    assertEquals(opened.calls[1].comparison, opened.calls[2].comparison);
    // cursor는 뒤로 가지 않는다.
    await opened.apply("5", []);
    assertEquals(opened.cursor(), "7");
  } finally {
    opened.close();
  }
});

Deno.test("documents/contexts#R12: 구성이 바뀌어 거절된 결과는 다시 받아 다시 계산하고 계속 부딪치면 미확인으로 남겨 뒤를 막지 않는다", async () => {
  let code: "conflict" | "not_found" = "conflict";
  const opened = open(() => Promise.resolve(err({ code, message: "stale" })));
  try {
    for (let attempt = 1; attempt < WATCH_CONFLICT_ATTEMPTS; attempt++) {
      const answered = await opened.apply("7", [{ section: null }]);
      assertEquals(answered.ok, false);
      assertEquals(opened.cursor(), "0");
    }
    const last = await opened.apply("7", [{ section: null }]);
    assertEquals(last.ok, true);
    assertEquals(opened.cursor(), "7");
    assertEquals(
      listWatchUnverified(opened.store.read)[0].reason,
      WATCH_CONFLICT_REASON,
    );
    // context가 없어졌으면 기록하지 않고 지난다.
    code = "not_found";
    const gone = await opened.apply("8", [{ section: null }]);
    assertEquals(gone.ok, true);
    assertEquals(opened.cursor(), "8");
    assertEquals(listWatchUnverified(opened.store.read).length, 1);
  } finally {
    opened.close();
  }
});

Deno.test("documents/contexts#R12: 모양이 틀린 요청은 invalid_input이고 advance는 cursor만 앞으로 보낸다", async () => {
  const opened: Opened = open(accepted);
  try {
    const bad = await opened.call(WATCH_OPS.apply, { event: {} });
    assertEquals(bad.ok, false);
    assert(!bad.ok);
    assertEquals(bad.error.code, "invalid_input");
    const advanced = await opened.call(WATCH_OPS.advance, { to: "12" });
    assertEquals(advanced.ok && advanced.payload, { processed_seq: "12" });
    const cursor = await opened.call(WATCH_OPS.cursor, {});
    assertEquals(cursor.ok && cursor.payload, { processed_seq: "12" });
  } finally {
    opened.close();
  }
});
