import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../base/mod.ts";
import { createVersionCommands } from "../versions/mod.ts";
import { createSeriesCommands } from "./commands.ts";
import { joinSeriesOnSave } from "./join.ts";
import { ids, keep, seriesFixture, userContext } from "./testing/mod.ts";

const series = createSeriesCommands();
const versions = createVersionCommands({ joinSeries: joinSeriesOnSave });
const HASH = "ab".repeat(32);
const PROJECT = { kind: "project" as const, id: ids.project };

function prepared(
  document: string,
  extra: Record<string, unknown> = {},
  format = "document",
) {
  return {
    document,
    base_version: null,
    files_hash: HASH,
    file_count: 1,
    primary_path: "a.md",
    content_hash: HASH,
    preparation_ref: "prep-1",
    idempotency_key: "save-1",
    metadata: {
      title: "Notes",
      place: PROJECT,
      name: "weekly-" + document.slice(-4),
    },
    format: { name: format, module_hash: HASH, explicit: false },
    validation: {
      input_hash: HASH,
      module_hash: HASH,
      status: "passed",
      error_count: 0,
      warning_count: 0,
      diagnostics: [],
    },
    source: null,
    files: [],
    ...extra,
  };
}

type Fixture = ReturnType<typeof seriesFixture>;

function save(
  fixture: Fixture,
  input: ReturnType<typeof prepared>,
  actor = userContext(),
) {
  return fixture.transaction((tx) =>
    versions.save.handle(tx, actor, input as never, {
      base_version: input.base_version,
    })
  );
}

// 가족을 만들고 document·key draft를 건다. 가족 revision을 돌려준다.
function familyWithDraft(
  fixture: Fixture,
  document: string,
  key: string,
  id = ids.series,
  name = "weekly",
) {
  const created = keep(
    fixture.transaction((tx) =>
      series.create.handle(tx, userContext(), {
        id,
        place: PROJECT,
        name,
        title: "주간 보고",
        format: "document",
        order: { kind: "key", direction: "ascending" },
        next_rule: "{n+1}",
      } as never, {})
    ),
  );
  return keep(
    fixture.transaction((tx) =>
      series.setDraft.handle(tx, userContext(), {
        series: id,
        draft: {
          document,
          key,
          base_version: null,
          format: { name: "document", module_hash: HASH, explicit: false },
          content: null,
        },
      } as never, { base_revision: created.revision })
    ),
  );
}

function members(fixture: Fixture, id = ids.series) {
  return fixture.sql.all(
    "SELECT document, key FROM series_instances WHERE series = ?",
    [id],
  ).map((row) => `${row["document"]}:${row["key"]}`);
}

function seriesEvents(fixture: Fixture) {
  return fixture.emitted.filter((event) => event.type.startsWith("Series"))
    .map((event) => event.type);
}

Deno.test("documents/series#R11: 첫 저장이 일치 draft 가족에 한 tx로 가입하고 draft를 비운다", () => {
  const fixture = seriesFixture();
  try {
    familyWithDraft(fixture, ids.doc, "2026-40");
    const result = keep(save(fixture, prepared(ids.doc)));
    assertEquals(result.status, "saved");
    assertEquals(members(fixture), [`${ids.doc}:2026-40`]);
    const row = keep(
      fixture.transaction((tx) => {
        const found = tx.sql.get(
          "SELECT draft FROM series WHERE id = ?",
          [ids.series],
        );
        return ok(found?.["draft"]);
      }),
    );
    assertEquals(row, null);
    // 저장 event 뒤에 draft 비움과 가입이 같은 tx에서 남는다.
    const types = fixture.emitted.map((event) => event.type);
    assertEquals(types.slice(-4), [
      "DocumentCreated",
      "DocumentSaved",
      "SeriesDraftCleared",
      "SeriesInstanceAdded",
    ]);
    // 가입 key 예약도 같이 남는다(series#R2).
    const keys = fixture.sql.all(
      "SELECT key FROM series_keys WHERE series = ?",
      [ids.series],
    );
    assertEquals(keys.length, 1);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R15: draft와 맞지 않는 저장은 가족에 가입하지 않는다", () => {
  const fixture = seriesFixture();
  try {
    familyWithDraft(fixture, ids.doc, "2026-40");
    const before = seriesEvents(fixture);
    keep(save(fixture, prepared(ids.doc2)));
    assertEquals(members(fixture), []);
    assertEquals(seriesEvents(fixture), before);
    // draft는 그대로 남아 있다.
    const row = fixture.sql.get("SELECT draft FROM series WHERE id = ?", [
      ids.series,
    ]);
    assert(row?.["draft"] !== null);
    // draft가 없는 가족만 있어도 같다.
    const bare = seriesFixture();
    try {
      keep(save(bare, prepared(ids.doc)));
      assertEquals(members(bare), []);
    } finally {
      bare.close();
    }
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R3: 가입 검사에 걸리면 저장 전체가 거절된다", () => {
  const fixture = seriesFixture();
  try {
    familyWithDraft(fixture, ids.doc, "2026-40");
    // 다른 format 저장은 가족 format과 달라 가입 검사에서 거절이다.
    const result = save(fixture, prepared(ids.doc, {}, "markdown"));
    assert(!result.ok);
    assertEquals(
      fixture.sql.get("SELECT COUNT(*) AS n FROM documents", [])?.["n"],
      0,
    );
    assertEquals(
      fixture.sql.get("SELECT COUNT(*) AS n FROM versions", [])?.["n"],
      0,
    );
    assertEquals(members(fixture), []);
    // 다른 자리의 저장도 거절이다.
    const elsewhere = save(
      fixture,
      prepared(ids.doc, {
        metadata: {
          title: "Notes",
          place: { kind: "app", id: ids.app },
          name: "weekly-x",
        },
      }),
    );
    assert(!elsewhere.ok);
    assertEquals(
      fixture.sql.get("SELECT COUNT(*) AS n FROM documents", [])?.["n"],
      0,
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R3: 멤버의 새 판 저장은 가입을 다시 하지 않고 멤버 수도 같다", () => {
  const fixture = seriesFixture();
  try {
    familyWithDraft(fixture, ids.doc, "2026-40");
    keep(save(fixture, prepared(ids.doc)));
    // 멤버의 새 판 저장은 멤버 수와 event를 늘리지 않는다(재저장 멱등).
    const first = fixture.sql.get(
      "SELECT latest_version FROM documents WHERE id = ?",
      [ids.doc],
    );
    const eventsBefore = seriesEvents(fixture);
    keep(save(
      fixture,
      prepared(ids.doc, {
        base_version: first?.["latest_version"],
        content_hash: "cd".repeat(32),
        metadata: undefined,
        idempotency_key: "save-2",
      }),
    ));
    assertEquals(members(fixture), [`${ids.doc}:2026-40`]);
    assertEquals(seriesEvents(fixture), eventsBefore);
    assertEquals(
      fixture.sql.get("SELECT COUNT(*) AS n FROM versions WHERE document = ?", [
        ids.doc,
      ])?.["n"],
      2,
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R9: 범위 밖 가족과 lophn agent 저장은 없는 가족과 같게 가입 없이 저장된다", () => {
  // 범위 밖 가족: 판정이 forbidden이면 없는 가족처럼 저장만 된다.
  const scoped = seriesFixture((_ctx, _operation, target) =>
    "series" in target
      ? err({ code: "forbidden", message: "out of scope" }) as Result<void>
      : ok(undefined)
  );
  const absent = seriesFixture();
  try {
    familyWithDraft(absent, ids.doc, "2026-40");
    // absent는 draft가 없는 쪽이 아니라 가족 자체가 없는 쪽이다.
    const nothing = seriesFixture();
    try {
      const plain = keep(save(nothing, prepared(ids.doc)));
      familyWithDraft(scoped, ids.doc, "2026-40");
      const hidden = keep(save(scoped, prepared(ids.doc)));
      assertEquals(hidden.status, plain.status);
      assertEquals(members(scoped), []);
      assertEquals(
        scoped.emitted.map((event) => event.type).slice(-2),
        nothing.emitted.map((event) => event.type).slice(-2),
      );
      // 가족 draft는 그대로다.
      const row = scoped.sql.get("SELECT draft FROM series WHERE id = ?", [
        ids.series,
      ]);
      assert(row?.["draft"] !== null);
    } finally {
      nothing.close();
    }
    // lophn agent의 저장도 가족 가입 통로가 없어 가입 없이 저장된다.
    const agent = userContext(
      "agent:asg_01arz3ndektsv4rrffq69g5fav",
      ids.run,
    );
    keep(save(absent, prepared(ids.doc), agent));
    assertEquals(members(absent), []);
  } finally {
    scoped.close();
    absent.close();
  }
});
