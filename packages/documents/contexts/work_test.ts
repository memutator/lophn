// documents/contexts#R9·R10·R11·R12·R13: watch 계산(순수). source_seq 당시 구성의 재생과 전후
// 고정 판의 비교다. 파일·DB를 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import {
  compareWatchedItem,
  type ContextConfigEvent,
  pendingWatches,
  replayContexts,
  UNVERIFIED_MODULE_CHANGED,
  UNVERIFIED_PENDING,
  type WatchSectionState,
  type WatchVersion,
} from "./work.ts";

const CTX = "ctx_01arz3ndektsv4rrffq69g5fav";
const CTX_2 = "ctx_01arz3ndektsv4rrffq69g5faw";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const OTHER_DOC = "doc_01arz3ndektsv4rrffq69g5fb0";
const APP = "app_01arz3ndektsv4rrffq69g5fav";
const VER_1 = "ver_01arz3ndektsv4rrffq69g5fav";
const VER_2 = "ver_01arz3ndektsv4rrffq69g5fb0";
const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);

type Target =
  | { kind: "document"; document: string; section: string | null }
  | { kind: "app_command"; app: string; command: string };
type Perspective = "basis" | "reference" | "watch";

function doc(section: string | null, document = DOC): Target {
  return { kind: "document", document, section };
}

function watchItem(target: Target, perspective: Perspective = "watch") {
  return { target, perspective, reason: "변화 확인" };
}

function event(
  seq: number,
  type: string,
  subject: string,
  payload: unknown,
): ContextConfigEvent {
  return { seq: String(seq), type, subject, payload };
}

function created(
  seq: number,
  items: ReturnType<typeof watchItem>[],
  context = CTX,
) {
  return event(seq, "ContextCreated", context, {
    title: "Notes",
    purpose: "목적",
    items,
  });
}

function itemSet(
  seq: number,
  item: ReturnType<typeof watchItem>,
  context = CTX,
) {
  return event(seq, "ContextItemSet", context, {
    target: item.target,
    before_item: null,
    item,
    before_position: null,
    position: 0,
    before_revision: "1",
  });
}

function removed(
  seq: number,
  item: ReturnType<typeof watchItem>,
  context = CTX,
) {
  return event(seq, "ContextItemRemoved", context, {
    target: item.target,
    before_item: item,
    before_position: 0,
    before_revision: "1",
  });
}

function archived(seq: number, context = CTX) {
  return event(seq, "ContextArchived", context, { before_revision: "1" });
}

function unarchived(seq: number, context = CTX) {
  return event(seq, "ContextUnarchived", context, { before_revision: "1" });
}

function updated(seq: number, context = CTX) {
  return event(seq, "ContextUpdated", context, {
    before: { title: "Notes" },
    after: { title: "Renamed" },
    before_revision: "1",
  });
}

function pending(
  events: ContextConfigEvent[],
  sourceSeq: number,
  document = DOC,
) {
  const result = pendingWatches(events, document, String(sourceSeq));
  assert(result.ok, result.ok ? "" : result.error.message);
  return result.value.map((watch) => ({
    context: watch.context,
    section: watch.target.section,
    revision: watch.context_revision,
  }));
}

const before: WatchVersion = {
  version: VER_1,
  content_hash: A,
  module_hash: C,
};
const after: WatchVersion = {
  version: VER_2,
  content_hash: B,
  module_hash: C,
};

function section(key: string, hash: string, module = C): WatchSectionState {
  return {
    kind: "ready",
    snapshot: {
      module_hash: module,
      sections: hash === ""
        ? []
        : [{ key, title: key, position: 0, body_hash: hash }],
    },
  };
}

function compare(
  sectionKey: string | null,
  states?: { before: WatchSectionState | null; after: WatchSectionState },
  versions: { before: WatchVersion | null; after: WatchVersion } = {
    before,
    after,
  },
) {
  return compareWatchedItem({
    context: CTX,
    context_revision: "1",
    target: { kind: "document", document: DOC, section: sectionKey },
    source_seq: "5",
    before: versions.before,
    after: versions.after,
    ...(states === undefined ? {} : { sections: states }),
  });
}

Deno.test("documents/contexts#R10: 문서 전체 watch는 content_hash가 다를 때만 내용 변화이고 format만 바뀐 저장은 같음이다", () => {
  const changed = compare(null);
  assertEquals(changed.result, "content_changed");
  assertEquals(changed.before_hash, A);
  assertEquals(changed.after_hash, B);
  assertEquals(changed.before_version, VER_1);
  assertEquals(changed.after_version, VER_2);
  // format module만 바뀌고 내용 hash가 같은 저장은 내용 변화가 아니다.
  const formatOnly = compare(null, undefined, {
    before,
    after: { version: VER_2, content_hash: A, module_hash: D },
  });
  assertEquals(formatOnly.result, "unchanged");
  assertEquals(formatOnly.module_hashes, { before: C, after: D });
});

Deno.test("documents/contexts#R10: section watch는 같은 key의 body_hash 변화·추가·소실을 확인하고 제목만 바뀐 같은 본문은 같음이다", () => {
  const modified = compare("요약", {
    before: section("요약", A),
    after: section("요약", B),
  });
  assertEquals(modified.result, "content_changed");
  assertEquals([modified.before_hash, modified.after_hash], [A, B]);
  const added = compare("요약", {
    before: section("요약", ""),
    after: section("요약", B),
  });
  assertEquals(added.result, "section_added");
  assertEquals([added.before_hash, added.after_hash], [null, B]);
  const missing = compare("요약", {
    before: section("요약", A),
    after: section("요약", ""),
  });
  assertEquals(missing.result, "section_missing");
  assertEquals([missing.before_hash, missing.after_hash], [A, null]);
  // 같은 key의 본문 hash가 같으면(제목만 바뀜) 내용 변화로 꾸미지 않는다.
  const retitled = compare("요약", {
    before: section("요약", A),
    after: {
      kind: "ready",
      snapshot: {
        module_hash: C,
        sections: [{
          key: "요약",
          title: "새 제목",
          position: 0,
          body_hash: A,
        }],
      },
    },
  });
  assertEquals(retitled.result, "unchanged");
  // 둘 다 없는 key도 바뀐 것이 없다.
  assertEquals(
    compare("없음", {
      before: section("없음", ""),
      after: section("없음", ""),
    }).result,
    "unchanged",
  );
});

Deno.test("documents/contexts#R9: section key가 사라지면 소실이고 비슷한 제목·같은 본문의 다른 key로 바꾸지 않는다", () => {
  // 이름을 바꿔 옛 key '요약'이 없고 같은 본문 hash의 새 key '개요'가 생겼다.
  const result = compare("요약", {
    before: section("요약", A),
    after: {
      kind: "ready",
      snapshot: {
        module_hash: C,
        sections: [{ key: "개요", title: "개요", position: 0, body_hash: A }],
      },
    },
  });
  // 항목은 '요약' 그대로이고 소실로 답한다. 대응 key를 꾸미지 않는다.
  assertEquals(result.result, "section_missing");
  assertEquals(result.target, {
    kind: "document",
    document: DOC,
    section: "요약",
  });
  assertEquals(result.after_hash, null);
});

Deno.test("documents/contexts#R11: 추출 미완료·실패·미지원이나 비교할 수 없는 module 변경은 소실이 아니라 미확인이다", () => {
  const pendingAfter = compare("요약", {
    before: section("요약", A),
    after: { kind: "unknown", reason: UNVERIFIED_PENDING },
  });
  assertEquals(pendingAfter.result, "unverified");
  assertEquals(
    pendingAfter.unverified_reason,
    `after version: ${UNVERIFIED_PENDING}`,
  );
  assertEquals([pendingAfter.before_hash, pendingAfter.after_hash], [
    null,
    null,
  ]);
  const failedBefore = compare("요약", {
    before: { kind: "unknown", reason: "extraction failed" },
    after: section("요약", ""),
  });
  assertEquals(failedBefore.result, "unverified");
  assertEquals(
    failedBefore.unverified_reason,
    "before version: extraction failed",
  );
  // 앞 판의 상태를 아직 받지 못했다.
  const noBefore = compare("요약", { before: null, after: section("요약", B) });
  assertEquals(noBefore.result, "unverified");
  assertEquals(noBefore.unverified_reason, UNVERIFIED_PENDING);
  // module이 다른 두 판은 같은 key 규약을 보장하지 못한다: 소실로 단정하지 않는다.
  const moduleChanged = compare("요약", {
    before: section("요약", A, C),
    after: section("요약", "", D),
  });
  assertEquals(moduleChanged.result, "unverified");
  assertEquals(moduleChanged.unverified_reason, UNVERIFIED_MODULE_CHANGED);
  // section 상태가 아예 없으면 미확인이다.
  assertEquals(compare("요약").result, "unverified");
});

Deno.test("documents/contexts#R12: 저장 당시 watch였고 그 뒤 바뀌지 않은 항목만 대상이다", () => {
  const target = doc("요약");
  const events = [created(1, [watchItem(target)]), updated(3)];
  // 제목 변경은 항목을 건드리지 않는다. revision은 지금 구성의 것이다.
  assertEquals(pending(events, 2), [
    { context: CTX, section: "요약", revision: "3" },
  ]);
  // 저장 뒤에 추가한 항목은 과거 변화의 대상이 아니다.
  assertEquals(pending([created(1, []), itemSet(4, watchItem(target))], 2), []);
  // context를 저장 뒤에 만들었다면 과거부터 있던 항목이 아니다.
  assertEquals(pending([created(4, [watchItem(target)])], 2), []);
});

Deno.test("documents/contexts#R12: 저장 뒤 관점을 바꾸거나 항목을 제거·재추가하거나 보관한 항목의 결과는 대상이 아니다", () => {
  const target = doc("요약");
  const item = watchItem(target);
  const base = [created(1, [item])];
  assertEquals(pending(base, 2).length, 1);
  // 관점 변경.
  assertEquals(
    pending([...base, itemSet(3, watchItem(target, "basis"))], 2),
    [],
  );
  // 제거 뒤 같은 항목을 다시 추가해도 과거부터 있던 항목이 아니다.
  assertEquals(
    pending([...base, removed(3, item), itemSet(4, item)], 2),
    [],
  );
  // 보관하면 멈추고, 보관 해제 뒤에도 보관 이전의 계산은 적용하지 않는다.
  assertEquals(pending([...base, archived(3)], 2), []);
  assertEquals(pending([...base, archived(3), unarchived(4)], 2), []);
  // 저장 당시 이미 보관 중이던 context도 대상이 아니다.
  assertEquals(pending([...base, archived(2)], 3), []);
  // 다른 항목의 변경은 이 항목에 영향이 없다.
  assertEquals(
    pending([...base, itemSet(3, watchItem(doc("위험")))], 2).length,
    1,
  );
});

Deno.test("documents/contexts#R12: 같은 문서의 항목은 context마다 따로 가리고 다른 문서는 포함하지 않는다", () => {
  const events = [
    created(1, [watchItem(doc(null)), watchItem(doc("요약"))]),
    created(2, [watchItem(doc(null), "basis")], CTX_2),
    created(
      3,
      [watchItem(doc(null, OTHER_DOC))],
      "ctx_01arz3ndektsv4rrffq69g5fb1",
    ),
  ];
  assertEquals(pending(events, 5), [
    { context: CTX, section: null, revision: "1" },
    { context: CTX, section: "요약", revision: "1" },
  ]);
  assertEquals(pending(events, 5, OTHER_DOC).length, 1);
});

Deno.test("documents/contexts#R13: 앱 read command 항목의 watch는 대상을 만들지 않는다", () => {
  const app: Target = { kind: "app_command", app: APP, command: "read_notes" };
  assertEquals(pending([created(1, [watchItem(app)])], 2), []);
  // 문서 항목과 섞여 있어도 앱 항목은 건드리지 않는다.
  assertEquals(
    pending([created(1, [watchItem(app), watchItem(doc(null))])], 2).length,
    1,
  );
});

Deno.test("documents/contexts#R12: 재생할 수 없는 구성은 대상이 있다고 꾸미지 않고 오류로 답한다", () => {
  // blob 참조로만 남은 구성, 모르는 context의 변경.
  const blob = replayContexts([
    event(1, "ContextCreated", CTX, { hash: A, size_bytes: 10 }),
  ]);
  assert(!blob.ok);
  const unknown = replayContexts([archived(2)]);
  assert(!unknown.ok);
  assertEquals(unknown.error.code, "internal");
});
