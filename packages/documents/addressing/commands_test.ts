import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { ok, type Result } from "../../base/mod.ts";
import {
  DOCUMENT_DISPATCHABLE_COMMANDS,
  type PlaceRef,
} from "../../contracts/documents/mod.ts";
import type { Sql } from "../../contracts/platform/mod.ts";
import {
  createDocumentNameReservation,
  createPlaceNameReservation,
  type PlaceNameReservation,
} from "./mod.ts";
import { reservationFixture } from "./testing-fixture.ts";

const project: PlaceRef = {
  kind: "project",
  id: "prj_01arz3ndektsv4rrffq69g5fav",
};
const app: PlaceRef = { kind: "app", id: "app_01arz3ndektsv4rrffq69g5fav" };
const otherProject: PlaceRef = {
  kind: "project",
  id: "prj_01arz3ndektsv4rrffq69g5faw",
};
const doc = "doc_01arz3ndektsv4rrffq69g5fav";
const otherDoc = "doc_01arz3ndektsv4rrffq69g5faw";

function errorCode(result: Result<unknown>, code: string) {
  assert(!result.ok);
  assertEquals(result.error.code, code);
}

Deno.test("documents/addressing#R2: project and app share global names and repeat reservation keeps first seq", () => {
  const fixture = reservationFixture();
  try {
    assertEquals(
      fixture.sql.get("PRAGMA journal_mode", [])?.journal_mode,
      "wal",
    );
    assert(
      fixture.transaction((tx) => {
        const names = createPlaceNameReservation(tx);
        assertEquals(names.get("missing"), ok(null));
        assert(names.reserve("mahas", project, "1").ok);
        assert(names.reserve("mahas", project, "2").ok);
        errorCode(names.reserve("mahas", app, "3"), "conflict");
        errorCode(names.reserve("mahas", otherProject, "3"), "conflict");
        assertEquals(
          names.get("mahas"),
          ok({
            slug: "mahas",
            kind: "project",
            target: project.id,
            reserved_seq: "1",
          }),
        );
        assert(names.reserve("new-place-name", project, "4").ok);
        errorCode(names.reserve("mahas", app, "5"), "conflict");
        assert(names.reserve("a".repeat(63), app, "9223372036854775807").ok);
        return ok(undefined);
      }).ok,
    );
    assertEquals(fixture.sql.all("SELECT * FROM place_names", []).length, 3);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R2: document names are place-local and old names cannot change target", () => {
  const fixture = reservationFixture();
  try {
    assert(
      fixture.transaction((tx) => {
        const names = createDocumentNameReservation(tx);
        assertEquals(names.get(project, "missing"), ok(null));
        assert(names.reserve(project, "report", doc, "1").ok);
        assert(names.reserve(project, "report", doc, "2").ok);
        errorCode(names.reserve(project, "report", otherDoc, "3"), "conflict");
        assert(names.reserve(app, "report", otherDoc, "3").ok);
        assert(names.reserve(otherProject, "report", otherDoc, "3").ok);
        assert(names.reserve(project, "renamed-report", doc, "4").ok);
        assert(names.reserve(app, "moved-report", doc, "5").ok);
        errorCode(names.reserve(project, "report", otherDoc, "6"), "conflict");
        assertEquals(
          names.get(project, "report"),
          ok({
            place_kind: "project",
            place_id: project.id,
            name: "report",
            document: doc,
            reserved_seq: "1",
          }),
        );
        return ok(undefined);
      }).ok,
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R2: reservations persist independently of archive state and owner tables", () => {
  const fixture = reservationFixture();
  try {
    assert(
      fixture.transaction((tx) => {
        assert(
          createPlaceNameReservation(tx).reserve("archived-place", project, "1")
            .ok,
        );
        return createDocumentNameReservation(tx).reserve(
          project,
          "archived-doc",
          doc,
          "1",
        );
      }).ok,
    );
    const tables = fixture.sql.all(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
      [],
    );
    assertEquals(tables.map((row) => row.name).sort(), [
      "document_names",
      "place_names",
    ]);
    // owner 보관 command는 T6/T7 범위다. 여기서는 owner 표 없이 예약을 재열고
    // 보관·place 해제 상태를 검사하거나 예약을 지우는 경로가 없음을 확인한다.
    const reopened = new DatabaseSync(fixture.path);
    try {
      assertEquals(
        reopened.prepare("SELECT target FROM place_names WHERE slug = ?")
          .get("archived-place")?.target,
        project.id,
      );
      assertEquals(
        reopened.prepare("SELECT document FROM document_names WHERE name = ?")
          .get("archived-doc")?.document,
        doc,
      );
    } finally {
      reopened.close();
    }
    fixture.transaction((tx) => {
      errorCode(
        createPlaceNameReservation(tx).reserve("archived-place", app, "2"),
        "conflict",
      );
      errorCode(
        createDocumentNameReservation(tx).reserve(
          project,
          "archived-doc",
          otherDoc,
          "2",
        ),
        "conflict",
      );
      return ok(undefined);
    });
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R2: current guarded Tx owns commit rollback and port lifetime", () => {
  const fixture = reservationFixture();
  try {
    let retained: PlaceNameReservation | undefined;
    const result = fixture.transaction((tx) => {
      retained = createPlaceNameReservation(tx);
      assert(retained.reserve("mahas", project, "1").ok);
      assert(
        createDocumentNameReservation(tx).reserve(project, "report", doc, "1")
          .ok,
      );
      return retained.reserve("mahas", app, "2");
    });
    errorCode(result, "conflict");
    assertEquals(fixture.sql.all("SELECT * FROM place_names", []), []);
    assertEquals(fixture.sql.all("SELECT * FROM document_names", []), []);
    assert(retained);
    assertThrows(() => retained!.get("mahas"), Error, "transaction is closed");
    assertThrows(
      () =>
        fixture.transaction((tx) => {
          assert(
            createPlaceNameReservation(tx).reserve("mahas", project, "1").ok,
          );
          throw new Error("later owner failure");
        }),
      Error,
      "later owner failure",
    );
    assertEquals(fixture.sql.all("SELECT * FROM place_names", []), []);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R2: SQL triggers reject update delete upsert and replace even without recursive triggers", () => {
  const fixture = reservationFixture();
  try {
    fixture.transaction((tx) => {
      assert(createPlaceNameReservation(tx).reserve("mahas", project, "1").ok);
      return createDocumentNameReservation(tx).reserve(
        project,
        "report",
        doc,
        "1",
      );
    });
    const statements = [
      "UPDATE place_names SET target = 'other'",
      "UPDATE place_names SET slug = 'changed'",
      "UPDATE place_names SET kind = 'app'",
      "UPDATE place_names SET reserved_seq = '2'",
      "UPDATE place_names SET reserved_seq = reserved_seq",
      "DELETE FROM place_names",
      "INSERT OR REPLACE INTO place_names VALUES ('mahas', 'app', 'other', '2')",
      "INSERT INTO place_names VALUES ('mahas', 'app', 'other', '2') ON CONFLICT(slug) DO UPDATE SET target = excluded.target",
      "UPDATE document_names SET document = 'other'",
      "UPDATE document_names SET place_kind = 'app'",
      "UPDATE document_names SET place_id = 'other'",
      "UPDATE document_names SET name = 'changed'",
      "UPDATE document_names SET reserved_seq = '2'",
      "DELETE FROM document_names",
      `INSERT OR REPLACE INTO document_names VALUES ('project', '${project.id}', 'report', '${otherDoc}', '2')`,
      `INSERT INTO document_names VALUES ('project', '${project.id}', 'report', '${otherDoc}', '2') ON CONFLICT(place_kind, place_id, name) DO UPDATE SET document = excluded.document`,
    ];
    for (const statement of statements) {
      assertThrows(() => fixture.db.exec(statement));
    }
    fixture.transaction((tx) => {
      assertEquals(
        createPlaceNameReservation(tx).get("mahas"),
        ok({
          slug: "mahas",
          kind: "project",
          target: project.id,
          reserved_seq: "1",
        }),
      );
      assertEquals(
        createDocumentNameReservation(tx).get(project, "report"),
        ok({
          place_kind: "project",
          place_id: project.id,
          name: "report",
          document: doc,
          reserved_seq: "1",
        }),
      );
      return ok(undefined);
    });
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R2: malformed inputs fail before SQL", () => {
  const fail = () => {
    throw new Error("unexpected SQL");
  };
  const tx = { sql: { run: fail, get: fail, all: fail } };
  const places = createPlaceNameReservation(tx);
  const documents = createDocumentNameReservation(tx);
  const invalidPlace = { kind: "project", id: app.id } as PlaceRef;
  const context = { kind: "context", id: "ctx" } as unknown as PlaceRef;
  for (
    const name of [
      "_inbox",
      "a b",
      "a/b",
      "a#b",
      "a@b",
      "a\u0000",
      "a".repeat(64),
    ]
  ) {
    errorCode(places.get(name), "invalid_input");
    errorCode(places.reserve(name, project, "1"), "invalid_input");
    errorCode(documents.get(project, name), "invalid_input");
    errorCode(documents.reserve(project, name, doc, "1"), "invalid_input");
  }
  for (const place of [invalidPlace, context, { ...project, context: "ctx" }]) {
    errorCode(places.reserve("valid", place, "1"), "invalid_input");
    errorCode(documents.get(place, "valid"), "invalid_input");
    errorCode(documents.reserve(place, "valid", doc, "1"), "invalid_input");
  }
  for (const seq of ["0", "01", "-1", "9223372036854775808"]) {
    errorCode(places.reserve("valid", project, seq), "invalid_input");
    errorCode(documents.reserve(project, "valid", doc, seq), "invalid_input");
  }
  errorCode(documents.reserve(project, "valid", app.id, "1"), "invalid_input");
});

Deno.test("documents/addressing#R2: invalid stored reservation rows are internal, not conflict or success", () => {
  const fixture = reservationFixture();
  try {
    fixture.sql.run("INSERT INTO place_names VALUES (?, ?, ?, ?)", [
      "mahas",
      "project",
      app.id,
      "1",
    ]);
    fixture.sql.run("INSERT INTO document_names VALUES (?, ?, ?, ?, ?)", [
      "project",
      project.id,
      "report",
      doc,
      "0",
    ]);
    fixture.transaction((tx) => {
      const places = createPlaceNameReservation(tx);
      const documents = createDocumentNameReservation(tx);
      errorCode(places.get("mahas"), "internal");
      errorCode(places.reserve("mahas", app, "2"), "internal");
      errorCode(documents.get(project, "report"), "internal");
      errorCode(
        documents.reserve(project, "report", otherDoc, "2"),
        "internal",
      );
      return ok(undefined);
    });
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R2: storage failures propagate unchanged to platform boundary", () => {
  const failure = new Error("injected storage failure");
  for (const operation of ["get", "run"] as const) {
    const sql: Sql = {
      run() {
        if (operation === "run") throw failure;
        return { changes: 1, lastInsertRowid: 1 };
      },
      get() {
        if (operation === "get") throw failure;
        return undefined;
      },
      all() {
        return [];
      },
    };
    const places = createPlaceNameReservation({ sql });
    const documents = createDocumentNameReservation({ sql });
    for (
      const reserve of [
        () => places.reserve("valid", project, "1"),
        () => documents.reserve(project, "valid", doc, "1"),
      ]
    ) {
      assertEquals(assertThrows(reserve), failure);
    }
    if (operation === "get") {
      assertEquals(assertThrows(() => places.get("valid")), failure);
      assertEquals(
        assertThrows(() => documents.get(project, "valid")),
        failure,
      );
    }
  }
});

// move·rename 테스트. guarded Tx와 온전한 Tx가 필요해 versions fixture를 쓴다(R8, R9).
import { createDocumentChangeCommands } from "./commands.ts";
import {
  type Emitted,
  ids,
  userContext,
  versionFixture,
} from "../versions/testing/mod.ts";

const commands = createDocumentChangeCommands();
const docId = ids.doc;
const otherId = ids.other;
const projectId = ids.project;
const studioId = ids.app;
type ChangeFixture = ReturnType<typeof versionFixture>;

function seedDocument(
  fixture: ChangeFixture,
  id: string,
  place: { kind: "project" | "app"; id: string } | null,
  name: string | null,
) {
  // version id는 document id 뒷자리를 줄여 만든다. 같은 뒷자리 doc끼리 겹치지 않게 number를 분리한다.
  const HASH = "ab".repeat(32);
  const versionId = `ver_${id.slice(4).slice(0, 24)}${id.slice(-1)}1`;
  fixture.db
    .prepare(
      `INSERT INTO documents (id, place_kind, place_id, name, title, source_kind,
         source_instruction_target, source_project, source_path, latest_version, revision, status)
       VALUES (?, ?, ?, ?, 'Notes', NULL, NULL, NULL, NULL, ?, '1', 'active')`,
    )
    .run(id, place?.kind ?? null, place?.id ?? null, name, versionId);
  fixture.db
    .prepare(
      `INSERT INTO versions (id, document, number, files_hash, primary_path, file_count,
         content_hash, format_name, module_hash, format_explicit, saved_by, saved_at, run, source)
       VALUES (?, ?, 1, ?, 'a.md', 1, ?, 'document', ?, 0, 'user', '2026-10-05T00:00:00.000Z', NULL, NULL)`,
    )
    .run(versionId, id, HASH, HASH, HASH);
}

function seedPlace(
  fixture: ChangeFixture,
  rows: {
    slug: string;
    kind: "project" | "app";
    target: string;
    seq: number;
  }[],
) {
  for (const row of rows) {
    fixture.db
      .prepare(
        "INSERT INTO place_names (slug, kind, target, reserved_seq) VALUES (?, ?, ?, ?)",
      )
      .run(row.slug, row.kind, row.target, String(row.seq));
  }
}

Deno.test("documents/addressing#R9: move와 rename은 user만 허용한다", () => {
  const fixture = versionFixture();
  try {
    seedDocument(fixture, docId, { kind: "project", id: projectId }, "report");
    const command = fixture.transaction((tx) =>
      commands.move.handle(
        tx as never,
        { ...userContext(), actor: "run" } as never,
        {
          document: docId,
          place: { kind: "project", id: projectId },
          name: "memo",
        } as never,
        { base_revision: "1" } as never,
      ) as unknown as Result<never>
    );
    errorCode(command, "forbidden");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R9: 낡은 base_revision은 conflict다", () => {
  const fixture = versionFixture();
  try {
    seedDocument(fixture, docId, { kind: "project", id: projectId }, "report");
    const stale = fixture.transaction((tx) =>
      commands.move.handle(
        tx as never,
        userContext() as never,
        {
          document: docId,
          place: { kind: "project", id: projectId },
          name: "memo",
        } as never,
        { base_revision: "0" } as never,
      ) as unknown as Result<never>
    );
    errorCode(stale, "conflict");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R9: 다른 대상이 점힌 이름으로의 move는 conflict다", () => {
  const fixture = versionFixture();
  try {
    seedDocument(fixture, docId, { kind: "project", id: projectId }, "report");
    seedDocument(fixture, otherId, { kind: "project", id: projectId }, "memo");
    const command = fixture.transaction((tx) =>
      commands.move.handle(
        tx as never,
        userContext() as never,
        {
          document: docId,
          place: { kind: "project", id: projectId },
          name: "memo",
        } as never,
        { base_revision: "1" } as never,
      ) as unknown as Result<never>
    );
    errorCode(command, "conflict");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R8: place 변경은 FileSource와 디스크 파일을 바꾸지 않는다", () => {
  const fixture = versionFixture();
  try {
    seedDocument(fixture, docId, { kind: "project", id: projectId }, "report");
    seedPlace(fixture, [{
      slug: "mahas",
      kind: "project",
      target: projectId,
      seq: 2,
    }]);
    const tx = fixture.transaction((tx2) => {
      const moved = commands.move.handle(
        tx2 as never,
        userContext() as never,
        {
          document: docId,
          place: { kind: "app", id: studioId },
          name: "memo",
        } as never,
        { base_revision: "1" } as never,
      ) as unknown as Result<
        {
          id: string;
          place: unknown;
          name: string | null;
          revision: string;
          file_source: unknown;
          latest_version: string;
        }
      >;
      assert(moved.ok);
      return moved;
    });
    assert(tx.ok);
    const next = tx.value;
    // FileSource는 그대로다(source_kind·source_project·source_path는 NULL이다).
    assertEquals(next.file_source, null);
    assertEquals(
      next.latest_version,
      `ver_${docId.slice(4).slice(0, 24)}${docId.slice(-1)}1`,
    );
    const row = fixture.db
      .prepare(
        "SELECT place_kind, place_id, name, revision, latest_version, source_kind FROM documents WHERE id = ?",
      )
      .get(docId);
    assertEquals(row?.place_kind, "app");
    assertEquals(row?.place_id, studioId);
    // emit seq는 fixture 시퀀스의 첫 값 "1"이다.
    assertEquals(row?.revision, "1");
    // versions 표는 그대로다.
    const versions = fixture.db.prepare(
      "SELECT count(*) AS count FROM versions",
    ).get();
    assertEquals(Number(versions?.count), 1);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R9: move는 옛 예약을 남기고 새 예약을 같은 transaction에 더한다", () => {
  const fixture = versionFixture();
  try {
    seedDocument(fixture, docId, { kind: "project", id: projectId }, "report");
    seedPlace(fixture, [{
      slug: "mahas",
      kind: "project",
      target: projectId,
      seq: 2,
    }]);
    fixture.transaction((tx) => {
      assert(
        commands.move.handle(
          tx as never,
          userContext() as never,
          {
            document: docId,
            place: { kind: "project", id: projectId },
            name: "memo",
          } as never,
          { base_revision: "1" } as never,
        ).ok,
      );
      return ok(undefined);
    });
    // place 예약은 기존 slug와 같은 target이므로 새 행이 늘지 않는다(reserve가 ok(undefined)다).
    const places = fixture.db
      .prepare(
        "SELECT slug, target, reserved_seq FROM place_names ORDER BY reserved_seq",
      )
      .all();
    assertEquals(places.length, 1);
    const names = fixture.db
      .prepare(
        "SELECT name, document, reserved_seq FROM document_names ORDER BY reserved_seq",
      )
      .all();
    assertEquals(names.length, 1);
    // 새 예약 행(memo)이 같은 doc을 가리킨다. 옛 report 이름은 documents 표의 UPDATE로 지워진다.
    assertEquals(names[0]?.name, "memo");
    assertEquals(names[0]?.document, docId);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R9: rename은 place를 그대로 두고 이름만 바꾼다", () => {
  const fixture = versionFixture();
  try {
    seedDocument(fixture, docId, { kind: "project", id: projectId }, "report");
    seedPlace(fixture, [{
      slug: "memo",
      kind: "project",
      target: projectId,
      seq: 2,
    }]);
    const command = fixture.transaction((tx) =>
      commands.rename.handle(
        tx as never,
        userContext() as never,
        { document: docId, name: "memo" } as never,
        { base_revision: "1" } as never,
      ) as unknown as Result<
        {
          place: { kind: string; id: string } | null;
          name: string | null;
          revision: string;
        }
      >
    );
    assert(command.ok);
    assertEquals(command.value.place, { kind: "project", id: projectId });
    assertEquals(command.value.name, "memo");
    const moved = fixture.emitted as Emitted[];
    assertEquals(moved.map((event) => event.type), ["DocumentRenamed"]);
  } finally {
    fixture.close();
  }
});

// 사람이 고른 option action이 부르는 경로(addressing#R9). lophn-agent가 고정한 action을 platform이
// 사람 결정으로 검증한 뒤 같은 transaction의 user 자격으로 dispatch한다. 이 command는 그 user
// 자격과 고정된 대상·place·이름·base_revision만 받는다.
Deno.test("documents/addressing#R9: option action이 부르는 move와 rename은 user만 받는 dispatch 가능 command이고 revert가 부르는 archive와 restore는 user·machine이 받는다", () => {
  const routes = DOCUMENT_DISPATCHABLE_COMMANDS.map((item) => item.route.name);
  assertEquals(routes, [
    "document.move",
    "document.rename",
    "document.archive",
    "document.restore",
  ]);
  const actorsOf = (
    name: string,
  ) => [
    ...DOCUMENT_DISPATCHABLE_COMMANDS.find((item) => item.route.name === name)!
      .route.actors,
  ];
  // option action이 부르는 둘은 사람 결정의 user 자격만 받는다.
  assertEquals(actorsOf("document.move"), ["user"]);
  assertEquals(actorsOf("document.rename"), ["user"]);
  // revert가 부르는 둘은 사람의 보관·복원과 같은 route라서 user와 요청된 revert의 machine이다.
  assertEquals(actorsOf("document.archive"), ["user", "machine"]);
  assertEquals(actorsOf("document.restore"), ["user", "machine"]);
  assertEquals(commands.move.route.name, "document.move");
  assertEquals(commands.rename.route.name, "document.rename");
});

Deno.test("documents/addressing#R9: 고정 option을 적용한 뒤 같은 option을 다시 적용하면 낡은 기준이라 conflict다", () => {
  const fixture = versionFixture();
  try {
    seedDocument(fixture, docId, { kind: "project", id: projectId }, "report");
    // option을 만든 시점의 revision. 적용이 revision을 옮기면 같은 option은 낡은 기준이다.
    fixture.sql.run("UPDATE documents SET revision = '9' WHERE id = ?", [
      docId,
    ]);
    const fixed = {
      document: docId,
      place: { kind: "project", id: projectId },
      name: "memo",
    };
    const apply = () =>
      fixture.transaction((tx) =>
        commands.move.handle(
          tx as never,
          userContext() as never,
          fixed as never,
          { base_revision: "9" } as never,
        ) as unknown as Result<{ revision: string }>
      );
    const first = apply();
    assert(first.ok);
    assertEquals(fixture.emitted.map((event) => event.type), [
      "DocumentMoved",
    ]);
    const again = apply();
    errorCode(again, "conflict");
    // 두 번째 시도는 event도 예약도 남기지 않는다.
    assertEquals(fixture.emitted.length, 1);
    const reserved = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM document_names WHERE document = ?",
      [docId],
    );
    assertEquals(reserved?.["count"], 1);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R9: 자리 없는 문서는 option이 고정한 place가 있을 때만 옮기고 그 밖에는 자리 없음 그대로다", () => {
  const fixture = versionFixture();
  try {
    seedDocument(fixture, docId, null, null);
    // 자리·이름이 모두 비어 있는 입력은 아무것도 바꾸지 않는 요청이라 거절한다.
    const nothing = fixture.transaction((tx) =>
      commands.move.handle(
        tx as never,
        userContext() as never,
        { document: docId, place: null, name: null } as never,
        { base_revision: "1" } as never,
      ) as unknown as Result<never>
    );
    errorCode(nothing, "invalid_input");
    // 이름만 있고 place 없는 rename은 임의 경로로 자리를 만들지 않는다.
    const renamed = fixture.transaction((tx) =>
      commands.rename.handle(
        tx as never,
        userContext() as never,
        { document: docId, name: "memo" } as never,
        { base_revision: "1" } as never,
      ) as unknown as Result<never>
    );
    errorCode(renamed, "invalid_input");
    const row = fixture.sql.get(
      "SELECT place_kind, name FROM documents WHERE id = ?",
      [docId],
    );
    assertEquals(row?.["place_kind"], null);
    assertEquals(row?.["name"], null);
    assertEquals(fixture.emitted.length, 0);
    // option이 place와 이름을 고정했으면 그 자리로만 간다.
    const moved = fixture.transaction((tx) =>
      commands.move.handle(
        tx as never,
        userContext() as never,
        {
          document: docId,
          place: { kind: "project", id: projectId },
          name: "memo",
        } as never,
        { base_revision: "1" } as never,
      ) as unknown as Result<{ place: unknown; name: string | null }>
    );
    assert(moved.ok);
    assertEquals(moved.value.place, { kind: "project", id: projectId });
    assertEquals(moved.value.name, "memo");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R9: agent와 machine이 직접 보낸 move는 option 근거가 없어 forbidden이다", () => {
  const fixture = versionFixture();
  try {
    seedDocument(fixture, docId, { kind: "project", id: projectId }, "report");
    for (
      const actor of [
        "machine",
        "agent:asg_01arz3ndektsv4rrffq69g5fav",
        "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
      ]
    ) {
      const denied = fixture.transaction((tx) =>
        commands.move.handle(
          tx as never,
          userContext(actor) as never,
          {
            document: docId,
            place: { kind: "project", id: projectId },
            name: "memo",
          } as never,
          { base_revision: "1" } as never,
        ) as unknown as Result<never>
      );
      errorCode(denied, "forbidden");
    }
    assertEquals(fixture.emitted.length, 0);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R9: 같은 place와 name의 move는 invalid_input이다", () => {
  const fixture = versionFixture();
  try {
    seedDocument(fixture, docId, { kind: "project", id: projectId }, "report");
    const command = fixture.transaction((tx) =>
      commands.move.handle(
        tx as never,
        userContext() as never,
        {
          document: docId,
          place: { kind: "project", id: projectId },
          name: "report",
        } as never,
        { base_revision: "1" } as never,
      ) as unknown as Result<never>
    );
    errorCode(command, "invalid_input");
  } finally {
    fixture.close();
  }
});
