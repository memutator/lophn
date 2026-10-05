import { assert, assertEquals } from "@std/assert";
import {
  compareSeriesKeys,
  documentNameForKey,
  draftKeyConflicts,
  orderMembers,
  suggestNextKey,
} from "./model.ts";
import type { SeriesInstance } from "../../contracts/documents/mod.ts";

function instance(
  document: string,
  key: string,
  order_value: string | number | null = null,
): SeriesInstance {
  return {
    series: "ser_01arz3ndektsv4rrffq69g5fav",
    document,
    key,
    order_value,
    order_version: order_value === null
      ? null
      : "ver_01arz3ndektsv4rrffq69g5fav",
    revision: "1",
  };
}

Deno.test("documents/series#R5: key 자연 순은 0.9 다음 0.10으로, 숫자 성분은 수로 비교한다", () => {
  assert(compareSeriesKeys("0.9", "0.10") < 0);
  assert(compareSeriesKeys("0.10", "0.9") > 0);
  assert(compareSeriesKeys("0.2.1", "0.2.2") < 0);
  assert(compareSeriesKeys("v2", "v10") < 0);
  assert(compareSeriesKeys("P002", "P002") === 0);
  // 다른 접두사는 codepoint 순이다.
  assert(compareSeriesKeys("a-1", "b-1") < 0);
  // 비숫자 key는 숫자 key 뒤다.
  assert(compareSeriesKeys("1", "alpha") < 0);
});

Deno.test("documents/series#R2: key와 문서 address 이름은 별개 값이다", () => {
  // 닷 key "0.3"의 이름 제안은 없다(0-3은 다른 값).
  assertEquals(documentNameForKey("0.3"), null);
  assertEquals(documentNameForKey("Week-01"), "week-01");
  assertEquals(documentNameForKey("2026-09-28"), null);
});

Deno.test("documents/series#R7: 다음 key 제안은 rule 자리표를 바꾼다", () => {
  assertEquals(suggestNextKey("{n+1:03}", "P001"), "P002");
  assertEquals(suggestNextKey("{minor}", "0.2"), "0.3");
  assertEquals(suggestNextKey("{major}", "0.2"), "1.0");
  assertEquals(suggestNextKey("{patch}", "0.2.1"), "0.2.2");
  assertEquals(suggestNextKey("v{n+1}", "v1"), "v2");
  // 해석 불가 key·멤버 없음은 빈 제안이다.
  assertEquals(suggestNextKey("{n}", null), "");
  assertEquals(suggestNextKey("{n+1:000005}", "1"), "");
});

Deno.test("documents/series#R5: format_field 정렬은 같은 타입 order_value로, key는 tiebreak다", () => {
  const numberOrder = {
    kind: "format_field" as const,
    field: "week",
    type: "number" as const,
    direction: "ascending" as const,
  };
  const members = [
    instance("doc_01arz3ndektsv4rrffq69g5fav", "w-3", 3),
    instance("doc_01arz3ndektsv4rrffq69g5faw", "w-10", 10),
    instance("doc_01arz3ndektsv4rrffq69g5fb0", "w-2", 2),
  ];
  const asc = orderMembers(numberOrder, members);
  assertEquals(asc.map((entry) => entry.key), ["w-2", "w-3", "w-10"]);
  // descending은 최종 순서를 뒤집는다.
  const desc = orderMembers(
    { ...numberOrder, direction: "descending" },
    members,
  );
  assertEquals(desc.map((entry) => entry.key), ["w-10", "w-3", "w-2"]);
  // string 타입은 codepoint 순이다.
  const stringOrder = {
    kind: "format_field" as const,
    field: "title",
    type: "string" as const,
    direction: "ascending" as const,
  };
  const texted = [
    instance("doc_01arz3ndektsv4rrffq69g5fav", "k1", "b"),
    instance("doc_01arz3ndektsv4rrffq69g5faw", "k2", "a"),
    instance("doc_01arz3ndektsv4rrffq69g5fb0", "k3", "c"),
  ];
  assertEquals(
    orderMembers(stringOrder, texted).map((entry) => entry.key),
    ["k2", "k1", "k3"],
  );
  // 동점은 key 자연 순으로 결정한다.
  const tied = [
    instance("doc_01arz3ndektsv4rrffq69g5fav", "t-9", 1),
    instance("doc_01arz3ndektsv4rrffq69g5faw", "t-10", 1),
  ];
  assertEquals(
    orderMembers(numberOrder, tied).map((entry) => entry.key),
    ["t-9", "t-10"],
  );
  // key 가지는 key 자연 순이다.
  const keyOrder = {
    kind: "key" as const,
    direction: "ascending" as const,
  };
  const keyed = [
    instance("doc_01arz3ndektsv4rrffq69g5fav", "0.10"),
    instance("doc_01arz3ndektsv4rrffq69g5faw", "0.9"),
  ];
  assertEquals(
    orderMembers(keyOrder, keyed).map((entry) => entry.key),
    ["0.9", "0.10"],
  );
});
