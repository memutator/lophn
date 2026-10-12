import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { ok } from "../../../base/mod.ts";
import type { SchemaStep } from "../../../protocol/server/mod.ts";
import {
  escapeLike,
  ftsMatchQuery,
  likePattern,
  needsLikeFallback,
} from "./model.ts";
import { outlineAndSearchSchemaSteps } from "./schema.ts";
import {
  allOmissions,
  applySearchEvent,
  type ConsumerEvent,
  coverageOf,
  startRebuild,
} from "./work.ts";

function schemaSteps(): readonly SchemaStep[] {
  return outlineAndSearchSchemaSteps;
}

// leaf unit fixture. 바깥 세계는 없다. writer와 read는 같은 연결이다.
function fixture() {
  const directory = Deno.makeTempDirSync({ prefix: "outline-search-work-" });
  const db = new DatabaseSync(`${directory}/derived.sqlite`);
  db.exec("PRAGMA journal_mode=MEMORY; PRAGMA foreign_keys=ON;");
  for (const step of schemaSteps()) db.exec(step.sql);
  return {
    sql: {
      run: (statement: string, params: readonly unknown[]) =>
        db.prepare(statement).run(...(params as never[])),
      get: (statement: string, params: readonly unknown[]) =>
        db.prepare(statement).get(...(params as never[])) as
          | Record<
            string,
            unknown
          >
          | undefined,
      all: (statement: string, params: readonly unknown[]) =>
        db.prepare(statement).all(...(params as never[])) as Record<
          string,
          unknown
        >[],
    },
    close() {
      db.close();
      Deno.removeSync(directory, { recursive: true });
    },
  };
}

// applySearchEvent의 store 얕은 표면. 한 event의 transaction 계약만 본다.
function storeOf(sql: ReturnType<typeof fixture>["sql"]) {
  return {
    transaction<T>(
      handle: (
        tx: { sql: typeof sql },
      ) => import("../../../base/mod.ts").Result<T>,
    ) {
      return handle({ sql });
    },
  } as never as Parameters<typeof applySearchEvent>[0];
}

function savedEvent(
  document: string,
  version: string,
  seq: string,
): ConsumerEvent {
  return {
    seq,
    type: "DocumentSaved",
    subject: document,
    payload: {
      version,
      previous_version: null,
      content_hash: "a".repeat(64),
      format: { name: "document", module_hash: "a".repeat(64) },
      source: null,
    },
  };
}

Deno.test("documents/outline-and-search#R16: archive와 unarchive는 현재 ledger 상태로 search_documents status를 바꾼다", () => {
  const fx = fixture();
  try {
    fx.sql.run(
      `INSERT INTO search_documents (document, indexed_version, title, name, place_kind, place_id, status, saved_seq)
       VALUES ('doc_a', 'ver_a', '보고서', NULL, 'project', 'prj_a', 'active', '1')`,
      [],
    );
    fx.sql.run(
      `INSERT INTO derived_versions (version, document, content_hash, module_hash, extraction_status, line_count, section_count, failure_reason)
       VALUES ('ver_a', 'doc_a', 'a', 'a', 'ready', 1, 0, NULL)`,
      [],
    );
    const archived = applySearchEvent(storeOf(fx.sql), {
      seq: "2",
      type: "DocumentArchived",
      subject: "doc_a",
      payload: { before_revision: "1" },
    });
    assertEquals(archived.ok, true);
    const status = fx.sql.get(
      `SELECT status FROM search_documents WHERE document = 'doc_a'`,
      [],
    );
    assertEquals(String(status?.status), "archived");
    const restored = applySearchEvent(storeOf(fx.sql), {
      seq: "3",
      type: "DocumentUnarchived",
      subject: "doc_a",
      payload: { before_revision: "2" },
    });
    assertEquals(restored.ok, true);
    const after = fx.sql.get(
      `SELECT status FROM search_documents WHERE document = 'doc_a'`,
      [],
    );
    assertEquals(String(after?.status), "active");
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R16: move는 자리를 갱신하고 rename은 이름을 갱신한다", () => {
  const fx = fixture();
  try {
    fx.sql.run(
      `INSERT INTO search_documents (document, indexed_version, title, name, place_kind, place_id, status, saved_seq)
       VALUES ('doc_a', 'ver_a', '보고서', 'report', 'project', 'prj_a', 'active', '1')`,
      [],
    );
    const moved = applySearchEvent(storeOf(fx.sql), {
      seq: "2",
      type: "DocumentMoved",
      subject: "doc_a",
      payload: {
        before_place: { kind: "project", id: "prj_a" },
        before_name: "report",
        place: { kind: "app", id: "app_a" },
        name: "report",
        before_revision: "1",
      },
    });
    assertEquals(moved.ok, true);
    const row = fx.sql.get(
      `SELECT place_kind, place_id FROM search_documents WHERE document = 'doc_a'`,
      [],
    );
    assertEquals(String(row?.place_kind), "app");
    assertEquals(String(row?.place_id), "app_a");
    const renamed = applySearchEvent(storeOf(fx.sql), {
      seq: "3",
      type: "DocumentRenamed",
      subject: "doc_a",
      payload: {
        place: { kind: "app", id: "app_a" },
        before_name: "report",
        name: "log",
        before_revision: "2",
      },
    });
    assertEquals(renamed.ok, true);
    const name = fx.sql.get(
      `SELECT name FROM search_documents WHERE document = 'doc_a'`,
      [],
    );
    assertEquals(String(name?.name), "log");
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R14: 실패 주입 시 omissions가 이유를 남기고 ready는 남지 않는다", () => {
  const fx = fixture();
  try {
    fx.sql.run(
      `INSERT INTO derived_versions (version, document, content_hash, module_hash, extraction_status, section_count, failure_reason)
       VALUES ('ver_fail', 'doc_fail', 'a', 'a', 'failed', 0, 'module failed')`,
      [],
    );
    fx.sql.run(
      `INSERT INTO derived_versions (version, document, content_hash, module_hash, extraction_status, line_count, section_count, failure_reason)
       VALUES ('ver_ready', 'doc_fail', 'b', 'b', 'ready', 3, 0, NULL)`,
      [],
    );
    const omissions = allOmissions(fx.sql);
    assertEquals(omissions.length, 1);
    assertEquals(omissions[0].document, "doc_fail");
    assertEquals(omissions[0].version, "ver_fail");
    assertEquals(omissions[0].reason, "module failed");
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R13: startRebuild는 rebuilding flag만 심고 ledger 흔적은 없다", () => {
  const fx = fixture();
  try {
    const started = startRebuild(storeOf(fx.sql), "9");
    assertEquals(started, ok(undefined));
    const cursors = fx.sql.all(
      `SELECT consumer, rebuilding FROM derived_cursors`,
      [],
    );
    assertEquals(cursors.length, 1);
    for (const cursor of cursors) {
      assertEquals(Number(cursor.rebuilding), 1);
    }
    const search = coverageOf({ sql: fx.sql }, "9");
    assertEquals(search.rebuilding, true);
    assertEquals(search.processed_seq, "9");
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R11: ftsTerms는 3 codepoint 미만 token을 버리고 bare term을 AND로 남긴다", () => {
  assertEquals(
    ftsMatchQuery("데이터베이스마이그레이션계획서"),
    '"데이터베이스마이그레이션계획서"',
  );
  // 문서는 2 codepoint라 FTS term에서 빠진다.
  assertEquals(ftsMatchQuery("문서 용어집"), '"용어집"');
  // 2글자·3글자 미만 token만 있으면 FTS MATCH를 쓰지 않는다.
  assertEquals(needsLikeFallback("문서"), true);
  assertEquals(needsLikeFallback("용어"), true);
  assertEquals(
    needsLikeFallback("데이터베이스마이그레이션계획서"),
    false,
  );
  assertEquals(ftsMatchQuery("문서 용어"), null);
});

Deno.test("documents/outline-and-search#R11: likePattern은 %·_·\\를 escape한다", () => {
  assertEquals(likePattern("문서%"), "%문서\\%%");
  assertEquals(likePattern("용어_"), "%용어\\_%");
  assertEquals(escapeLike("a\\b"), "a\\\\b");
});

Deno.test("documents/outline-and-search#R16: saved event는 낡은 search_rows만 지우고 cursor는 진행한다", () => {
  const fx = fixture();
  try {
    fx.sql.run(
      `INSERT INTO search_documents (document, indexed_version, title, name, place_kind, place_id, status, saved_seq)
       VALUES ('doc_a', 'ver_a', '보고서', NULL, NULL, NULL, 'active', '1')`,
      [],
    );
    fx.sql.run(
      `INSERT INTO search_rows (document, version, section_key, ranges, title, body)
       VALUES ('doc_a', 'ver_a', NULL, '[]', '보고서', '본문')`,
      [],
    );
    const result = applySearchEvent(
      storeOf(fx.sql),
      savedEvent("doc_a", "ver_b", "2"),
    );
    assertEquals(result.ok, true);
    const rows = fx.sql.all(
      `SELECT document FROM search_rows WHERE document = 'doc_a'`,
      [],
    );
    assertEquals(rows.length, 0);
  } finally {
    fx.close();
  }
});
