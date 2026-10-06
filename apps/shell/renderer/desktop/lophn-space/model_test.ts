import { assert, assertEquals, assertMatch } from "@std/assert";

import {
  conditionsOfView,
  coverageNotes,
  DEFAULT_SCREEN,
  documentNameForKey,
  EMPTY_CONDITIONS,
  emptyHint,
  LOPHN_SCREENS,
  newId,
  placeOf,
  placeValue,
  searchBody,
  validNextRule,
  validSeriesName,
  viewFilterOf,
} from "./model.ts";

Deno.test("shell/desktop#R28: lophn 공간은 projects, documents, contexts, apps, things-to-confirm, roles, settings 일곱 형제만 둔다", () => {
  assertEquals([...LOPHN_SCREENS], [
    "projects",
    "documents",
    "contexts",
    "apps",
    "things-to-confirm",
    "roles",
    "settings",
  ]);
});

Deno.test("shell/desktop#R1: lophn 공간에 들어오면 documents가 먼저다", () => {
  assertEquals(DEFAULT_SCREEN, "documents");
});

Deno.test("shell/desktop#R1: 검색 입력은 검색어와 고른 자리·focus·format만 보내고 빈 조건은 뺀다", () => {
  assertEquals(searchBody({ ...EMPTY_CONDITIONS, query: "  goals " }), {
    query: "goals",
  });
  assertEquals(
    searchBody({
      query: "goals",
      place: { kind: "app", id: "app_1" },
      context: "ctx_1",
      format: "document",
      includeArchived: true,
    }, "cur_2"),
    {
      query: "goals",
      place: { kind: "app", id: "app_1" },
      context: "ctx_1",
      formats: ["document"],
      cursor: "cur_2",
    },
  );
});

Deno.test("shell/desktop#R1: saved view 조건은 보관 포함을 all로 옮기고 열 때 같은 조건으로 되돌린다", () => {
  const conditions = {
    query: "plan",
    place: { kind: "project" as const, id: "prj_1" },
    context: null,
    format: "pdf",
    includeArchived: true,
  };
  const filter = viewFilterOf(conditions);
  assertEquals(filter, {
    text: "plan",
    context: null,
    format: "pdf",
    status: "all",
  });
  assertEquals(conditionsOfView(conditions.place, filter), conditions);
  assertEquals(viewFilterOf(EMPTY_CONDITIONS).status, "active");
  assertEquals(viewFilterOf(EMPTY_CONDITIONS).text, null);
});

Deno.test("shell/desktop#R1: 검색 지연·재생성·누락만 안내하고 빈 결과를 원본 부재로 말하지 않는다", () => {
  const clean = { lagging: false, rebuilding: false, omissions: 0 };
  assertEquals(coverageNotes(null), []);
  assertEquals(coverageNotes(clean), []);
  assertEquals(coverageNotes({ ...clean, lagging: true }), ["lagging"]);
  assertEquals(
    coverageNotes({ lagging: true, rebuilding: true, omissions: 2 }),
    ["rebuilding", "omissions"],
  );
  // 지연이 있으면 "아직 반영 전", 없으면 보관 포함을 권하고, 보관까지 봤으면 조건을 바꾸게 한다.
  assertEquals(emptyHint({ ...clean, lagging: true }, false), "not-yet");
  assertEquals(emptyHint(clean, false), "archived");
  assertEquals(emptyHint(clean, true), "conditions");
});

Deno.test("shell/desktop#R1: 다음 이름 규칙은 숫자 자리 하나와 4자리 이하 0 채움만 받는다", () => {
  assert(validNextRule("week-{n}"));
  assert(validNextRule("v{major}"));
  assert(validNextRule("r{patch+2:04}"));
  assert(!validNextRule("week-{n:5}"));
  assert(!validNextRule("week"));
  assert(!validNextRule("{n}-{n}"));
  assert(validSeriesName("weekly-report"));
  assert(!validSeriesName("Weekly"));
  assert(!validSeriesName("1-week"));
});

Deno.test("documents/series#R2: 새 멤버 문서 이름은 contracts의 key→이름 규칙과 같다", async () => {
  const url = new URL(
    "../../../../../packages/contracts/documents/series-values.ts",
    import.meta.url,
  );
  const contract = await import(url.href) as {
    documentNameForKey(key: string): string | null;
  };
  for (
    const key of [
      "P003",
      "week-3",
      " Week 3 ",
      "0.3",
      "v1.2.0",
      "보고",
      "a".repeat(70),
    ]
  ) {
    assertEquals(
      documentNameForKey(key),
      contract.documentNameForKey(key),
      key,
    );
  }
  assertEquals(documentNameForKey("P003"), "p003");
});

Deno.test("shell/desktop#R28: 자리 선택지 값은 project·app만 되돌린다", () => {
  const place = { kind: "project" as const, id: "prj_1" };
  assertEquals(placeOf(placeValue(place)), place);
  assertEquals(placeOf("any"), null);
  assertEquals(placeValue(null), "");
});

Deno.test("shell/desktop#R1: saved view·series id는 접두와 ULID 모양이다", () => {
  const id = newId("viw", 1_700_000_000_000, () => new Uint8Array(16));
  assertMatch(id, /^viw_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
  assertEquals(id.slice(-16), "0000000000000000");
});
