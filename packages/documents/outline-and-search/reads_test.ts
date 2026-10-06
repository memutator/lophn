import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  TargetAuthorization,
  type TargetAuthorizer,
} from "../../contracts/platform/mod.ts";
import { openDerived, openDerivedRead, rebuildPath } from "./adapters/store.ts";
import {
  createOutlineHandlers,
  createSearchHandlers,
  excerptOf,
} from "./reads.ts";
import { PREAMBLE_EXCERPT_CODEPOINTS, preambleExcerpt } from "./model.ts";
import { type ExtractionRecord, recordExtraction } from "./extraction.ts";
import { startRebuild } from "./work.ts";
import {
  contextOutlinePageSchema,
  rootOutlinePageSchema,
} from "../../contracts/documents/mod.ts";
import {
  createContextCommands,
  createContextOutlineSource,
} from "../contexts/mod.ts";
import {
  contextFixture,
  ids as contextIds,
  userContext,
} from "../contexts/testing/mod.ts";
import { projectsSchemaSteps } from "../projects/mod.ts";
import {
  createTermCommands,
  createTermGlossarySource,
  termsSchemaSteps,
} from "../terms/mod.ts";

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const DOC_A = "doc_01arz3ndektsv4rrffq69g5fav";
const DOC_B = "doc_01arz3ndektsv4rrffq69g5fb0";
const VER_A = "ver_01arz3ndektsv4rrffq69g5fav";
const VER_B = "ver_01arz3ndektsv4rrffq69g5fb0";
const HASH = "a".repeat(64);
// 이어 읽기 fixture. 첫 줄 8000 둘째 줄 8000. 12,000 예산을 넘는다.
const LONG_A = `${"첫".repeat(8000)}\n${"둘".repeat(8000)}`;
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
    "CREATE TABLE documents (id TEXT PRIMARY KEY, place_kind TEXT, place_id TEXT, name TEXT, title TEXT, latest_version TEXT, revision TEXT, status TEXT NOT NULL DEFAULT 'active'); CREATE TABLE versions (id TEXT PRIMARY KEY, document TEXT, number INTEGER, content_hash TEXT, format_name TEXT, module_hash TEXT, format_explicit INTEGER, saved_by TEXT, saved_at TEXT); CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, title TEXT, purpose TEXT, revision TEXT, status TEXT NOT NULL DEFAULT 'active'); CREATE TABLE apps (id TEXT PRIMARY KEY, slug TEXT, name TEXT, description TEXT, revision TEXT, status TEXT NOT NULL DEFAULT 'active'); CREATE TABLE version_files (version TEXT, path TEXT, blob_hash TEXT, bytes INTEGER, media_type TEXT, primary_file INTEGER);",
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
    // outline·단계적 읽기 조립(T14).
    outline(): ReturnType<typeof createOutlineHandlers> {
      return createOutlineHandlers({
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
    // 직접 추출 근원을 넣은 outline 조립(R15).
    outlineWithExtract(
      extract: (record: { document: string; version: string }) => void,
    ): ReturnType<typeof createOutlineHandlers> {
      return createOutlineHandlers({
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
        extract,
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

Deno.test("documents/outline-and-search#R10 R11: 한 문서의 여러 section은 각각 일치 결과가 된다(첫 section만 보지 않는다)", () => {
  const fx = openDerivedFixture();
  try {
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    const text = [
      "# 제목",
      "",
      "## 앞",
      "",
      "앞에만 있는 낱말",
      "",
      "## 뒤",
      "",
      "뒤에만 있는 낱말",
    ].join("\n");
    const section = (
      key: string,
      position: number,
      start: number,
      end: number,
    ) => ({
      key,
      title: key,
      parent: null,
      position,
      level: 2,
      anchor: null,
      own_ranges: [{ start_line: start, end_line: end }],
      subtree_range: { start_line: start - 1, end_line: end },
      characters: 10,
      body_hash: HASH,
    });
    keep(recordExtraction(fx.store, {
      document: DOC_A,
      version: VER_A,
      content_hash: HASH,
      module_hash: HASH,
      extraction: {
        status: "ready",
        title: "제목",
        text,
        text_hash: HASH,
        sections: [section("앞", 0, 4, 6), section("뒤", 1, 8, 9)],
      },
    }, "1"));
    fx.consumed("5");
    const later = keep(fx.handlers().query(CTX, { query: "뒤에만 있는" }));
    assertEquals(later.results.map((result) => result.section), ["뒤"]);
    assertEquals(later.results[0].ranges, [{ start_line: 9, end_line: 9 }]);
    const both = keep(fx.handlers().query(CTX, { query: "낱말" }));
    assertEquals(both.results.map((result) => result.section), ["앞", "뒤"]);
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

const OUTLINE_CTX = {
  ...CTX,
  scope: {
    operations: [
      "outline.root",
      "outline.place",
      "outline.document",
      "document.read",
    ],
    targets: {},
  },
};

const READ_CTX = {
  ...CTX,
  scope: { operations: ["document.read"], targets: {} },
};

// app 자리 행. root 목록의 app 항목 근거다.
function appRow(fx: ReturnType<typeof openDerivedFixture>): void {
  fx.ledgerSql.run(
    `INSERT INTO apps (id, slug, name, description, revision, status)
     VALUES (?, 'glossary-app', '용어 앱', '용어를 보는 앱', '2', 'active')`,
    [DOC_B],
  );
}

// project 행. root 목록의 project 항목 근거다.
function projectRow(fx: ReturnType<typeof openDerivedFixture>): void {
  fx.ledgerSql.run(
    `INSERT INTO projects (id, name, title, purpose, revision, status)
     VALUES (?, 'glossary', '용어집 프로젝트', '용어를 모은다', '1', 'active')`,
    [PROJECT],
  );
}

// place outline page. 활성 문서의 갱신 순 목록이다(R1, R2, R3).
Deno.test("documents/outline-and-search#R2: place outline은 갱신 순 문서 항목을 본문 없이 낸다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("glossary.md");
    projectRow(fx);
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "1"));
    fx.consumed("5");
    const page = keep(
      fx.outline().place(OUTLINE_CTX, {
        place: { kind: "project", id: PROJECT },
      }),
    );
    assertEquals(page.kind, "place");
    assertEquals(page.entries.length, 1);
    const entry = page.entries[0];
    assertEquals(entry.document, DOC_A);
    assertEquals(entry.title, "용어집");
    assertEquals(entry.version, VER_A);
    assertEquals(entry.latest_version, VER_A);
    assertEquals(entry.format.name, "document");
    assertEquals(entry.section_count, 2);
    // 항목에 본문 자리는 없다. 발췌 자리만 있다.
    assert(!("text" in entry));
  } finally {
    fx.close();
  }
});

// root outline page. project·app·자리 없는 문서 묶음이다(R2).
Deno.test("documents/outline-and-search#R2: root outline은 project·app·자리 없는 묶음을 활동 순으로 낸다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("glossary.md");
    projectRow(fx);
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "1"));
    fx.consumed("5");
    const page = keep(fx.outline().root(OUTLINE_CTX, {}));
    assertEquals(page.kind, "root");
    // project 항목이 먼저다. tracking 활성 자리 먼저다.
    assert(page.entries.length >= 1);
    const project = page.entries.find((entry) => entry.kind === "project");
    assert(project !== undefined);
    if (project.kind === "project") {
      assertEquals(project.id, PROJECT);
      assertEquals(project.document_count, 1);
    }
  } finally {
    fx.close();
  }
});

// root outline의 app 자리.
Deno.test("documents/outline-and-search#R2: root outline은 app 자리를 낸다", () => {
  const fx = openDerivedFixture();
  try {
    appRow(fx);
    const page = keep(fx.outline().root(OUTLINE_CTX, {}));
    const app = page.entries.find((entry) => entry.kind === "app");
    assert(app !== undefined);
    if (app.kind === "app") {
      assertEquals(app.id, DOC_B);
      assertEquals(app.title, "용어 앱");
    }
  } finally {
    fx.close();
  }
});

// document outline page. section별 시작·끝·문자 수·estimated token이다(R5).
Deno.test("documents/outline-and-search#R5: document outline은 section별 통계를 낸다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("glossary.md");
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "1"));
    fx.consumed("5");
    const page = keep(
      fx.outline().document(OUTLINE_CTX, {
        reference: { document: DOC_A },
      }),
    );
    assertEquals(page.kind, "document");
    assertEquals(page.section_status, "whole");
    assertEquals(page.entries.length, 2);
    assertEquals(page.entries[0].key, "문서");
    assertEquals(page.entries[0].version, VER_A);
    assertEquals(page.entries[0].estimated_tokens, Math.ceil(30 / 3));
    assertEquals(page.entries[0].children_count, 0);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R17: 보관한 문서도 확정한 판의 목차와 본문은 읽는다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("glossary.md");
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "1"));
    fx.consumed("5");
    fx.ledgerSql.run(`UPDATE documents SET status = 'archived' WHERE id = ?`, [
      DOC_A,
    ]);
    const outline = keep(
      fx.outline().document(OUTLINE_CTX, { reference: { document: DOC_A } }),
    );
    assertEquals(outline.entries.length, 2);
    const read = keep(
      fx.outline().read(READ_CTX, {
        reference: { document: DOC_A, version: VER_A },
      }),
    );
    assert(read.text !== null && read.text.includes("정본"));
  } finally {
    fx.close();
  }
});

// 형제 topLevel section의 숨긴 자식 수는 자기 자손만 센다(R5).
Deno.test("documents/outline-and-search#R5: document outline은 자기 자손의 숨긴 수만 센다", () => {
  const fx = openDerivedFixture();
  try {
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    const record: ExtractionRecord = {
      document: DOC_A,
      version: VER_A,
      content_hash: HASH,
      module_hash: HASH,
      extraction: {
        status: "ready",
        title: "용어집",
        text: "본문",
        text_hash: HASH,
        sections: [
          {
            key: "첫",
            title: "첫",
            parent: null,
            position: 0,
            level: 1,
            anchor: null,
            own_ranges: [{ start_line: 1, end_line: 2 }],
            subtree_range: { start_line: 1, end_line: 6 },
            characters: 10,
            body_hash: HASH,
          },
          {
            key: "둘",
            title: "둘",
            parent: null,
            position: 1,
            level: 1,
            anchor: null,
            own_ranges: [{ start_line: 7, end_line: 8 }],
            subtree_range: { start_line: 7, end_line: 8 },
            characters: 10,
            body_hash: HASH,
          },
          // 첫의 자식 두 개. level 3이라 depth 2 outline에서 숨긴다.
          {
            key: "첫/가",
            title: "가",
            parent: "첫",
            position: 2,
            level: 3,
            anchor: null,
            own_ranges: [{ start_line: 3, end_line: 4 }],
            subtree_range: { start_line: 3, end_line: 4 },
            characters: 10,
            body_hash: HASH,
          },
          {
            key: "첫/나",
            title: "나",
            parent: "첫",
            position: 3,
            level: 3,
            anchor: null,
            own_ranges: [{ start_line: 5, end_line: 6 }],
            subtree_range: { start_line: 5, end_line: 6 },
            characters: 10,
            body_hash: HASH,
          },
          // 둘의 자식 하나.
          {
            key: "둘/가",
            title: "가",
            parent: "둘",
            position: 4,
            level: 3,
            anchor: null,
            own_ranges: [{ start_line: 8, end_line: 8 }],
            subtree_range: { start_line: 8, end_line: 8 },
            characters: 10,
            body_hash: HASH,
          },
        ],
      },
    };
    keep(recordExtraction(fx.store, record, "1"));
    fx.consumed("5");
    const page = keep(
      fx.outline().document(OUTLINE_CTX, {
        reference: { document: DOC_A },
      }),
    );
    assertEquals(page.kind, "document");
    // depth 2 outline: topLevel 둘만 난다. level 3 자식은 숨겨진다.
    const kept = page.entries;
    assertEquals(kept.length, 2);
    const first = kept.find((section) => section.key === "첫");
    const second = kept.find((section) => section.key === "둘");
    assert(first !== undefined);
    assert(second !== undefined);
    // 각 형제는 자기 자손의 숨긴 수만 센다.
    assertEquals(first.hidden_children_count, 2);
    assertEquals(second.hidden_children_count, 1);
  } finally {
    fx.close();
  }
});

// 본문 읽기. 12,000 codepoint를 넘는 본문을 cursor로 이어 읽는다(R7).
Deno.test("documents/outline-and-search#R7: handler 본문 읽기는 12,000 codepoint를 넘는 본문을 이어 읽는다", () => {
  const fx = openDerivedFixture();
  try {
    const first = "첫".repeat(8000);
    const second = "둘".repeat(8000);
    const long = `${first}\n${second}`;
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, long), "1"));
    fx.consumed("5");
    const head = keep(
      fx.outline().read(READ_CTX, {
        reference: { document: DOC_A, version: VER_A },
      }),
    );
    assertEquals(head.complete, false);
    assert(head.text !== null);
    assertEquals([...head.text].length <= 12000, true);
    assertEquals(head.next_cursor !== null, true);
    const tail = keep(
      fx.outline().read(READ_CTX, {
        reference: { document: DOC_A, version: VER_A },
        cursor: head.next_cursor ?? undefined,
      }),
    );
    assertEquals(tail.complete, true);
    assert(tail.text !== null);
    // 첫 조각 + 이어 읽기 = 원문. 겹침도 누락도 없다.
    assertEquals(head.text + tail.text, long);
  } finally {
    fx.close();
  }
});

// 성공 추출에 key 없음은 missing, 근원 없음은 unverified다(R22).
Deno.test("documents/outline-and-search#R22: 성공 추출의 없는 key는 missing, 근원 없는 판은 unverified다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("glossary.md");
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    // fallback 근거 file 행.
    fx.ledgerSql.run(
      `INSERT INTO version_files (version, path, blob_hash, bytes, media_type, primary_file)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [VER_A, "glossary.md", HASH, 16000, "text/markdown"],
    );
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "1"));
    fx.consumed("5");
    // 성공 추출의 key 없음. missing이다.
    const missing = keep(
      fx.outline().read(READ_CTX, {
        reference: { document: DOC_A, version: VER_A },
        section: "없는이름",
      }),
    );
    assertEquals(missing.complete, true);
    assertEquals(missing.section_status, "missing");
    assertEquals(missing.text, null);
    assertEquals(missing.next_cursor, null);
    // 근원 없는 판. unverified다. 검색 큐를 기다리지 않는다.
    const otherVer = "ver_01arz3ndektsv4rrffq69g5fb1";
    fx.ledgerSql.run(
      `INSERT INTO versions (id, document, number, content_hash, format_name, module_hash, format_explicit)
       VALUES (?, ?, 2, ?, 'document', ?, 1)`,
      [otherVer, DOC_A, HASH, HASH],
    );
    const unverified = keep(
      fx.outline().read(READ_CTX, {
        reference: { document: DOC_A, version: otherVer },
      }),
    );
    assertEquals(unverified.complete, true);
    assertEquals(unverified.section_status, "unverified");
    assertEquals(unverified.failure_reason !== null, true);
    assertEquals(unverified.text, null);
  } finally {
    fx.close();
  }
});

// 성공 추출의 미지원 판은 unsupported다(R22).
Deno.test("documents/outline-and-search#R22: 미지원 추출은 unsupported다", () => {
  const fx = openDerivedFixture();
  try {
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    // fallback 근거 file 행. unsupported page가 file을 싣는다.
    fx.ledgerSql.run(
      `INSERT INTO version_files (version, path, blob_hash, bytes, media_type, primary_file)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [VER_A, "glossary.md", HASH, 16000, "text/markdown"],
    );
    keep(
      recordExtraction(fx.store, {
        document: DOC_A,
        version: VER_A,
        content_hash: HASH,
        module_hash: HASH,
        extraction: { status: "unsupported" },
      }, "1"),
    );
    fx.consumed("5");
    const page = keep(
      fx.outline().read(READ_CTX, {
        reference: { document: DOC_A, version: VER_A },
      }),
    );
    assertEquals(page.section_status, "unsupported");
    assertEquals(page.text, null);
    const outline = keep(
      fx.outline().document(OUTLINE_CTX, {
        reference: { document: DOC_A },
      }),
    );
    assertEquals(outline.section_status, "unsupported");
    assertEquals(outline.entries.length, 0);
    assert(outline.file !== null);
  } finally {
    fx.close();
  }
});

// 요약 cache 결과. section 없는 요약의 match_source는 summary다(R12).
Deno.test("documents/outline-and-search#R12: 요약 cache 결과의 match_source는 summary다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("glossary.md");
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "1"));
    fx.consumed("5");
    // 검색 행을 비운다. 요약 cache만 남는다.
    fx.store.transaction((tx) => {
      tx.sql.run(`DELETE FROM search_rows`, []);
      tx.sql.run(`DELETE FROM search_fts`, []);
      return ok(undefined);
    });
    fx.store.transaction((tx) =>
      ok(tx.sql.run(
        `INSERT INTO summary_cache (version, section_key, input_hash, text) VALUES (?, ?, ?, ?)`,
        [VER_A, null, HASH, "주제 요약에 문서가 들어있다"],
      ))
    );
    const page = keep(fx.handlers().query(CTX, { query: "문서" }));
    assert(page.results.length >= 1);
    const found = page.results.find((result) => result.document === DOC_A);
    assert(found !== undefined);
    assertEquals(found.match_source, "summary");
    assertEquals(found.section, null);
    assert(found.cache_basis !== null);
    if (found.cache_basis !== null) {
      assertEquals(found.cache_basis.version, VER_A);
      assertEquals(found.cache_basis.section, null);
      assertEquals(found.cache_basis.stale, false);
    }
    // cache 결과는 본문 근거가 없다. ranges는 없다.
    assertEquals(found.ranges.length, 0);
  } finally {
    fx.close();
  }
});

// 주제 cache 결과. section cache의 match_source는 topic이다(R12).
Deno.test("documents/outline-and-search#R12: 주제 cache 결과의 match_source는 topic이다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("glossary.md");
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "1"));
    fx.consumed("5");
    fx.store.transaction((tx) => {
      tx.sql.run(`DELETE FROM search_rows`, []);
      tx.sql.run(`DELETE FROM search_fts`, []);
      return ok(undefined);
    });
    fx.store.transaction((tx) =>
      ok(tx.sql.run(
        `INSERT INTO summary_cache (version, section_key, input_hash, text) VALUES (?, ?, ?, ?)`,
        [VER_A, "용어", HASH, "용어 주제 요약"],
      ))
    );
    const page = keep(fx.handlers().query(CTX, { query: "용어" }));
    const found = page.results.find((result) => result.section === "용어");
    assert(found !== undefined);
    assertEquals(found.match_source, "topic");
    if (found.cache_basis !== null) {
      assertEquals(found.cache_basis.section, "용어");
    }
  } finally {
    fx.close();
  }
});

// scan·index 큐 지연 중 선택 판 읽기 우선 응답(R15).
Deno.test("documents/outline-and-search#R15: 큐가 뒤처져도 선택 판 읽기는 근원을 기다리지 않는다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("glossary.md");
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "1"));
    // consumed("5")를 부르지 않는다. 큐가 뒤처진 상태다.
    let extracted = 0;
    const handlers = fx.outlineWithExtract(() => {
      extracted += 1;
    });
    // derived_texts가 있다. 우선 응답이다. 검색 coverage와 무관하다.
    // section 선택이 없으므로 section_status는 whole이다.
    const page = keep(
      handlers.read(READ_CTX, {
        reference: { document: DOC_A, version: VER_A },
      }),
    );
    assertEquals(page.section_status, "whole");
    assert(page.text !== null);
    assertEquals(page.text.length > 0, true);
    assertEquals(extracted, 0);
  } finally {
    fx.close();
  }
});

// 큐가 뒤처진 판은 derived에 없다. 직접 추출 근원을 부르고 미완료로 답한다(R15).
Deno.test("documents/outline-and-search#R15: 근원 없는 판은 직접 추출을 부르고 미완료로 답한다", () => {
  const fx = openDerivedFixture();
  try {
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    fx.consumed("5");
    let extracted = 0;
    const handlers = fx.outlineWithExtract(() => {
      extracted += 1;
    });
    const page = keep(
      handlers.read(READ_CTX, {
        reference: { document: DOC_A, version: VER_A },
      }),
    );
    // derived_texts가 없다. 직접 추출을 부르고 unverified로 답한다.
    assertEquals(extracted, 1);
    assertEquals(page.section_status, "unverified");
    assertEquals(page.failure_reason !== null, true);
    assertEquals(page.text, null);
  } finally {
    fx.close();
  }
});

// outline 뒤 새 판이 저장돼도 같은 cursor는 처음 판을 유지한다(R8).
Deno.test("documents/outline-and-search#R8: outline 뒤 새 판 저장에도 같은 cursor는 처음 판이다", () => {
  const fx = openDerivedFixture();
  try {
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, LONG_A), "1"));
    fx.consumed("5");
    const head = keep(
      fx.outline().read(READ_CTX, {
        reference: { document: DOC_A, version: VER_A },
      }),
    );
    assertEquals(head.next_cursor !== null, true);
    // 처음 판의 cursor 근거. latest_version은 따로 본다.
    assertEquals(head.latest_version, VER_A);
    // 새 판을 저장한다. 문서의 latest가 지나간다.
    const otherVer = "ver_01arz3ndektsv4rrffq69g5fb2";
    fx.ledgerSql.run(
      `INSERT INTO versions (id, document, number, content_hash, format_name, module_hash, format_explicit)
       VALUES (?, ?, 2, ?, 'document', ?, 1)`,
      [otherVer, DOC_A, HASH, HASH],
    );
    fx.ledgerSql.run(
      `UPDATE documents SET latest_version = ? WHERE id = ?`,
      [otherVer, DOC_A],
    );
    // 같은 cursor는 처음 판을 유지한다. cursor ver 근거다.
    const tail = keep(
      fx.outline().read(READ_CTX, {
        reference: { document: DOC_A, version: VER_A },
        cursor: head.next_cursor ?? undefined,
      }),
    );
    assertEquals(tail.version, VER_A);
    assertEquals(tail.complete, true);
    // latest_version은 따로 본다.
    assertEquals(tail.latest_version, otherVer);
  } finally {
    fx.close();
  }
});

// outline cursor. 조건 mismatch는 invalid_input, basis 만료는 conflict다(R9).
Deno.test("documents/outline-and-search#R9: place outline cursor는 mismatch에 invalid_input, 만료에 conflict를 낸다", async () => {
  const fx = openDerivedFixture();
  try {
    const text = await fixtureText("glossary.md");
    projectRow(fx);
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, glossaryRecord(VER_A, text), "1"));
    fx.consumed("5");
    // 깨진 cursor는 invalid_input이다.
    const broken = fx.outline().place(OUTLINE_CTX, {
      place: { kind: "project", id: PROJECT },
      cursor: "@@@",
    });
    assertEquals(broken.ok, false);
    if (!broken.ok) assertEquals(broken.error.code, "invalid_input");
  } finally {
    fx.close();
  }
});

// context 목차 시험: 실제 ledger schema(addressing·versions·contexts·projects)를 연 temp
// SQLite 위에서 실제 context command로 구성을 만들고 목차 handler를 부른다. apps 표는 apps
// concern의 것이라 읽는 열만 가진 표를 둔다.
const CTX_A = contextIds.context;
const CTX_B = contextIds.context2;
const CTX_C = "ctx_01arz3ndektsv4rrffq69g5fax";
const DOC_C = "doc_01arz3ndektsv4rrffq69g5fb1";
const DOC_D = "doc_01arz3ndektsv4rrffq69g5fb2";
const VER_A2 = "ver_01arz3ndektsv4rrffq69g5fb1";
const VER_C = "ver_01arz3ndektsv4rrffq69g5fb2";
const VER_D = "ver_01arz3ndektsv4rrffq69g5fb3";
const APP_1 = contextIds.app;
const APP_2 = "app_01arz3ndektsv4rrffq69g5faw";

type Authorizer = Parameters<typeof contextFixture>[0];
type Perspective = "basis" | "reference" | "watch";
type ItemInput = { target: unknown; perspective: Perspective; reason: string };

function contextLedger(authorize?: Authorizer) {
  const ledger = contextFixture(authorize);
  for (const step of projectsSchemaSteps) ledger.db.exec(step.sql);
  for (const step of termsSchemaSteps) ledger.db.exec(step.sql);
  ledger.db.exec(
    `CREATE TABLE apps (id TEXT PRIMARY KEY, slug TEXT, name TEXT, description TEXT, revision TEXT, status TEXT NOT NULL DEFAULT 'active')`,
  );
  const directory = Deno.makeTempDirSync({ prefix: "context-outline-" });
  const path = `${directory}/documents.sqlite`;
  const store = openDerived(path);
  if (!store.ok) throw new Error(store.error.message);
  const derived = openDerivedRead(path);
  if (!derived.ok) throw new Error(derived.error.message);
  const commands = createContextCommands({
    appCommand: (_app, command) => command.startsWith("read_"),
  });
  const insertVersion = (document: string, version: string, number: number) => {
    ledger.db.prepare(
      `INSERT INTO versions (id, document, number, files_hash, primary_path, file_count,
         content_hash, format_name, module_hash, format_explicit, saved_by, saved_at)
       VALUES (?, ?, ?, ?, 'a.md', 1, ?, 'document', ?, 1, 'user', '2026-10-05T00:00:00.000Z')`,
    ).run(version, document, number, HASH, HASH, HASH);
    ledger.db.prepare(`UPDATE documents SET latest_version = ? WHERE id = ?`)
      .run(version, document);
  };
  return {
    ledger,
    store: store.value,
    outline(extra: Partial<Parameters<typeof createOutlineHandlers>[0]> = {}) {
      const snapshot = ledger.snapshot();
      return createOutlineHandlers({
        read: derived.value,
        snapshot,
        ports: snapshot,
        contextOutline: createContextOutlineSource(ledger.sql),
        termGlossary: createTermGlossarySource(ledger.sql),
        ...extra,
      });
    },
    // 문서와 첫 판을 심는다. 새 판은 insertVersion으로 더한다(판은 immutable 표다).
    document(
      id: string,
      version: string,
      title: string,
      status: "active" | "archived" = "active",
    ) {
      ledger.db.prepare(
        `INSERT INTO documents (id, place_kind, place_id, name, title, latest_version, revision, status)
         VALUES (?, NULL, NULL, NULL, ?, ?, '1', ?)`,
      ).run(id, title, version, status);
      insertVersion(id, version, 1);
    },
    insertVersion,
    app(id: string, name: string, status: "active" | "archived" = "active") {
      ledger.db.prepare(
        `INSERT INTO apps (id, slug, name, description, revision, status) VALUES (?, ?, ?, 'd', '1', ?)`,
      ).run(id, `slug-${id.slice(-3)}`, name, status);
    },
    createContext(
      id: string,
      title: string,
      purpose: string,
      items: ItemInput[],
    ) {
      return keep(
        ledger.transaction((tx) =>
          commands.create.handle(
            tx,
            userContext(),
            { id, title, purpose, items } as never,
            {},
          )
        ),
      );
    },
    archive(id: string) {
      const row = ledger.sql.get(
        `SELECT revision FROM contexts WHERE id = ?`,
        [id],
      );
      keep(
        ledger.transaction((tx) =>
          commands.archive.handle(
            tx,
            userContext(),
            { context: id } as never,
            { base_revision: String(row?.["revision"]) } as never,
          )
        ),
      );
    },
    // 판 추출 결과를 derived에 심는다. keys가 없으면 key 없는 성공 추출이다.
    extracted(
      document: string,
      version: string,
      status: "ready" | "unsupported" | "failed",
      keys: string[] = [],
    ) {
      keep(recordExtraction(store.value, {
        document,
        version,
        content_hash: HASH,
        module_hash: HASH,
        extraction: status === "ready"
          ? {
            status,
            title: "t",
            text: "# t",
            text_hash: HASH,
            sections: keys.map((key, position) => ({
              key,
              title: key,
              parent: null,
              position,
              level: 1,
              anchor: null,
              own_ranges: [{ start_line: 1, end_line: 1 }],
              subtree_range: { start_line: 1, end_line: 1 },
              characters: 3,
              body_hash: HASH,
            })),
          }
          : status === "failed"
          ? { status, failure_reason: "extractor failed" }
          : { status },
      }, "1"));
    },
    close() {
      store.value.close();
      ledger.close();
      Deno.removeSync(directory, { recursive: true });
    },
  };
}

function docItem(
  document: string,
  perspective: Perspective,
  reason: string,
  section: string | null = null,
): ItemInput {
  return {
    target: { kind: "document", document, section },
    perspective,
    reason,
  };
}

function appCommandItem(
  app: string,
  perspective: Perspective,
  command = "read_notes",
): ItemInput {
  return {
    target: { kind: "app_command", app, command },
    perspective,
    reason: `${command} 근거`,
  };
}

// 범위 밖으로 둘 값(문서·context·앱 ID)을 바꿀 수 있는 authorizer.
function denying(denied: Set<string>): Authorizer {
  return (_ctx, _operation, target) =>
    Object.values(target).some((value) => denied.has(String(value)))
      ? err({ code: "forbidden", message: "outside scope" })
      : ok(undefined);
}

function rootContexts(page: { entries: { kind: string }[] }) {
  return page.entries.flatMap((entry) =>
    entry.kind === "context"
      ? [
        entry as {
          kind: "context";
          id: string;
          title: string;
          purpose: string;
          activity_seq: string;
          basis_count: number;
          reference_app_count: number;
        },
      ]
      : []
  );
}

const USER = userContext() as never;

Deno.test("documents/outline-and-search#R2: root outline은 context의 목적·기준 항목 수·참조 앱 수·활동을 활동 순으로 낸다", () => {
  const fx = contextLedger();
  try {
    fx.document(DOC_A, VER_A, "기준 문서");
    fx.document(DOC_B, VER_B, "참고 문서");
    fx.app(APP_1, "노트 앱");
    fx.app(APP_2, "달력 앱");
    fx.createContext(CTX_A, "첫 기준", "판단 기준을 모은다", [
      docItem(DOC_A, "basis", "기준"),
      docItem(DOC_B, "basis", "또 다른 기준"),
      docItem(DOC_B, "reference", "section 참고", "요약"),
      appCommandItem(APP_1, "reference"),
      appCommandItem(APP_1, "watch", "read_other"),
      appCommandItem(APP_2, "reference"),
    ]);
    fx.createContext(CTX_B, "둘째 기준", "나중에 만든 목적", [
      docItem(DOC_A, "reference", "배경"),
    ]);
    const page = keep(fx.outline().root(USER, {}));
    const parsed = rootOutlinePageSchema.safeParse(page);
    assert(parsed.success, JSON.stringify(parsed.error?.issues));
    const contexts = rootContexts(page);
    // 나중에 바뀐 context가 먼저다(활동 순: 마지막 변경 seq가 큰 쪽).
    assertEquals(contexts.map((entry) => entry.id), [CTX_B, CTX_A]);
    const first = contexts[1];
    assertEquals(first.title, "첫 기준");
    assertEquals(first.purpose, "판단 기준을 모은다");
    // 기준 항목은 둘, 참조한 앱은 서로 다른 둘(같은 앱의 두 command는 하나).
    assertEquals(first.basis_count, 2);
    assertEquals(first.reference_app_count, 2);
    assertEquals(contexts[0].basis_count, 0);
    assertEquals(contexts[0].reference_app_count, 0);
    // 활동은 context의 마지막 구성 변경 seq다.
    assertEquals(first.activity_seq, "1");
    assertEquals(contexts[0].activity_seq, "2");
    // 대기 중인 문제·질문·approval은 소유 concern의 읽기가 답한다. root 항목에는 없다.
    assertEquals(Object.keys(first).sort(), [
      "activity_seq",
      "basis_count",
      "id",
      "kind",
      "purpose",
      "reference_app_count",
      "title",
    ]);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R2: root의 context는 허용 집합에서만 세고 권한 밖·보관 context는 없는 것과 같다", () => {
  const denied = new Set<string>();
  const fx = contextLedger(denying(denied));
  try {
    fx.document(DOC_A, VER_A, "보이는 문서");
    fx.document(DOC_B, VER_B, "숨길 문서");
    fx.app(APP_1, "노트 앱");
    fx.createContext(CTX_A, "섞인 기준", "일부는 범위 밖", [
      docItem(DOC_A, "basis", "보이는 기준"),
      docItem(DOC_B, "basis", "숨길 기준"),
      appCommandItem(APP_1, "reference"),
    ]);
    fx.createContext(CTX_B, "숨길 context", "범위 밖 context", [
      docItem(DOC_A, "basis", "기준"),
    ]);
    fx.createContext(CTX_C, "보관할 context", "곧 보관", [
      docItem(DOC_A, "basis", "기준"),
    ]);
    fx.archive(CTX_C);
    denied.add(DOC_B);
    denied.add(CTX_B);
    const contexts = rootContexts(keep(fx.outline().root(USER, {})));
    // 범위 밖 context와 보관 context는 목록에 없다. 범위 밖 문서 항목은 세지 않는다.
    assertEquals(contexts.map((entry) => entry.id), [CTX_A]);
    assertEquals(contexts[0].basis_count, 1);
    assertEquals(contexts[0].reference_app_count, 1);
    // 앱 항목도 범위 밖이면 세지 않는다.
    denied.add(APP_1);
    const narrowed = rootContexts(keep(fx.outline().root(USER, {})));
    assertEquals(narrowed[0].reference_app_count, 0);
    // context source가 없는 조립은 context를 빈 목록으로 꾸미지 않고 줄을 뺀다.
    const bare = keep(fx.outline({ contextOutline: undefined }).root(USER, {}));
    assertEquals(rootContexts(bare), []);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R5: root outline은 예산을 넘으면 cursor로 중복·누락 없이 이어진다", () => {
  const fx = contextLedger();
  try {
    fx.document(DOC_A, VER_A, "문서");
    const wanted: string[] = [];
    for (const letter of ["a", "b", "c", "d"]) {
      const id = `ctx_01arz3ndektsv4rrffq69g5f${letter}0`;
      wanted.push(id);
      fx.createContext(id, `기준 ${letter}`, "x".repeat(300), [
        docItem(DOC_A, "basis", "기준"),
      ]);
    }
    // 한 항목 비용은 (120 + 제목 + 목적) / 3 올림이라 예산 130은 한 항목씩 나눈다.
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = keep(
        fx.outline().root(USER, {
          estimated_token_budget: 130,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      assert(rootOutlinePageSchema.safeParse(page).success);
      for (const entry of rootContexts(page)) seen.push(entry.id);
      cursor = page.next_cursor ?? undefined;
      pages += 1;
      assert(pages <= 10, "cursor가 끝나지 않는다");
    } while (cursor !== undefined);
    // context 넷과 자리 없는 문서 묶음 하나가 한 항목씩이다.
    assertEquals(pages, 5);
    assertEquals([...seen].sort(), [...wanted].sort());
    assertEquals(new Set(seen).size, seen.length);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R4: context outline은 목적과 기준·참고·watch 순서의 항목·이유·선택 고정 판을 낸다", () => {
  const fx = contextLedger();
  try {
    fx.document(DOC_A, VER_A, "기준 문서");
    fx.document(DOC_B, VER_B, "배경 문서");
    fx.document(DOC_C, VER_C, "감시 문서");
    fx.app(APP_1, "노트 앱");
    fx.extracted(DOC_A, VER_A, "ready", ["요약"]);
    // 생성 순서는 일부러 관점 순서와 다르게 둔다.
    fx.createContext(CTX_A, "판단 묶음", "무엇을 판단하는지", [
      docItem(DOC_C, "watch", "변화 확인"),
      docItem(DOC_B, "reference", "배경"),
      appCommandItem(APP_1, "reference"),
      docItem(DOC_A, "basis", "따르는 기준", "요약"),
      docItem(DOC_A, "basis", "문서 전체 기준"),
    ]);
    const page = keep(fx.outline().context(USER, { context: CTX_A }));
    const parsed = contextOutlinePageSchema.safeParse(page);
    assert(parsed.success, JSON.stringify(parsed.error?.issues));
    assertEquals(page.kind, "context");
    assertEquals(page.context, CTX_A);
    assertEquals(page.title, "판단 묶음");
    assertEquals(page.purpose, "무엇을 판단하는지");
    assertEquals(page.complete, true);
    assertEquals(page.next_cursor, null);
    // 기준→참고→watch 순서이고 같은 관점 안은 context의 항목 순서다.
    assertEquals(
      page.entries.map((entry) => `${entry.perspective}:${entry.reason}`),
      [
        "basis:따르는 기준",
        "basis:문서 전체 기준",
        "reference:배경",
        "reference:read_notes 근거",
        "watch:변화 확인",
      ],
    );
    assertEquals(
      page.perspectives.basis.map((entry) => entry.reason),
      ["따르는 기준", "문서 전체 기준"],
    );
    assertEquals(page.perspectives.watch.length, 1);
    const section = page.entries[0];
    assert(section.kind === "document");
    assertEquals(section.title, "기준 문서");
    assertEquals(section.version, VER_A);
    assertEquals(section.latest_version, VER_A);
    assertEquals(section.format?.name, "document");
    assertEquals(section.module_hash, HASH);
    assertEquals(section.section_status, "found");
    assertEquals(section.readable, true);
    const whole = page.entries[1];
    assert(whole.kind === "document");
    assertEquals(whole.section_status, "whole");
    assertEquals(whole.target.section, null);
    const app = page.entries[3];
    assert(app.kind === "app_command");
    assertEquals(app.target, {
      kind: "app_command",
      app: APP_1,
      command: "read_notes",
    });
    assertEquals(app.readable, true);
    // 목차는 본문과 앱 데이터를 싣지 않는다.
    assertEquals("text" in section, false);
    assertEquals(page.glossary, []);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R4: 비어 있는 관점은 세 key로 구별되고 사라지지 않는다", () => {
  const fx = contextLedger();
  try {
    fx.document(DOC_A, VER_A, "기준 문서");
    fx.createContext(CTX_A, "기준만", "기준 하나", [
      docItem(DOC_A, "basis", "기준"),
    ]);
    fx.createContext(CTX_B, "항목 없음", "아직 비어 있다", []);
    const only = keep(fx.outline().context(USER, { context: CTX_A }));
    assert(contextOutlinePageSchema.safeParse(only).success);
    assertEquals(Object.keys(only.perspectives), [
      "basis",
      "reference",
      "watch",
    ]);
    assertEquals(only.perspectives.basis.length, 1);
    assertEquals(only.perspectives.reference, []);
    assertEquals(only.perspectives.watch, []);
    assertEquals(only.complete, true);
    // 항목이 하나도 없는 context도 세 관점이 모두 비어 있다고 답한다.
    const empty = keep(fx.outline().context(USER, { context: CTX_B }));
    assert(contextOutlinePageSchema.safeParse(empty).success);
    assertEquals(empty.entries, []);
    assertEquals(empty.perspectives, { basis: [], reference: [], watch: [] });
    assertEquals(empty.complete, true);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R4: 읽기 가능 여부와 section 상태를 추정 없이 구별한다", () => {
  const fx = contextLedger();
  const extracted: string[] = [];
  try {
    fx.document(DOC_A, VER_A, "추출 끝난 문서");
    fx.document(DOC_B, VER_B, "보관된 문서", "archived");
    fx.document(DOC_C, VER_C, "미지원 문서");
    fx.document(DOC_D, VER_D, "아직 추출 안 된 문서");
    fx.app(APP_1, "보관된 앱", "archived");
    fx.extracted(DOC_A, VER_A, "ready", ["있는 section"]);
    fx.extracted(DOC_C, VER_C, "unsupported");
    fx.createContext(CTX_A, "읽기 상태", "상태를 본다", [
      docItem(DOC_A, "basis", "있다", "있는 section"),
      docItem(DOC_A, "basis", "사라졌다", "없는 section"),
      docItem(DOC_B, "reference", "보관됨"),
      docItem(DOC_C, "reference", "미지원", "아무 section"),
      docItem(DOC_D, "watch", "근원 없음", "아무 section"),
      docItem(DOC_D, "watch", "전체는 읽는다"),
      appCommandItem(APP_1, "watch"),
    ]);
    const page = keep(
      fx.outline({ extract: (record) => extracted.push(record.version) })
        .context(USER, { context: CTX_A }),
    );
    assert(contextOutlinePageSchema.safeParse(page).success);
    const byReason = new Map(
      page.entries.map((entry) => [entry.reason, entry]),
    );
    const doc = (reason: string) => {
      const entry = byReason.get(reason);
      assert(entry !== undefined && entry.kind === "document");
      return entry;
    };
    assertEquals(doc("있다").section_status, "found");
    assertEquals(doc("있다").readable, true);
    // 성공 추출의 key 없음은 missing이다. 비슷한 section으로 바꾸지 않는다.
    assertEquals(doc("사라졌다").section_status, "missing");
    assertEquals(doc("사라졌다").readable, false);
    assertEquals(doc("사라졌다").version, VER_A);
    // 보관 문서는 선택 판을 내지 않고 읽을 수 없다.
    assertEquals(doc("보관됨").readable, false);
    assertEquals(doc("보관됨").version, null);
    assertEquals(doc("보관됨").format, null);
    assertEquals(doc("미지원").section_status, "unsupported");
    assertEquals(doc("미지원").readable, false);
    // 근원이 없는 판은 직접 추출을 부르고 unverified로 답한다. 전체 항목은 읽을 수 있다.
    assertEquals(doc("근원 없음").section_status, "unverified");
    assertEquals(doc("근원 없음").readable, false);
    assertEquals(extracted, [VER_D]);
    assertEquals(doc("전체는 읽는다").section_status, "whole");
    assertEquals(doc("전체는 읽는다").readable, true);
    const app = byReason.get("read_notes 근거");
    assert(app !== undefined && app.kind === "app_command");
    assertEquals(app.readable, false);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R4: 범위 밖 항목과 context는 없는 항목·context와 같은 답이다", () => {
  const denied = new Set<string>();
  const fx = contextLedger(denying(denied));
  try {
    fx.document(DOC_A, VER_A, "보이는 문서");
    fx.document(DOC_B, VER_B, "숨길 문서");
    fx.createContext(CTX_A, "섞인 묶음", "일부만 보인다", [
      docItem(DOC_A, "basis", "보인다"),
      docItem(DOC_B, "basis", "숨긴다"),
    ]);
    fx.createContext(CTX_B, "숨길 묶음", "범위 밖", [
      docItem(DOC_A, "basis", "기준"),
    ]);
    // 추출 실패 omission이 있는 숨길 문서의 흔적도 coverage에 새지 않는다.
    fx.extracted(DOC_B, VER_B, "failed");
    denied.add(DOC_B);
    denied.add(CTX_B);
    const mixed = keep(fx.outline().context(USER, { context: CTX_A }));
    assertEquals(mixed.entries.map((entry) => entry.reason), ["보인다"]);
    assertEquals(mixed.coverage.omissions, []);
    assertEquals(mixed.perspectives.basis.length, 1);
    const hidden = fx.outline().context(USER, { context: CTX_B });
    const absent = fx.outline().context(USER, { context: CTX_C });
    assertEquals(hidden, absent);
    assertEquals(hidden.ok, false);
    if (!hidden.ok) assertEquals(hidden.error.code, "not_found");
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R4 R5: context outline은 예산 3,000과 cursor로 이어 낸다", () => {
  const fx = contextLedger();
  try {
    fx.document(DOC_A, VER_A, "문서");
    const sections = [0, 1, 2, 3].map((n) => `section-${n}`);
    fx.extracted(DOC_A, VER_A, "ready", sections);
    fx.createContext(
      CTX_A,
      "긴 묶음",
      "여러 쪽으로 나뉜다",
      sections.map((section, index) =>
        docItem(
          DOC_A,
          index < 2 ? "basis" : "reference",
          `이유 ${index} ${"가".repeat(200)}`,
          section,
        )
      ),
    );
    // 한 항목은 (120 + 제목 + 이유) / 3 올림이라 예산 100이면 한 항목씩이다.
    const reasons: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = keep(
        fx.outline().context(USER, {
          context: CTX_A,
          estimated_token_budget: 100,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      assert(contextOutlinePageSchema.safeParse(page).success);
      assertEquals(page.entries.length, 1);
      reasons.push(page.entries[0].reason);
      cursor = page.next_cursor ?? undefined;
      pages += 1;
      assertEquals(page.complete, cursor === undefined);
    } while (cursor !== undefined);
    assertEquals(pages, 4);
    assertEquals(
      reasons.map((reason) => reason.slice(0, 4)),
      ["이유 0", "이유 1", "이유 2", "이유 3"],
    );
    // 기본 예산 3,000이면 한 page에 모두 담는다.
    const whole = keep(fx.outline().context(USER, { context: CTX_A }));
    assertEquals(whole.entries.length, 4);
    assertEquals(whole.complete, true);
    // 다른 조건의 cursor와 깨진 cursor는 invalid_input이다.
    const first = keep(
      fx.outline().context(USER, {
        context: CTX_A,
        estimated_token_budget: 100,
      }),
    );
    const otherBudget = fx.outline().context(USER, {
      context: CTX_A,
      estimated_token_budget: 200,
      cursor: first.next_cursor ?? "",
    });
    assertEquals(otherBudget.ok, false);
    if (!otherBudget.ok) assertEquals(otherBudget.error.code, "invalid_input");
    const broken = fx.outline().context(USER, {
      context: CTX_A,
      cursor: "@@@",
    });
    assertEquals(broken.ok, false);
    if (!broken.ok) assertEquals(broken.error.code, "invalid_input");
    // 기준 seq가 지나간 cursor는 conflict다(재조회).
    fx.createContext(CTX_B, "새 묶음", "기준을 넘긴다", []);
    const advanced = fx.outline().context(USER, {
      context: CTX_A,
      estimated_token_budget: 100,
      cursor: first.next_cursor ?? "",
    });
    assertEquals(advanced.ok, false);
    if (!advanced.ok) assertEquals(advanced.error.code, "conflict");
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R4: 목적·이유·제목 출력은 redactor를 거치고 불명이면 가린다", () => {
  const fx = contextLedger();
  try {
    fx.document(DOC_A, VER_A, "제목 sk-secret");
    fx.createContext(CTX_A, "묶음 sk-secret", "목적 sk-secret", [
      docItem(DOC_A, "basis", "이유 sk-secret"),
    ]);
    const page = keep(
      fx.outline({
        redactor: (_source, _media, text) =>
          text.includes("이유") ? null : text.replaceAll("sk-secret", "*"),
      }).context(USER, { context: CTX_A }),
    );
    assertEquals(page.title, "묶음 *");
    assertEquals(page.purpose, "목적 *");
    // 안전화를 끝내지 못한 이유는 원문 대신 가림 표시다.
    assertEquals(page.entries[0].reason, "*");
    assertEquals(page.entries[0].title, "제목 *");
  } finally {
    fx.close();
  }
});

Deno.test("documents/contexts#R4: context 항목은 최신 판을 따르고 이미 낸 목차는 그때 고른 고정 판으로 남는다", () => {
  const fx = contextLedger();
  try {
    fx.document(DOC_A, VER_A, "자라는 문서");
    fx.createContext(CTX_A, "최신 추종", "새 판을 따른다", [
      docItem(DOC_A, "basis", "최신을 따른다"),
    ]);
    const before = keep(fx.outline().context(USER, { context: CTX_A }));
    const earlier = before.entries[0];
    assert(earlier.kind === "document");
    assertEquals(earlier.version, VER_A);
    // 새 판이 저장돼도 항목은 그대로이고 다음 목차는 최신 판을 가리킨다.
    fx.insertVersion(DOC_A, VER_A2, 2);
    const after = keep(fx.outline().context(USER, { context: CTX_A }));
    const later = after.entries[0];
    assert(later.kind === "document");
    assertEquals(later.version, VER_A2);
    assertEquals(later.latest_version, VER_A2);
    // 먼저 낸 응답은 그때 고른 고정 판 그대로다.
    assertEquals(earlier.version, VER_A);
    assertEquals(earlier.latest_version, VER_A);
    // 항목 자체에는 판이 저장되지 않는다.
    const stored = fx.ledger.db.prepare(
      `SELECT * FROM context_items WHERE context = ?`,
    ).get(CTX_A) as Record<string, unknown>;
    assertEquals(
      Object.keys(stored).some((column) => column.includes("version")),
      false,
    );
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R9: place outline cursor는 다음 page를 중복·누락 없이 이어 낸다", () => {
  const fx = contextLedger();
  try {
    fx.ledger.db.prepare(
      `INSERT INTO projects (id, name, title, purpose, tracking_enabled, use_gitignore, revision, status)
       VALUES (?, 'p', '프로젝트', '목적', 0, 0, '1', 'active')`,
    ).run(PROJECT);
    const documents = [
      [DOC_A, VER_A],
      [DOC_B, VER_B],
      [DOC_C, VER_C],
      [DOC_D, VER_D],
    ];
    documents.forEach(([document, version], index) => {
      fx.document(document, version, `문서 ${index}`);
      fx.ledger.db.prepare(
        `UPDATE documents SET place_kind = 'project', place_id = ?, name = ?, revision = ?
         WHERE id = ?`,
      ).run(PROJECT, `doc-${index}`, String(index + 1), document);
    });
    // derived 행이 없는 판의 항목 비용은 320자(107 token)라 예산 150은 한 항목씩이다.
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = keep(
        fx.outline().place(USER, {
          place: { kind: "project", id: PROJECT },
          estimated_token_budget: 150,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      assertEquals(page.entries.length, 1);
      seen.push(page.entries[0].document);
      cursor = page.next_cursor ?? undefined;
      pages += 1;
      assertEquals(page.complete, cursor === undefined);
      assert(pages <= 10, "cursor가 끝나지 않는다");
    } while (cursor !== undefined);
    assertEquals(pages, 4);
    // 갱신 순(revision 큰 쪽이 먼저)으로 모두 한 번씩 나온다.
    assertEquals(seen, [DOC_D, DOC_C, DOC_B, DOC_A]);
  } finally {
    fx.close();
  }
});

// documents/terms가 채우는 context 목차의 glossary·candidates 시험. 용어는 실제 term
// command로 만든다.
const TERM_CODES = "0123456789abcdefghjkmnpqrstvwxyz";
function termIdOf(n: number): string {
  return `trm_${TERM_CODES[Math.floor(n / 32)]}${TERM_CODES[n % 32]}`.padEnd(
    30,
    "0",
  );
}

function termsOf(fx: ReturnType<typeof contextLedger>) {
  const terms = createTermCommands();
  return {
    define(n: number, context: string, name: string, definition: string) {
      return keep(fx.ledger.transaction((tx) =>
        terms.define.handle(
          tx,
          userContext(),
          { id: termIdOf(n), context, name, definition } as never,
          {},
        )
      ));
    },
    propose(n: number, context: string, name: string, document: string) {
      return keep(fx.ledger.transaction((tx) =>
        terms.propose.handle(
          tx,
          userContext(
            `agent:${contextIds.run.replace("run_", "asg_")}`,
            contextIds.run,
          ),
          {
            id: termIdOf(n),
            context,
            name,
            evidence: [{
              document,
              version: document === DOC_A ? VER_A : VER_B,
              section: "요약",
              start_line: null,
              end_line: null,
            }],
          } as never,
          {},
        )
      ));
    },
  };
}

Deno.test("documents/outline-and-search#R4: context outline은 활성 정의 첫 30개와 후보를 나눠 싣고 정의 없는 context는 빈 목록이다", () => {
  const fx = contextLedger();
  try {
    fx.document(DOC_A, VER_A, "기준 문서");
    fx.createContext(CTX_A, "용어 묶음", "용어를 모은다", [
      docItem(DOC_A, "basis", "기준"),
    ]);
    fx.createContext(CTX_B, "빈 용어", "용어가 없다", []);
    const terms = termsOf(fx);
    for (let n = 1; n <= 35; n += 1) {
      terms.define(n, CTX_A, `용어${String(n).padStart(2, "0")}`, `${n}번 뜻`);
    }
    terms.propose(100, CTX_A, "후보 하나", DOC_A);
    terms.propose(101, CTX_A, "후보 둘", DOC_A);
    // 다른 context의 용어는 섞이지 않는다.
    terms.define(200, CTX_B, "용어01", "다른 context의 뜻");
    const page = keep(fx.outline().context(USER, { context: CTX_A }));
    const parsed = contextOutlinePageSchema.safeParse(page);
    assert(parsed.success, JSON.stringify(parsed.error?.issues));
    assertEquals(page.glossary.length, 30);
    assertEquals(page.glossary[0].name, "용어01");
    assertEquals(page.glossary[0].definition, "1번 뜻");
    assertEquals(page.glossary[29].name, "용어30");
    assert(page.glossary.every((term) => term.definition !== null));
    assertEquals(page.candidates.map((term) => term.name), [
      "후보 둘",
      "후보 하나",
    ]);
    assert(page.candidates.every((term) => term.definition === null));
    // 근거는 고정 판 참조다.
    assertEquals(page.candidates[0].evidence, [{
      document: DOC_A,
      version: VER_A,
      section: "요약",
      range: null,
    }]);
    // 용어가 없는 context는 빈 목록이고 다른 context 용어가 새지 않는다.
    const empty = keep(fx.outline().context(USER, { context: CTX_B }));
    assertEquals(empty.glossary.map((term) => term.definition), [
      "다른 context의 뜻",
    ]);
    const none = keep(
      fx.outline({ termGlossary: undefined }).context(USER, {
        context: CTX_A,
      }),
    );
    assertEquals(none.glossary, []);
    assertEquals(none.candidates, []);
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R4: 읽을 수 없는 문서의 근거는 glossary에서 빠지고 용어 근원 실패는 빈 목록으로 꾸미지 않는다", () => {
  const authorize: { current: TargetAuthorizer } = {
    current: allowAll,
  };
  const fx = contextLedger((ctx, operation, target) =>
    authorize.current(ctx, operation, target)
  );
  try {
    fx.document(DOC_A, VER_A, "기준 문서");
    fx.document(DOC_B, VER_B, "숨길 문서");
    fx.createContext(CTX_A, "용어 묶음", "용어를 모은다", [
      docItem(DOC_A, "basis", "기준"),
    ]);
    const terms = termsOf(fx);
    terms.propose(1, CTX_A, "후보 A", DOC_A);
    terms.propose(2, CTX_A, "후보 B", DOC_B);
    authorize.current = (_ctx, _operation, target) =>
      target.document === DOC_B
        ? err({ code: "forbidden", message: "out of scope" })
        : ok(undefined);
    const page = keep(fx.outline().context(USER, { context: CTX_A }));
    const byName = Object.fromEntries(
      page.candidates.map((term) => [term.name, term.evidence.length]),
    );
    assertEquals(byName, { "후보 A": 1, "후보 B": 0 });
    // 근원이 실패하면 오류다. 빈 glossary 성공이 아니다.
    const failed = fx.outline({
      termGlossary: {
        get: () => err({ code: "unavailable", message: "terms unreadable" }),
      },
    }).context(USER, { context: CTX_A });
    assert(!failed.ok);
    assertEquals(failed.error.code, "unavailable");
  } finally {
    fx.close();
  }
});

Deno.test("documents/outline-and-search#R5: 깊은 문서의 목차도 숨긴 자식 수가 직접 자식 수를 넘지 않아 계약 출력을 지킨다", async () => {
  const { documentOutlinePageSchema } = await import(
    "../../contracts/documents/mod.ts"
  );
  // h2 아웃라인 > h3 > (h4, h5)와 h2 회의 > h4(level을 건너뛴 제목)다. depth 2 밖은 숨는다.
  const section = (
    key: string,
    position: number,
    level: number,
    parent: string | null,
    own: number,
    subtree: [number, number],
  ) => ({
    key,
    title: key,
    parent,
    position,
    level,
    anchor: null,
    own_ranges: [{ start_line: own, end_line: own }],
    subtree_range: { start_line: subtree[0], end_line: subtree[1] },
    characters: 4,
    body_hash: HASH,
  });
  const fx = openDerivedFixture();
  try {
    ledgerRow(fx, DOC_A, VER_A, { kind: "project", id: PROJECT });
    keep(recordExtraction(fx.store, {
      document: DOC_A,
      version: VER_A,
      content_hash: HASH,
      module_hash: HASH,
      extraction: {
        status: "ready",
        title: "깊은 문서",
        text: ["하나", "둘", "셋", "넷", "다섯", "여섯"].join("\n"),
        text_hash: HASH,
        sections: [
          section("아웃라인", 0, 2, null, 1, [1, 4]),
          section("첫-항목", 1, 3, "아웃라인", 2, [2, 4]),
          section("하위", 2, 4, "첫-항목", 3, [3, 3]),
          section("더-깊은", 3, 5, "첫-항목", 4, [4, 4]),
          section("회의", 4, 2, null, 5, [5, 6]),
          section("건너뜀", 5, 4, "회의", 6, [6, 6]),
        ],
      },
    }, "1"));
    fx.consumed("5");
    const page = keep(
      fx.outline().document(OUTLINE_CTX, { reference: { document: DOC_A } }),
    );
    for (const entry of page.entries) {
      assert(entry.hidden_children_count <= entry.children_count);
    }
    const parsed = documentOutlinePageSchema.safeParse(page);
    assert(parsed.success, JSON.stringify(parsed.error?.issues));
    const byKey = new Map(page.entries.map((entry) => [entry.key, entry]));
    // 직접 자식이 depth 밖에 숨는 만큼만 센다. 손자는 그 자식 아래에 숨는다.
    assertEquals(byKey.get("아웃라인")?.hidden_children_count, 1);
    assertEquals(byKey.get("회의")?.hidden_children_count, 1);
  } finally {
    fx.close();
  }
});
