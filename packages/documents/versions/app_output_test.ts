// documents/versions#R14: 앱이 남긴 결과는 자기 앱 place의 고정 문서 version이다.
// 앱 자격은 자기 앱 place에만 쓰고 다른 자리의 기존 문서는 없는 문서와 같은 답이다.
import { assert, assertEquals } from "@std/assert";
import { createVersionCommands } from "./commands.ts";
import { authorizeDocument } from "./authorization.ts";
import {
  file,
  ids,
  keep,
  preparedInput,
  userContext,
  versionFixture,
} from "./testing/mod.ts";

const commands = createVersionCommands();
const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const OTHER_REL = "rel_01arz3ndektsv4rrffq69g5faw";
const OTHER_APP = "app_01arz3ndektsv4rrffq69g5faw";
const APP_PLACE = { kind: "app" as const, id: ids.app };
const SOURCE = { kind: "app" as const, app: ids.app, release: REL };

function appContext(app = ids.app, release = REL) {
  return {
    ...userContext(`app:${app}`),
    principal: `app:${app}`,
    conditions: { app, release },
  };
}

type Fixture = ReturnType<typeof versionFixture>;

function save(
  fixture: Fixture,
  input: ReturnType<typeof preparedInput>,
  ctx = appContext(),
) {
  return fixture.transaction((tx) =>
    commands.save.handle(tx, ctx, input as never, {
      base_version: input.base_version,
    })
  );
}

// 앱 출력의 첫 저장 입력. 자리와 출력 이름을 갖춘 새 문서다.
function first(
  document = ids.doc,
  place: unknown = APP_PLACE,
  name: string | null = "weekly-report",
  extra: Record<string, unknown> = {},
) {
  return preparedInput(document, [file("report.md", true)], {
    metadata: { title: "주간 보고", place, name },
    source: SOURCE,
    ...extra,
  });
}

Deno.test("documents/versions#R14: 앱의 첫 저장은 자기 앱 place에 이름을 가진 문서와 app source 판을 만든다", () => {
  const fixture = versionFixture();
  try {
    const saved = keep(save(fixture, first()));
    assertEquals(saved.status, "saved");
    const document = fixture.sql.get(
      "SELECT place_kind, place_id, name, title FROM documents WHERE id = ?",
      [ids.doc],
    );
    assertEquals(document?.["place_kind"], "app");
    assertEquals(document?.["place_id"], ids.app);
    assertEquals(document?.["name"], "weekly-report");
    const version = fixture.sql.get(
      "SELECT saved_by, source FROM versions WHERE id = ?",
      [saved.version],
    );
    assertEquals(version?.["saved_by"], `app:${ids.app}`);
    assertEquals(JSON.parse(String(version?.["source"])), SOURCE);
    // 문서 이름 예약이 같은 transaction에 선다. 앱 place와 이름으로 같은 문서를 이어 찾는다.
    const reserved = fixture.sql.get(
      "SELECT document FROM document_names WHERE place_kind = 'app' AND place_id = ? AND name = ?",
      [ids.app, "weekly-report"],
    );
    assertEquals(reserved?.["document"], ids.doc);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: 앱이 같은 문서를 다시 저장하면 같은 Document의 새 판이고 옛 판은 그대로다", () => {
  const fixture = versionFixture();
  try {
    const one = keep(save(fixture, first()));
    const next = preparedInput(ids.doc, [file("report.md", true)], {
      base_version: one.version,
      content_hash: "cd".repeat(32),
      metadata: undefined,
      source: SOURCE,
      idempotency_key: "save-2",
    });
    const two = keep(save(fixture, next));
    assertEquals(two.status, "saved");
    assertEquals(two.document, one.document);
    assert(two.version !== one.version);
    const numbers = fixture.sql.all(
      "SELECT number FROM versions WHERE document = ? ORDER BY number",
      [ids.doc],
    );
    assertEquals(numbers.map((row) => row["number"]), [1, 2]);
    // 기준 판이 낡으면 새 판을 쓰지 않는다.
    const stale = save(fixture, { ...next, idempotency_key: "save-3" });
    assert(!stale.ok);
    assertEquals(stale.error.code, "conflict");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: 앱은 다른 앱 place·project·자리 없음에 새 문서를 만들지 못한다", () => {
  const fixture = versionFixture();
  try {
    const places = [
      { kind: "app", id: OTHER_APP },
      { kind: "project", id: ids.project },
      null,
    ];
    for (const place of places) {
      const rejected = save(fixture, first(ids.doc, place));
      assert(!rejected.ok, JSON.stringify(place));
      assertEquals(rejected.error.code, "forbidden", JSON.stringify(place));
    }
    const count = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM documents",
      [],
    );
    assertEquals(count?.["count"], 0);
    assertEquals(fixture.emitted.length, 0);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: 출력 이름 없는 앱 문서는 거절한다", () => {
  const fixture = versionFixture();
  try {
    const rejected = save(fixture, first(ids.doc, APP_PLACE, null));
    assert(!rejected.ok);
    assertEquals(rejected.error.code, "invalid_input");
    assertEquals(fixture.emitted.length, 0);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: 앱이 다른 place의 기존 문서에 판을 더하려 하면 없는 문서와 같은 답이다", () => {
  const fixture = versionFixture();
  try {
    // 사람이 project에 만든 문서와 다른 앱의 출력 문서.
    const mine = keep(save(fixture, first(ids.doc), appContext(ids.app)));
    fixture.apps.set(OTHER_APP, {
      id: OTHER_APP,
      slug: "other-app",
      status: "active",
    });
    const theirs = keep(save(
      fixture,
      first(ids.other, { kind: "app", id: OTHER_APP }, "theirs", {
        source: { kind: "app", app: OTHER_APP, release: OTHER_REL },
      }),
      appContext(OTHER_APP, OTHER_REL),
    ));
    const events = fixture.emitted.length;
    // 앱 A가 앱 B의 문서에 새 판을 더하려 한다.
    const attempt = preparedInput(ids.other, [file("report.md", true)], {
      base_version: theirs.version,
      content_hash: "cd".repeat(32),
      metadata: undefined,
      source: SOURCE,
      idempotency_key: "intrude",
    });
    const denied = save(fixture, attempt, appContext(ids.app));
    // 같은 입력을 없는 문서 id로 보낸 답과 code·message가 같다.
    const absent = save(
      fixture,
      { ...attempt, document: "doc_01arz3ndektsv4rrffq69g5fb0" },
      appContext(ids.app),
    );
    assert(!denied.ok);
    assert(!absent.ok);
    assertEquals(denied.error, absent.error);
    // 새 문서 입력으로 B의 문서 id를 쓰는 시도도 거절이다.
    const created = save(
      fixture,
      first(ids.other, APP_PLACE, "stolen"),
      appContext(ids.app),
    );
    assert(!created.ok);
    assertEquals(created.error.code, "forbidden");
    assertEquals(fixture.emitted.length, events);
    assertEquals(
      fixture.sql.get(
        "SELECT COUNT(*) AS count FROM versions WHERE document = ?",
        [
          ids.other,
        ],
      )?.["count"],
      1,
    );
    assertEquals(mine.document, ids.doc);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: 앱 자격의 저장은 없거나 보관된 앱에서는 forbidden이다", () => {
  const fixture = versionFixture();
  try {
    const one = keep(save(fixture, first()));
    fixture.apps.set(ids.app, {
      id: ids.app,
      slug: "report-app",
      status: "archived",
    });
    const next = preparedInput(ids.doc, [file("report.md", true)], {
      base_version: one.version,
      content_hash: "cd".repeat(32),
      metadata: undefined,
      source: SOURCE,
      idempotency_key: "save-2",
    });
    const archived = save(fixture, next);
    assert(!archived.ok);
    assertEquals(archived.error.code, "forbidden");
    fixture.apps.delete(ids.app);
    const missing = save(fixture, { ...next, idempotency_key: "save-3" });
    assert(!missing.ok);
    assertEquals(missing.error.code, "forbidden");
    assertEquals(
      fixture.sql.get("SELECT COUNT(*) AS count FROM versions", [])?.["count"],
      1,
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: 판의 출처 release는 자격이 고정한 release와 앱 이름이 같아야 한다", () => {
  const fixture = versionFixture();
  try {
    const otherRelease = save(
      fixture,
      first(ids.doc, APP_PLACE, "weekly-report", {
        source: { kind: "app", app: ids.app, release: OTHER_REL },
      }),
    );
    assert(!otherRelease.ok);
    assertEquals(otherRelease.error.code, "forbidden");
    const otherApp = save(
      fixture,
      first(ids.doc, APP_PLACE, "weekly-report", {
        source: { kind: "app", app: OTHER_APP, release: REL },
      }),
    );
    assert(!otherApp.ok);
    assertEquals(otherApp.error.code, "forbidden");
    // 출처 없는 앱 저장은 앱 출처가 필요하다.
    const sourceless = save(
      fixture,
      first(ids.doc, APP_PLACE, "weekly-report", { source: null }),
    );
    assert(!sourceless.ok);
    assertEquals(sourceless.error.code, "invalid_input");
    assertEquals(fixture.emitted.length, 0);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: 앱 자격의 문서 판정은 자기 앱 place만 통과시킨다", () => {
  const fixture = versionFixture();
  try {
    const port = <T>() => ((() => ({ ok: true, value: undefined })) as T);
    const ctx = appContext();
    const target = (place: unknown) => ({
      kind: "document" as const,
      document: {
        id: ids.doc,
        place,
        name: "x",
        title: "t",
        file_source: null,
        latest_version: "ver_x",
        revision: "1",
        status: "active",
      },
    });
    const own = authorizeDocument(
      port,
      ctx,
      "document.get",
      target(APP_PLACE) as never,
    );
    assert(own.ok);
    for (
      const place of [
        { kind: "app", id: OTHER_APP },
        { kind: "project", id: ids.project },
        null,
      ]
    ) {
      const denied = authorizeDocument(
        port,
        ctx,
        "document.get",
        target(place) as never,
      );
      assert(!denied.ok);
      assertEquals(denied.error.code, "not_found");
    }
    // 사람 자격은 이 경계의 대상이 아니다.
    const user = authorizeDocument(
      port,
      userContext(),
      "document.get",
      target({ kind: "project", id: ids.project }) as never,
    );
    assert(user.ok);
  } finally {
    fixture.close();
  }
});
