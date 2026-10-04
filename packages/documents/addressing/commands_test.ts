import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { ok, type Result } from "../../base/mod.ts";
import type { PlaceRef } from "../../contracts/documents/mod.ts";
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
