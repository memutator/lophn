// documents/series#R1, #R11: 허용된 앱은 자기 앱 place에 가족을 등록하고 자기 출력을 멤버로 둔다.
// 다른 자리의 가족은 앱에게 없는 가족과 같다.
import { assert, assertEquals } from "@std/assert";
import { createVersionCommands } from "../versions/mod.ts";
import { createSeriesCommands } from "./commands.ts";
import { joinSeriesOnSave } from "./join.ts";
import { ids, keep, seriesFixture, userContext } from "./testing/mod.ts";

const series = createSeriesCommands();
const versions = createVersionCommands({ joinSeries: joinSeriesOnSave });
const HASH = "ab".repeat(32);
const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const OTHER_APP = "app_01arz3ndektsv4rrffq69g5faw";
const APP_PLACE = { kind: "app" as const, id: ids.app };
const PROJECT = { kind: "project" as const, id: ids.project };

type Fixture = ReturnType<typeof seriesFixture>;

function appContext(app = ids.app): ReturnType<typeof userContext> {
  return {
    ...userContext(`app:${app}`),
    principal: `app:${app}`,
    conditions: { app, release: REL },
  } as ReturnType<typeof userContext>;
}

function createInput(
  id: string,
  place: { kind: "project" | "app"; id: string },
  name: string,
) {
  return {
    id,
    place,
    name,
    title: "주간 보고",
    format: "document",
    order: { kind: "key", direction: "ascending" },
    next_rule: "{n+1}",
  };
}

function create(
  fixture: Fixture,
  id: string,
  place: { kind: "project" | "app"; id: string },
  name: string,
  ctx = appContext(),
) {
  return fixture.transaction((tx) =>
    series.create.handle(tx, ctx, createInput(id, place, name) as never, {})
  );
}

function appSave(fixture: Fixture, document: string, name = "weekly-1") {
  return fixture.transaction((tx) =>
    versions.save.handle(tx, appContext(), {
      document,
      base_version: null,
      files_hash: HASH,
      file_count: 1,
      primary_path: "a.md",
      content_hash: HASH,
      preparation_ref: "prep-1",
      idempotency_key: `save-${document}`,
      metadata: { title: "Notes", place: APP_PLACE, name },
      format: { name: "document", module_hash: HASH, explicit: false },
      validation: {
        input_hash: HASH,
        module_hash: HASH,
        status: "passed",
        error_count: 0,
        warning_count: 0,
        diagnostics: [],
      },
      source: { kind: "app", app: ids.app, release: REL },
      files: [],
    } as never, { base_version: null })
  );
}

function setDraft(
  fixture: Fixture,
  id: string,
  document: string,
  revision: string,
  ctx = userContext(),
) {
  return fixture.transaction((tx) =>
    series.setDraft.handle(tx, ctx, {
      series: id,
      draft: {
        document,
        key: "1",
        base_version: null,
        format: { name: "document", module_hash: HASH, explicit: false },
        content: null,
      },
    } as never, { base_revision: revision })
  );
}

function members(fixture: Fixture, id: string) {
  return fixture.sql.all(
    "SELECT document, key FROM series_instances WHERE series = ?",
    [id],
  ).map((row) => `${row["document"]}:${row["key"]}`);
}

Deno.test("documents/series#R1: 앱은 자기 앱 place에만 가족을 등록하고 다른 자리는 forbidden이다", () => {
  const fixture = seriesFixture();
  try {
    const own = keep(create(fixture, ids.series, APP_PLACE, "weekly"));
    assertEquals(own.place, APP_PLACE);
    const places = [
      PROJECT,
      { kind: "app" as const, id: OTHER_APP },
    ];
    for (const [index, place] of places.entries()) {
      const rejected = create(
        fixture,
        `ser_01arz3ndektsv4rrffq69g5f${index}0`,
        place,
        `elsewhere-${index}`,
      );
      assert(!rejected.ok, JSON.stringify(place));
      assertEquals(rejected.error.code, "forbidden", JSON.stringify(place));
    }
    assertEquals(
      fixture.sql.get("SELECT COUNT(*) AS count FROM series", [])?.["count"],
      1,
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R1: 앱은 자기 앱 place의 가족에 멤버를 넣고 다른 자리의 가족은 없는 가족과 같다", () => {
  const fixture = seriesFixture();
  try {
    fixture.seedDocument(ids.doc, {
      kind: "app",
      id: ids.app,
      name: "weekly-1",
    });
    const own = keep(create(fixture, ids.series, APP_PLACE, "weekly"));
    const joined = keep(
      fixture.transaction((tx) =>
        series.addInstance.handle(
          tx,
          appContext(),
          { series: ids.series, document: ids.doc, key: "1" } as never,
          { base_revision: own.revision },
        )
      ),
    );
    assertEquals(members(fixture, ids.series), [`${ids.doc}:1`]);
    // 사람이 project에 만든 가족을 앱이 바꾸려 하면 없는 가족과 같은 not_found다.
    const project = keep(create(
      fixture,
      ids.series2,
      PROJECT,
      "project-weekly",
      userContext(),
    ));
    const attempt = (series_id: string, base: string) =>
      fixture.transaction((tx) =>
        series.addInstance.handle(
          tx,
          appContext(),
          { series: series_id, document: ids.doc, key: "9" } as never,
          { base_revision: base },
        )
      );
    const foreign = attempt(ids.series2, project.revision);
    const absent = attempt("ser_01arz3ndektsv4rrffq69g5fb9", project.revision);
    assert(!foreign.ok);
    assert(!absent.ok);
    assertEquals(foreign.error, absent.error);
    assertEquals(foreign.error.code, "not_found");
    assertEquals(members(fixture, ids.series2), []);
    assertEquals(joined.id, ids.series);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R11: 앱의 첫 저장은 자기 앱 place의 draft 가족에 같은 transaction으로 가입한다", () => {
  const fixture = seriesFixture();
  try {
    const created = keep(create(fixture, ids.series, APP_PLACE, "weekly"));
    // draft는 사람이 건다. 앱은 자기 출력을 저장하고 가입은 같은 transaction이 한다.
    keep(setDraft(fixture, ids.series, ids.doc, created.revision));
    keep(appSave(fixture, ids.doc));
    assertEquals(members(fixture, ids.series), [`${ids.doc}:1`]);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R11: 다른 자리의 draft 가족은 앱의 저장에 가입하지 않고 저장도 막지 않는다", () => {
  const fixture = seriesFixture();
  try {
    // 사람이 project 가족에 건 draft가 앱 출력 문서 id를 가리킨다.
    const created = keep(
      create(fixture, ids.series2, PROJECT, "project-weekly", userContext()),
    );
    keep(setDraft(fixture, ids.series2, ids.doc, created.revision));
    const saved = keep(appSave(fixture, ids.doc));
    assertEquals(saved.status, "saved");
    assertEquals(members(fixture, ids.series2), []);
  } finally {
    fixture.close();
  }
});
