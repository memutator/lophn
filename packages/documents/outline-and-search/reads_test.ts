import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  TargetAuthorization,
  type TargetAuthorizer,
} from "../../contracts/platform/mod.ts";
import { openDerived, openDerivedRead, rebuildPath } from "./adapters/store.ts";
import { createSearchHandlers, excerptOf } from "./reads.ts";
import { PREAMBLE_EXCERPT_CODEPOINTS, preambleExcerpt } from "./model.ts";
import { type ExtractionRecord, recordExtraction } from "./extraction.ts";
import { startRebuild } from "./work.ts";

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const DOC_A = "doc_01arz3ndektsv4rrffq69g5fav";
const DOC_B = "doc_01arz3ndektsv4rrffq69g5fb0";
const VER_A = "ver_01arz3ndektsv4rrffq69g5fav";
const VER_B = "ver_01arz3ndektsv4rrffq69g5fb0";
const HASH = "a".repeat(64);
const CTX = {
  principal: "person",
  actor: "user" as const,
  scope: { operations: ["search.query"], targets: {} },
  conditions: {},
  credential_ref: "current",
};

const allowAll: TargetAuthorizer = () => ok(undefined);

function fixtureRoot(): string {
  const url = new URL("../../../fixtures/projects/", import.meta.url);
  return url.pathname;
}

async function fixtureText(name: string): Promise<string> {
  return await Deno.readTextFile(`${fixtureRoot()}korean-search/${name}`);
}

// derived store를 실제 파일 SQLite로 만든다. swap(재생성 교체)도 같은 파일 형식이다.
function openDerivedFixture() {
  const directory = Deno.makeTempDirSync({ prefix: "outline-search-reads-" });
  const path = `${directory}/documents.sqlite`;
  const opened = openDerived(path);
  if (!opened.ok) throw new Error(opened.error.message);
  // read는 query_only 연결이다. writer 연결(opened.value.read)은 노출하지 않는다.
  const openedRead = openDerivedRead(path);
  if (!openedRead.ok) throw new Error(openedRead.error.message);
  const authorizer = { current: allowAll };
  const snapshot = {
    as_of_seq: "5",
    sql: {
      get: (query: string, params: readonly unknown[]) =>
        ledgerDb.prepare(query).get(...params as never[]) as
          | Record<
            string,
            unknown
          >
          | undefined,
      all: (query: string, params: readonly unknown[]) =>
        ledgerDb.prepare(query).all(...params as never[]) as Record<
          string,
          unknown
        >[],
    },
  };
  const ledgerDb = new DatabaseSync(`${directory}/ledger.sqlite`);
  ledgerDb.exec(
    "CREATE TABLE documents (id TEXT PRIMARY KEY, place_kind TEXT, place_id TEXT, name TEXT, title TEXT, latest_version TEXT, revision TEXT, status TEXT NOT NULL DEFAULT 'active'); CREATE TABLE versions (id TEXT PRIMARY KEY, document TEXT, number INTEGER, content_hash TEXT, format_name TEXT, module_hash TEXT, format_explicit INTEGER);",
  );
  const deps = (
    contexts?: Parameters<typeof createSearchHandlers>[0]["contexts"],
  ) => ({
    read: openedRead.value,
    snapshot,
    ports: {
      port<T>(authorizeKey: unknown): T {
        if (!Object.is(authorizeKey, TargetAuthorization)) {
          throw new Error("unregistered port");
        }
        return authorizer.current as T;
      },
    },
    ...(contexts === undefined ? {} : { contexts }),
  });
  return {
    store: opened.value,
    path,
    directory,
    snapshot,
    ledgerSql: {
      run: (query: string, params: readonly unknown[]) =>
        ledgerDb.prepare(query).run(...(params as never[])),
    },
    use(authorize: TargetAuthorizer) {
      authorizer.current = authorize;
    },
    // event 소비가 끝난 상태. search cursor를 진행시킨다.
    consumed(seq: string): void {
      opened.value.transaction((tx) =>
        ok(tx.sql.run(
          `INSERT INTO derived_cursors (consumer, processed_seq, rebuilding) VALUES ('search', ?, 0)`,
          [seq],
        ))
      );
    },
    handlers(
      contexts?: Parameters<typeof createSearchHandlers>[0]["contexts"],
    ): ReturnType<typeof createSearchHandlers> {
      return createSearchHandlers(deps(contexts));
    },
    // contexts를 주지 않은 조립. context filter가 fail-closed로 비는지 본다.
    handlerWithoutContexts(): ReturnType<typeof createSearchHandlers> {
      return createSearchHandlers({
        read: openedRead.value,
        snapshot,
        ports: {
          port<T>(authorizeKey: unknown): T {
            if (!Object.is(authorizeKey, TargetAuthorization)) {
              throw new Error("unregistered port");
            }
            return authorizer.current as T;
          },
        },
      });
    },
    close() {
      opened.value.close();
      ledgerDb.close();
      Deno.removeSync(directory, { recursive: true });
    },
  };
}

function glossaryRecord(version: string, text: string): ExtractionRecord {
  return {
    document: DOC_A,
    version,
    content_hash: HASH,
    module_hash: HASH,
    extraction: {
      status: "ready",
      title: "용어집",
      text,
      text_hash: HASH,
      sections: [
        {
          key: "문서",
          title: "문서",
          parent: null,
          position: 0,
          level: 1,
          anchor: null,
          own_ranges: [{ start_line: 6, end_line: 7 }],
          subtree_range: { start_line: 6, end_line: 7 },
          characters: 30,
          body_hash: HASH,
        },
        {
          key: "용어",
          title: "용어",
          parent: null,
          position: 1,
          level: 1,
          anchor: null,
          own_ranges: [{ start_line: 9, end_line: 10 }],
          subtree_range: { start_line: 9, end_line: 10 },
          characters: 20,
          body_hash: HASH,
        },
      ],
    },
  };
}

function ledgerRow(
  fx: ReturnType<typeof openDerivedFixture>,
  document: string,
  version: string,
  place: { kind: string; id: string } | null,
): void {
  fx.ledgerSql.run(
    `INSERT INTO documents (id, place_kind, place_id, name, title, latest_version, revision, status)
     VALUES (?, ?, ?, 'glossary', '용어집', ?, '1', 'active')`,
    [
      document,
      place === null ? null : place.kind,
      place === null ? null : place.id,
      version,
    ],
  );
  fx.ledgerSql.run(
    `INSERT INTO versions (id, document, number, content_hash, format_name, module_hash, format_explicit)
     VALUES (?, ?, 1, ?, 'document', ?, 1)`,
    [version, document, HASH, HASH],
  );
}

function keep<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code} ${result.error.message}`);
  }
  return result.value;
}

Deno.test("documents/outline-and-search#R11: korean-search 2글자와 3글자 미만 query는 LIKE로 문서·용어를 찾는다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("glossary.md");
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "1"));
    fx.consumed("5");
    // 2글자 query "문서". like fallback으로 section 본문과 title을 찾는다.
    const page = keep(fx.handlers().query(CTX, { query: "문서" }));
    assert(page.results.length >= 1);
    const found = page.results.find((result) => result.section === "문서");
    assert(found !== undefined);
    assert(found.ranges.length > 0);
    assertEquals(found.match_source, "original");
    assertEquals(found.cache_basis, null);
    // 본문 줄 안 일치. 1-based 줄 근거다.
    assertEquals(found.ranges[0].start_line >= 1, true);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R11: korean-search 긴 합성어 3 codepoint 이상 query는 문서를 찾는다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("migration.md");
    fx.ledgerSql.run(
      `INSERT INTO documents (id, place_kind, place_id, name, title, latest_version, revision, status)
       VALUES (?, 'project', ?, 'migration', '마이그레이션', ?, '1', 'active')`,
      [DOC_B, PROJECT, VER_B],
    );
    fx.ledgerSql.run(
      `INSERT INTO versions (id, document, number, content_hash, format_name, module_hash, format_explicit)
       VALUES (?, ?, 1, ?, 'document', ?, 1)`,
      [VER_B, DOC_B, HASH, HASH],
    );
    const record: ExtractionRecord = {
      document: DOC_B,
      version: VER_B,
      content_hash: HASH,
      module_hash: HASH,
      extraction: {
        status: "ready",
        title: "마이그레이션",
        text,
        text_hash: HASH,
        sections: [],
      },
    };
    keep(recordExtraction(fx.store, record, "2"));
    fx.consumed("5");
    const page = keep(
      fx.handlers().query(CTX, { query: "데이터베이스마이그레이션계획서" }),
    );
    assert(page.results.length >= 1);
    assertEquals(page.results[0].document, DOC_B);
    // sections 없는 판은 preamble row 하나. section은 null이다.
    assertEquals(page.results[0].section, null);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R17: 보관 문서는 현재 ledger 상태로 기본 결과에서 빠진다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("glossary.md");
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "1"));
    fx.consumed("5");
    // ledger 상태는 archived다. 낡은 index 행(status 'active')이 있어도 빠진다.
    fx.ledgerSql.run(`UPDATE documents SET status = 'archived' WHERE id = ?`, [
      DOC_A,
    ]);
    const page = keep(fx.handlers().query(CTX, { query: "문서" }));
    assertEquals(page.results.length, 0);
    const status = keep(fx.handlers().status(CTX, {}));
    assertEquals(status.documents.length, 0);
    // 해제 뒤에는 다시 나온다.
    fx.ledgerSql.run(`UPDATE documents SET status = 'active' WHERE id = ?`, [
      DOC_A,
    ]);
    const after = keep(fx.handlers().query(CTX, { query: "문서" }));
    assert(after.results.length >= 1);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R10 R12: place filter와 없는 대상은 같은 응답으로 존재를 새지 않는다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("glossary.md");
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "1"));
    fx.consumed("5");
    const inPlace = keep(
      fx.handlers().query(CTX, {
        query: "문서",
        place: { kind: "project", id: PROJECT },
      }),
    );
    assert(inPlace.results.length >= 1);
    const otherPlace = keep(
      fx.handlers().query(CTX, {
        query: "문서",
        place: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fb0" },
      }),
    );
    assertEquals(otherPlace.results.length, 0);
    // 없는 대상과 같은 응답. 빈 결과다.
    const absent = keep(
      fx.handlers().status(CTX, {
        documents: ["doc_01arz3ndektsv4rrffq69g5fb0"],
      }),
    );
    assertEquals(absent.documents.length, 0);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R10 R12: agent 출력은 scope 밖 ID를 후보 단계에서 뺀다", () => {
  const fx = openDerivedFixture();
  try {
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    // 권한이 전부 거절한다. 후보 단계에서 빠진다.
    fx.use(() => err({ code: "forbidden", message: "out of scope" }));
    const page = keep(fx.handlers().query(CTX, { query: "문서" }));
    assertEquals(page.results.length, 0);
    const status = keep(fx.handlers().status(CTX, { documents: [DOC_A] }));
    assertEquals(status.documents.length, 0);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R12 R14: scope 밖 principal은 absent와 같은 omissions를 본다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("glossary.md");
    // DOC_A는 재범위 문서, DOC_B는 권한 밖 문서다. DOC_B의 추출은 실패해 omissions가 남는다.
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    ledgerRow(fx, DOC_B, VER_B, {
      kind: "project",
      id: "prj_01arz3ndektsv4rrffq69g5fb0",
    });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "1"));
    const failed: ExtractionRecord = {
      document: DOC_B,
      version: VER_B,
      content_hash: HASH,
      module_hash: HASH,
      extraction: {
        status: "failed",
        failure_reason: "heap exhausted",
        sections: [],
      },
    };
    keep(recordExtraction(fx.store, failed, "2"));
    fx.consumed("5");
    // 후보 권한이 DOC_B만 거절한다. DOC_A의 누락은 없고 DOC_B만 있다.
    let rejectB = false;
    fx.use((_ctx, _operation, target) => {
      if (rejectB && (target as { document?: string }).document === DOC_B) {
        return err({ code: "forbidden", message: "out of scope" });
      }
      return ok(undefined);
    });
    const inScope = keep(fx.handlers().status(CTX, {}));
    assertEquals(inScope.coverage.omissions.length, 1);
    assertEquals(inScope.coverage.omissions[0].document, DOC_B);
    // DOC_B를 scope에서 빼면 omissions도 absent와 같은 빈 목록이다.
    rejectB = true;
    const outOfScope = keep(fx.handlers().status(CTX, {}));
    assertEquals(outOfScope.documents.length, 1);
    assertEquals(outOfScope.coverage.omissions.length, 0);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R12: context filter는 items 목록 문서로 후보를 좁히고 없는 context는 전부 비운다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("glossary.md");
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    ledgerRow(fx, DOC_B, VER_B, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "1"));
    fx.consumed("5");
    // ctx_a는 DOC_A만 items로 둔다. context filter가 DOC_B를 후보에서 뺀다.
    const contexts = {
      items: (contextId: string) =>
        contextId === "ctx_01arz3ndektsv4rrffq69g5fav"
          ? ok([{ kind: "document" as const, document: DOC_A }])
          : err({
            code: "not_found" as const,
            message: "context not found",
          }),
    };
    const unfiltered2 = keep(fx.handlers().query(CTX, { query: "문서" }));
    assertEquals(unfiltered2.results.length >= 1, true);
    // context filter는 items 목록 밖 문서를 후보에서 빼고 이전 검색 결과를 기울이지 않는다.
    const filtered = keep(
      fx.handlers(contexts).query(CTX, {
        query: "문서",
        context: "ctx_01arz3ndektsv4rrffq69g5fav",
      }),
    );
    assert(filtered.results.length >= 1);
    assertEquals(
      filtered.results.every((result) => result.document === DOC_A),
      true,
    );
    // 없는 context는 fail-closed다. 결과를 기울이지 않고 빈 결과를 낸다.
    const unknown = keep(
      fx.handlers().query(CTX, {
        query: "문서",
        context: "ctx_01arz3ndektsv4rrffq69g5fb0",
      }),
    );
    assertEquals(unknown.results.length, 0);
    // contexts를 주지 않은 조립은 fail-closed다. filter가 있으면 결과가 없다.
    // read는 query_only 연결이다. writer 연결(fx.store.read)은 노출하지 않는다.
    const readOnly = openDerivedRead(fx.path);
    if (!readOnly.ok) throw new Error(readOnly.error.message);
    const unfiltered = keep(
      fx.handlerWithoutContexts().query(
        CTX,
        { query: "문서", context: "ctx_01arz3ndektsv4rrffq69g5fav" },
      ),
    );
    assertEquals(unfiltered.results.length, 0);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R14: 재생성 중이면 결과 없이 coverage.rebuilding=true를 낸다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("glossary.md");
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "1"));
    fx.consumed("5");
    keep(startRebuild(fx.store, "5"));
    const page = keep(fx.handlers().query(CTX, { query: "문서" }));
    assertEquals(page.results.length, 0);
    assertEquals(page.coverage.rebuilding, true);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R14: 뒤처짐은 결과 없이 lagging=true를 낸다", () => {
  const fx = openDerivedFixture();
  try {
    fx.handlers;
    // snapshot의 basis가 5이고 consumer cursor는 없다(0). lagging이다.
    const page = keep(fx.handlers().query(CTX, { query: "문서" }));
    assertEquals(page.results.length, 0);
    assertEquals(page.coverage.lagging, true);
    assertEquals(page.coverage.rebuilding, false);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R14: 실패 주입과 실제 빈 결과는 omissions로 구별한다", () => {
  const fx = openDerivedFixture();
  try {
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    // 일치하는 문서가 없는 실제 빈 결과. omissions 없다.
    const empty = keep(fx.handlers().status(CTX, {}));
    assertEquals(empty.documents.length, 0);
    assertEquals(empty.coverage.omissions.length, 0);
    // 실패 주입. 같은 빈 결과에 omissions가 이유를 남긴다. DOC_B는 ledger 문서라
    // 후보 집합에 들어가고 누락도 허용 집합에서 남는다.
    const failed: ExtractionRecord = {
      document: DOC_B,
      version: VER_B,
      content_hash: HASH,
      module_hash: HASH,
      extraction: {
        status: "failed",
        failure_reason: "heap exhausted",
        sections: [],
      },
    };
    ledgerRow(fx, DOC_B, VER_B, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, failed, "1"));
    fx.consumed("5");
    const injected = keep(fx.handlers().status(CTX, {}));
    // failed 추출은 search_documents 행은 선다(재시작 대상). 문서 목록에는 들어가고
    // 누락이 같이 간다. 실제 빈 결과(문서도 누락도 없음)와 omissions로 구별한다.
    assertEquals(injected.documents.length, 1);
    assertEquals(injected.coverage.omissions.length, 1);
    assertEquals(injected.coverage.omissions[0].document, DOC_B);
    assertEquals(injected.coverage.omissions[0].reason, "heap exhausted");
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R18: 요약 없으면 서문 200 codepoint 발췌를 요약과 구별해 준다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("glossary.md");
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "1"));
    fx.consumed("5");
    const status = keep(fx.handlers().status(CTX, { documents: [DOC_A] }));
    assertEquals(status.documents.length, 1);
    assertEquals(status.documents[0].version, VER_A);
    assertEquals(status.documents[0].format?.name, "document");
    assertEquals(status.documents[0].module_hash, HASH);
    // 발췌는 codepoint 기준 200자다. 요약과 구별이다.
    const excerpt = excerptOf(text);
    assertEquals(excerpt, preambleExcerpt(text));
    assertEquals([...excerpt].length <= PREAMBLE_EXCERPT_CODEPOINTS, true);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R13: index 삭제 뒤 재생성 swap은 같은 ledger 참조로 결과를 되찾는다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("glossary.md");
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "1"));
    fx.consumed("5");
    const before = keep(fx.handlers().query(CTX, { query: "문서" }));
    assert(before.results.length >= 1);
    // 문서 삭제 흉내. index 행을 지운다.
    fx.store.transaction((tx) => {
      tx.sql.run(`DELETE FROM search_rows`, []);
      tx.sql.run(`DELETE FROM search_documents`, []);
      return ok(undefined);
    });
    // 삭제 뒤 재생성 시작. rebuilding flag로 진실을 낸다.
    keep(startRebuild(fx.store, "5"));
    const emptied = keep(fx.handlers().query(CTX, { query: "문서" }));
    assertEquals(emptied.results.length, 0);
    assertEquals(emptied.coverage.rebuilding, true);
    // 재생성 끝. 다시 구독을 따라잡은 상태다.
    fx.consumed("5");
    // 재파입 전이므로 indexed 행은 아직 없다. status는 없는 문서와 같은 빈 목록이다.
    const beforeRebuild = keep(
      fx.handlers().status(CTX, { documents: [DOC_A] }),
    );
    assertEquals(beforeRebuild.documents.length, 0);
    // 재생성 끝 뒤 재반영(recordExtraction). 같은 ledger 참조로 결과를 되찾는다.
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "6"));
    const rebuilt = keep(fx.handlers().status(CTX, { documents: [DOC_A] }));
    assertEquals(rebuilt.documents.length, 1);
    assertEquals(rebuilt.documents[0].version, VER_A);
    // 재생성 교체 target 경로. rebuild 파일 이름은 documents.rebuild.sqlite다.
    assertEquals(
      rebuildPath(fx.directory).endsWith("documents.rebuild.sqlite"),
      true,
    );
  } finally {
    fx.close();
  }
});
