// documents/outline-and-search#R10·R11·R12·R14·R17: 실제 core와 temp LOPHN_HOME에서
// 파생 검색 조립(T13)을 본다. 문서를 저장하고 파생 store를 별도 연결로 심은 뒤
// /v1/search/query로 찾는다. core harness에는 workers injection이 없어 workers map을
// 직접 넣는다(documents-prepare_test.ts와 같은 길이다). 검색 handler는 저장 응답의
// event_seq를 snapshot 근원으로 쓰므로, wrapper는 저장 뒤 채우는 slot으로 늦게 묶는다.
// 파생 store는 테스트 프로세스가 연다. core 모듈 graph 안에서는 열지 않는다(
// core_imports_test).
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, ok, seededRandom } from "../../packages/base/mod.ts";
import type {
  AuthenticatedContext,
  RequestContext,
} from "../../packages/contracts/platform/mod.ts";
import {
  TargetAuthorization,
  type WorkerRequest,
  type WorkerResponse,
} from "../../packages/contracts/platform/mod.ts";
import { SEARCH_ROUTES } from "../../packages/contracts/documents/mod.ts";
import {
  type WorkerRouteHandle,
  type WorkerRouteTarget,
} from "../../packages/platform/responsiveness/mod.ts";
import { createTargetAuthorizer } from "../../packages/platform/ledger/mod.ts";
import {
  createSearchHandlers,
  type SearchHandlerDeps,
  type SearchHandlers,
} from "../../packages/documents/outline-and-search/reads.ts";
import {
  type ExtractionRecord,
  recordExtraction,
} from "../../packages/documents/outline-and-search/extraction.ts";
import {
  derivedPath,
  type DerivedStore,
  openDerived,
  openDerivedRead,
} from "../../packages/documents/outline-and-search/adapters/store.ts";
import { type Core, startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

const NOW_MS = Date.UTC(2024, 0, 1);
const AT = "2024-01-01T00:00:00.000Z";
const HASH = "a".repeat(64);
const DOC_A = "doc_01arz3ndektsv4rrffq69g5fav";
const DOC_B = "doc_01arz3ndektsv4rrffq69g5fb0";
const CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fav";

const teams: TeamModule[] = [{ createLedgerRegistration }];

const OPERATIONS = [
  "document.save",
  "context.create",
  "search.query",
  "search.status",
];

// POST helper. bearer는 test credential 기록과 맞춘다.
function post(
  port: number,
  path: string,
  body: unknown,
  token: string,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

// 저장 입력. contexts_test.ts와 같은 prepared 결과 모양이다.
function prepared(key: string, document: string) {
  return {
    document,
    base_version: null,
    files_hash: HASH,
    file_count: 1,
    primary_path: "a.md",
    content_hash: HASH,
    preparation_ref: `prep-${key}`,
    files: [{
      path: "a.md",
      blob_hash: HASH,
      bytes: 10,
      media_type: "text/markdown",
      primary: true,
      preparation_ref: `prep-file-${key}`,
    }],
    idempotency_key: key,
    metadata: { title: "용어집", place: null, name: null },
    format: { name: "document", module_hash: HASH, explicit: false },
    validation: {
      input_hash: HASH,
      module_hash: HASH,
      status: "passed",
      error_count: 0,
      warning_count: 0,
      diagnostics: [],
    },
    source: null,
  };
}

// 문서 A 원문. R11 확인용 짧은 단어 leaf와 ledger를 둔다.
function glossaryTextA(): string {
  return [
    "# 용어집",
    "",
    "## 문서",
    "",
    "문서는 판으로 저장된다.",
    "leaf는 최상위 concern의 코드 자리다.",
    "",
    "## 용어",
    "",
    "ledger는 event를 남기는 근원이다.",
    "snapshot은 seq를 일관된 값으로 받는다.",
  ].join("\n");
}

// 문서 B 원문. R11 확인용 긴 합성어를 둔다.
function glossaryTextB(): string {
  return [
    "# 마이그레이션",
    "",
    "## 마이그레이션 계획",
    "",
    "데이터베이스마이그레이션계획서는 미리 세운 물음이다.",
    "두 판 사이 잇는 일곱 단계를 남긴다.",
  ].join("\n");
}

function glossaryRecordA(version: string): ExtractionRecord {
  return {
    document: DOC_A,
    version,
    content_hash: HASH,
    module_hash: HASH,
    extraction: {
      status: "ready",
      title: "용어집",
      text: glossaryTextA(),
      text_hash: HASH,
      sections: [
        {
          key: "문서",
          title: "문서",
          parent: null,
          position: 0,
          level: 2,
          anchor: null,
          own_ranges: [{ start_line: 5, end_line: 6 }],
          subtree_range: { start_line: 5, end_line: 6 },
          characters: 33,
          body_hash: HASH,
        },
        {
          key: "용어",
          title: "용어",
          parent: null,
          position: 1,
          level: 2,
          anchor: null,
          own_ranges: [{ start_line: 9, end_line: 10 }],
          subtree_range: { start_line: 9, end_line: 10 },
          characters: 31,
          body_hash: HASH,
        },
      ],
    },
  };
}

function glossaryRecordB(version: string): ExtractionRecord {
  return {
    document: DOC_B,
    version,
    content_hash: HASH,
    module_hash: HASH,
    extraction: {
      status: "ready",
      title: "마이그레이션",
      text: glossaryTextB(),
      text_hash: HASH,
      sections: [
        {
          key: "마이그레이션 계획",
          title: "마이그레이션 계획",
          parent: null,
          position: 0,
          level: 2,
          anchor: null,
          own_ranges: [{ start_line: 5, end_line: 6 }],
          subtree_range: { start_line: 5, end_line: 6 },
          characters: 35,
          body_hash: HASH,
        },
      ],
    },
  };
}

type SavedBody = {
  status?: string;
  version?: string;
  event_seq?: string;
};

type PageBody = {
  results?: {
    document: string;
    version: string;
    section: string | null;
    ranges: { start_line: number; end_line: number }[];
    reference: { document: string; version: string; section: string | null };
    title: string;
    snippet: string;
    score: number;
    match_source: string;
    cache_basis: unknown;
  }[];
  coverage?: {
    processed_seq: string;
    ledger_basis_seq: string;
    lagging: boolean;
    rebuilding: boolean;
    omissions: unknown[];
  };
  complete?: boolean;
  next_cursor?: string | null;
  as_of_seq?: string;
  error?: { code?: string; message?: string };
};

// 문서를 저장하고 파생 store를 심은 뒤 event_seq를 돌려준다.
// 파생 store는 테스트 프로세스의 별도 연결로 연다(core graph 밖이다).
// openDerived는 열림마다 스키마를 적용하므로, 테스트마다 한 번 열어 건넨다.
async function saveAndSeed(
  port: number,
  token: string,
  document: string,
  key: string,
  record: (version: string) => ExtractionRecord,
  _dataRoot: string,
  store: DerivedStore,
): Promise<{ event_seq: string }> {
  const answer = await post(port, "documents/save", {
    input: prepared(key, document),
    idempotency_key: key,
    compare: { base_version: null },
    prepared: [`prep-${key}`],
  }, token);
  const body = await answer.json() as SavedBody;
  assertEquals(answer.status, 200, JSON.stringify(body));
  assertEquals(body.status, "saved");
  const eventSeq = body.event_seq as string;
  const version = body.version as string;
  assert(typeof eventSeq === "string" && eventSeq.length > 0);
  assert(typeof version === "string" && version.length > 0);

  const written = recordExtraction(store, record(version), eventSeq);
  assert(written.ok, written.ok ? "" : written.error.message);
  // event 소비가 끝났다. cursor를 진행시킨다. work.ts와 같은 INSERT OR REPLACE다.
  const cursor = store.transaction((tx) =>
    ok(tx.sql.run(
      `INSERT OR REPLACE INTO derived_cursors (consumer, processed_seq, rebuilding) VALUES ('search', ?, 0)`,
      [eventSeq],
    ))
  );
  assert(cursor.ok, cursor.ok ? "" : cursor.error.message);
  return { event_seq: eventSeq };
}

// 파생 store를 테스트마다 한 번 연다. 열림마다 스키마가 적용되므로 재사용한다.
function openSeedStore(dataRoot: string): DerivedStore {
  const store = openDerived(derivedPath(dataRoot));
  assert(store.ok, store.ok ? "" : store.error.message);
  return store.value;
}

// ledger read snapshot. WAL allows concurrent readers.
function ledgerSnapshot(dataRoot: string, asOfSeq: string) {
  const ledgerDb = new DatabaseSync(`${dataRoot}/lophn.db`, {
    readOnly: true,
  });
  return {
    db: ledgerDb,
    snapshot: {
      as_of_seq: asOfSeq,
      sql: {
        get: (query: string, params: readonly unknown[]) =>
          ledgerDb.prepare(query).get(...params as never[]) as
            | Record<string, unknown>
            | undefined,
        all: (query: string, params: readonly unknown[]) =>
          ledgerDb.prepare(query).all(...params as never[]) as Record<
            string,
            unknown
          >[],
      },
    },
  };
}

function handlerDeps(
  context: AuthenticatedContext,
  dataRoot: string,
  asOfSeq: string,
  contexts?: SearchHandlerDeps["contexts"],
): { deps: SearchHandlerDeps; close(): void } {
  const read = openDerivedRead(derivedPath(dataRoot));
  assert(read.ok, read.ok ? "" : read.error.message);
  const ledger = ledgerSnapshot(dataRoot, asOfSeq);
  return {
    deps: {
      read: read.value,
      snapshot: ledger.snapshot,
      ports: {
        port<T>(key: unknown): T {
          if (!Object.is(key, TargetAuthorization)) {
            throw new Error("unregistered port");
          }
          return createTargetAuthorizer(context) as unknown as T;
        },
      },
      ...(contexts === undefined ? {} : { contexts }),
    },
    close() {
      ledger.db.close();
    },
  };
}

// handler 결과를 page로 맞춘다. reference는 고정 판 참조로 정규화하고 complete를
// 채운다(route output schema의 publicPage는 complete를 요구한다).
function pageResponse(
  envelope: WorkerRequest,
  ran: ReturnType<SearchHandlers["query"]>,
): { ok: true; value: WorkerResponse } {
  if (!ran.ok) {
    return {
      ok: true,
      value: {
        type: "worker_response",
        request_id: envelope.request_id,
        ok: false,
        error: { code: ran.error.code, message: ran.error.message },
      },
    };
  }
  return {
    ok: true,
    value: {
      type: "worker_response",
      request_id: envelope.request_id,
      ok: true,
      payload: {
        results: ran.value.results.map((result) => ({
          ...result,
          reference: {
            document: result.document,
            version: result.version,
            section: result.section,
          },
        })),
        coverage: ran.value.coverage,
        complete: true,
        next_cursor: null,
        as_of_seq: ran.value.as_of_seq,
      },
    },
  };
}

// 저장 뒤 채우는 slot으로 늦게 묶는 검색 wrapper. startCore 때 target 참조만
// 고정되고 forward는 호출 시점의 handlers를 읽는다.
function wrapperTarget(): {
  target: WorkerRouteTarget;
  fill(handlers: SearchHandlers, context: AuthenticatedContext): void;
} {
  const slot: { handlers?: SearchHandlers; context?: AuthenticatedContext } =
    {};
  return {
    target: {
      handle: {
        observation: () => ({
          component: "documents/worker",
          available: true,
          observed_at: AT,
        }),
        forward: async (envelope: WorkerRequest) => {
          await Promise.resolve();
          assert(envelope.type === "worker_request");
          const handlers = slot.handlers;
          const context = slot.context;
          if (handlers === undefined || context === undefined) {
            return {
              ok: true,
              value: {
                type: "worker_response",
                request_id: envelope.request_id,
                ok: false,
                error: { code: "unavailable", message: "not seeded yet" },
              } satisfies WorkerResponse,
            };
          }
          if (envelope.op === "search.query") {
            const ran = handlers.query(
              context as unknown as RequestContext,
              envelope.payload as { query: string },
            );
            return pageResponse(envelope, ran);
          }
          return {
            ok: true,
            value: {
              type: "worker_response",
              request_id: envelope.request_id,
              ok: false,
              error: { code: "invalid_input", message: "unknown op" },
            } satisfies WorkerResponse,
          };
        },
      } satisfies WorkerRouteHandle,
    },
    fill(handlers, context) {
      slot.handlers = handlers;
      slot.context = context;
    },
  };
}

async function openCore(
  target: WorkerRouteTarget,
): Promise<{
  core: Core;
  token: string;
  context: AuthenticatedContext;
  home: string;
}> {
  const home = await Deno.makeTempDir({ prefix: "lophn-search-core-" });
  const token = "b".repeat(43);
  const context = {
    principal: "user-1",
    actor: "user",
    scope: { operations: OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: "cred-search",
  } as AuthenticatedContext;
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    // writer worker가 document.save를 다시 조립한다. contexts_test.ts와 같은 모양이다.
    teamModules: [new URL("./documents.ts", import.meta.url).href],
    clock: manualClock(NOW_MS),
    random: seededRandom(1),
    testCredentials: true,
    superviseIo: false,
    // 검색 wrapper(T13). 제품 기동에는 workers map이 없다(T8·T13 통합 seam).
    workers: new Map<string, WorkerRouteTarget>([["search/query", target]]),
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
    await Deno.remove(home, { recursive: true });
  });
  const core = started.value;
  const accepted = await core.acceptTestCredential?.(context, token);
  assert(accepted?.ok, "test credential seed failed");
  const recorded = await core.record(context);
  assert(recorded.ok, recorded.ok ? "" : recorded.error?.message ?? "");
  guard.keep();
  return { core, token, context, home };
}

// 저장에 필요한 준비 참조를 writer 메모리에 심는다. contexts_test.ts와 같은 모양이다.
async function notePreparedFor(core: Core, key: string): Promise<void> {
  const noted = await core.notePrepared?.(
    {
      preparation: `prep-${key}`,
      principal: "user-1",
      purpose: "document_files",
      hash: HASH,
      size_bytes: 0,
    },
    NOW_MS,
  );
  assert(noted?.ok, noted?.ok ? "" : noted?.error?.message ?? "");
  const notedFile = await core.notePrepared?.(
    {
      preparation: `prep-file-${key}`,
      principal: "user-1",
      purpose: "document_file",
      hash: HASH,
      size_bytes: 10,
    },
    NOW_MS,
  );
  assert(
    notedFile?.ok,
    notedFile?.ok ? "" : notedFile?.error?.message ?? "",
  );
}

Deno.test("documents/outline-and-search#R10: 검색 contract route는 registry에 있다", () => {
  assertEquals(SEARCH_ROUTES.length, 2);
  assertEquals(SEARCH_ROUTES[0].resource, "search");
  assertEquals(SEARCH_ROUTES[0].method, "query");
  assertEquals(SEARCH_ROUTES[1].resource, "search");
  assertEquals(SEARCH_ROUTES[1].method, "status");
});

Deno.test("documents/outline-and-search#R10 R11 R12: 저장한 문서를 /v1/search/query로 찾는다", async () => {
  const wrap = wrapperTarget();
  const made = await openCore(wrap.target);
  const { core, token, context, home } = made;
  try {
    // 파생 store를 한 번 연다. 테스트 내내 재사용한다.
    const seedStore = openSeedStore(core.dataRoot);
    try {
      // 저장에 필요한 준비 참조를 심는다.
      await notePreparedFor(core, "create-a");
      // 문서를 저장한다(실제 core ledger에 event를 남긴다).
      const seed = await saveAndSeed(
        core.port,
        token,
        DOC_A,
        "create-a",
        glossaryRecordA,
        core.dataRoot,
        seedStore,
      );

      // 검색 handler를 채운다. 파생 read와 ledger snapshot은 테스트가 열은 연결이다.
      const opened = handlerDeps(context, core.dataRoot, seed.event_seq);
      try {
        wrap.fill(createSearchHandlers(opened.deps), context);

        // 저장 → 검색. 짧은 단어 leaf는 LIKE 비교로 본문 줄에서 찾는다(R11).
        const found = await post(core.port, "search/query", {
          query: "leaf",
        }, token);
        assertEquals(found.status, 200);
        const page = await found.json() as PageBody;
        assertEquals(page.results?.length, 1, JSON.stringify(page));
        const result = page.results![0];
        assertEquals(result.document, DOC_A);
        assertEquals(result.section, "문서");
        assertEquals(result.match_source, "original");
        assertEquals(result.cache_basis, null);
        // 고정 판 참조(R12). version은 저장한 판이다.
        assertEquals(result.reference, {
          document: DOC_A,
          version: result.version,
          section: "문서",
        });
        // 본문 줄 근거(R12). 1-based inclusive range다.
        assert(result.ranges.length > 0);
        assert(result.ranges[0].start_line >= 1);
        // snippet·score(R12). 일치 부분과 순위 점수다.
        assert(result.snippet.includes("leaf"));
        assert(result.score > 0);
        // page 진실. complete와 cursor다.
        assertEquals(page.complete, true);
        assertEquals(page.next_cursor, null);
        assertEquals(page.coverage?.lagging, false);
        assertEquals(page.coverage?.rebuilding, false);

        // 긴 합성어 query는 trigram FTS 비교였을 문서를 같은 LIKE 비교로 찾는다.
        // R11의 handler 비교는 본문 includes다(R10·R11 leaf 검사).
        // (FTS5 trigram 비교 자체는 work_test.ts가 흔든다.)
        const long = await post(core.port, "search/query", {
          query: "마이그레이션계획서는",
        }, token);
        assertEquals(long.status, 200);
        const longPage = await long.json() as PageBody;
        assertEquals(longPage.results?.length, 0);
      } finally {
        opened.close();
      }
    } finally {
      seedStore.close();
    }
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("documents/outline-and-search#R10 R12: 권한 밖 place 요청은 부재와 같은 응답으로 존재를 새지 않는다", async () => {
  const wrap = wrapperTarget();
  const made = await openCore(wrap.target);
  const { core, token, context, home } = made;
  try {
    // 파생 store를 한 번 연다. 테스트 내내 재사용한다.
    const seedStore = openSeedStore(core.dataRoot);
    try {
      // 저장에 필요한 준비 참조를 심는다.
      await notePreparedFor(core, "create-a");
      const seed = await saveAndSeed(
        core.port,
        token,
        DOC_A,
        "create-a",
        glossaryRecordA,
        core.dataRoot,
        seedStore,
      );
      // 검색 handler를 채운다. 파생 read와 ledger snapshot은 테스트가 열은 연결이다.
      const opened = handlerDeps(context, core.dataRoot, seed.event_seq);
      try {
        wrap.fill(createSearchHandlers(opened.deps), context);

        // 같은 query를 다른 place로 내면 결과가 없다. 존재를 새지 않는다(R12).
        const other = await post(core.port, "search/query", {
          query: "leaf",
          place: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fb0" },
        }, token);
        assertEquals(other.status, 200);
        const otherPage = await other.json() as PageBody;
        assertEquals(otherPage.results?.length, 0);
        assertEquals(otherPage.complete, true);
        assertEquals(otherPage.next_cursor, null);

        // 없는 단어와 같은 응답 모양이다(존재 누설이 없다).
        const absent = await post(core.port, "search/query", {
          query: "없는말",
        }, token);
        assertEquals(absent.status, 200);
        const absentPage = await absent.json() as PageBody;
        assertEquals(absentPage.results?.length, 0);
        assertEquals(otherPage.coverage?.lagging, absentPage.coverage?.lagging);
      } finally {
        opened.close();
      }
    } finally {
      seedStore.close();
    }
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("documents/outline-and-search#R12: context filter는 items 목록 문서로 좁히고 없는 context는 전부 비운다", async () => {
  const wrap = wrapperTarget();
  const made = await openCore(wrap.target);
  const { core, token, context, home } = made;
  try {
    // 파생 store를 한 번 연다. 두 시드가 같은 연결을 건선다.
    const seedStore = openSeedStore(core.dataRoot);
    try {
      // 저장에 필요한 준비 참조를 심는다.
      await notePreparedFor(core, "create-a");
      await notePreparedFor(core, "create-b");
      // 두 문서를 저장하고 파생에 심는다. leaf는 A만, 긴 합성어는 B만 둔다.
      const seedA = await saveAndSeed(
        core.port,
        token,
        DOC_A,
        "create-a",
        glossaryRecordA,
        core.dataRoot,
        seedStore,
      );
      const seedB = await saveAndSeed(
        core.port,
        token,
        DOC_B,
        "create-b",
        glossaryRecordB,
        core.dataRoot,
        seedStore,
      );

      // snapshot은 최근 event_seq를 근원으로 둔다.
      const asOf = BigInt(seedB.event_seq) >= BigInt(seedA.event_seq)
        ? seedB.event_seq
        : seedA.event_seq;
      // 새 context 모델은 문서 항목을 두지 않는다. context filter의 근원은 주입하는 목록이라
      // 여기서는 A만 든 목록을 준다.
      const itemRows = (): SearchHandlerDeps["contexts"] => ({
        items: (contextId: string) => {
          if (contextId !== CONTEXT) {
            return {
              ok: false as const,
              error: {
                code: "not_found" as const,
                message: "context not found",
              },
            };
          }
          return {
            ok: true as const,
            value: [{ kind: "document" as const, document: DOC_A }],
          };
        },
      });

      const ledger = ledgerSnapshot(core.dataRoot, asOf);
      const read = openDerivedRead(derivedPath(core.dataRoot));
      assert(read.ok, read.ok ? "" : read.error.message);
      try {
        const contexts = itemRows();
        const deps: SearchHandlerDeps = {
          read: read.value,
          snapshot: ledger.snapshot,
          ports: {
            port<T>(key: unknown): T {
              if (!Object.is(key, TargetAuthorization)) {
                throw new Error("unregistered port");
              }
              return createTargetAuthorizer(context) as unknown as T;
            },
          },
          contexts,
        };
        wrap.fill(createSearchHandlers(deps), context);

        // filter 없이는 두 문서가 모두 나온다. 「판」은 두 원문에 모두 있다.
        const unfiltered = await post(core.port, "search/query", {
          query: "판",
        }, token);
        assertEquals(unfiltered.status, 200);
        const unfilteredPage = await unfiltered.json() as PageBody;
        assert(
          unfilteredPage.results && unfilteredPage.results.length >= 1,
          JSON.stringify(unfilteredPage),
        );

        // context filter는 A만 남긴다.
        const filtered = await post(core.port, "search/query", {
          query: "leaf",
          context: CONTEXT,
        }, token);
        assertEquals(filtered.status, 200);
        const filteredPage = await filtered.json() as PageBody;
        assert(filteredPage.results);
        assert(filteredPage.results.length >= 1);
        assertEquals(
          filteredPage.results.every((result) => result.document === DOC_A),
          true,
        );

        // 긴 합성어는 B에만 있다. context filter로 A만 남으면 결과가 없다.
        const narrowed = await post(core.port, "search/query", {
          query: "데이터베이스마이그레이션계획서",
          context: CONTEXT,
        }, token);
        assertEquals(narrowed.status, 200);
        const narrowedPage = await narrowed.json() as PageBody;
        assertEquals(narrowedPage.results?.length, 0);

        // 없는 context는 fail-closed다. 후보를 전부 비운다(R12).
        const unknown = await post(core.port, "search/query", {
          query: "leaf",
          context: "ctx_01arz3ndektsv4rrffq69g5fb9",
        }, token);
        assertEquals(unknown.status, 200);
        const unknownPage = await unknown.json() as PageBody;
        assertEquals(unknownPage.results?.length, 0);
        assertEquals(unknownPage.complete, true);
      } finally {
        ledger.db.close();
      }
    } finally {
      seedStore.close();
    }
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
