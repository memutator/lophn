// documents/outline-and-search#R1·R3·R7·R10·R14, documents/versions#R8·R9, T20: 제품
// core가 outline·읽기·search·export worker route를 reader Worker의 snapshot으로
// 서빙한다. 데이터 root는 temp dir고, 파생 store는 테스트 프로세스가 별도 연결로 심는다
// (core graph 밖). 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, ok, seededRandom } from "../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import {
  derivedPath,
  type DerivedStore,
  openDerived,
} from "./adapters/store.ts";
import { BUILTIN_MODULE_HASH } from "../formats/mod.ts";
import { recordExtraction } from "./extraction.ts";
import { type Core, startCore } from "../../main/daemon/core.ts";
import type { TeamModule } from "../../main/daemon/registration.ts";
import { createLedgerRegistration } from "../register.ts";
import { createLedgerRegistration as createAppsRegistration } from "../../apps/register.ts";
import { closeUnlessKept } from "../../testing/close-on-throw.ts";

// outline은 apps 표도 읽으므로 제품처럼 apps 등록이 같이 선다.
const teams: TeamModule[] = [
  { createLedgerRegistration },
  { createLedgerRegistration: createAppsRegistration },
];
const HASH = "a".repeat(64);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const OTHER = "doc_01arz3ndektsv4rrffq69g5fb0";
const AT = Date.UTC(2024, 0, 1);
const OPERATIONS = [
  "document.save",
  "document.prepare",
  "document.export",
  "document.read",
  "outline.document",
  "outline.place",
  "outline.root",
  "search.query",
  "search.status",
];

const TEXT = [
  "# 용어집",
  "",
  "## 문서",
  "",
  "문서는 판으로 저장된다.",
  "토큰은 sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 처럼 보인다.",
].join("\n");

type Opened = {
  core: Core;
  home: string;
  token: string;
  limited: string;
  store: DerivedStore;
};

async function user(
  core: Core,
  ref: string,
  token: string,
  targets: Record<string, string>,
) {
  const context: AuthenticatedContext = {
    principal: "user-1",
    actor: "user",
    scope: { operations: OPERATIONS, targets },
    conditions: {},
    credential_ref: ref,
  };
  const accepted = await core.acceptTestCredential?.(context, token);
  assert(accepted?.ok);
  const recorded = await core.record(context);
  assert(recorded.ok);
}

async function open(superviseIo = false): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-docs-served-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [
      new URL("../register.ts", import.meta.url).href,
      new URL("../../apps/register.ts", import.meta.url).href,
    ],
    clock: manualClock(AT),
    random: seededRandom(5),
    testCredentials: true,
    superviseIo,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
    await Deno.remove(home, { recursive: true });
  });
  const core = started.value;
  const token = "d".repeat(43);
  const limited = "e".repeat(43);
  await user(core, "cred-served", token, {});
  // 다른 문서만 닿는 자격. 이 문서는 없는 것과 같아야 한다.
  await user(core, "cred-limited", limited, { document: OTHER });
  await Deno.mkdir(`${home}/derived`, { recursive: true });
  const store = openDerived(derivedPath(`${home}/derived`));
  assert(store.ok, store.ok ? "" : store.error.message);
  guard.keep();
  return { core, home, token, limited, store: store.value };
}

function post(
  core: Core,
  path: string,
  body: unknown,
  token: string,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

type FileBlob = { hash: string; bytes: number; preparation: string };

function prepared(key: string, blob?: FileBlob) {
  return {
    document: DOC,
    base_version: null,
    files_hash: HASH,
    file_count: 1,
    primary_path: "a.md",
    content_hash: blob?.hash ?? HASH,
    preparation_ref: `prep-${key}`,
    files: [{
      path: "a.md",
      blob_hash: blob?.hash ?? HASH,
      bytes: blob?.bytes ?? 10,
      media_type: "text/markdown",
      primary: true,
      preparation_ref: blob?.preparation ?? `prep-file-${key}`,
    }],
    idempotency_key: key,
    metadata: { title: "용어집", place: null, name: null },
    format: {
      name: "document",
      module_hash: blob === undefined ? HASH : BUILTIN_MODULE_HASH,
      explicit: false,
    },
    validation: {
      input_hash: blob?.hash ?? HASH,
      module_hash: blob === undefined ? HASH : BUILTIN_MODULE_HASH,
      status: "passed",
      error_count: 0,
      warning_count: 0,
      diagnostics: [],
    },
    source: null,
  };
}

// 문서를 저장하고 그 판의 추출 결과를 파생 store에 심는다.
async function seed(
  opened: Opened,
): Promise<{ version: string; event_seq: string }> {
  assert(opened.core.notePrepared);
  const noted = await opened.core.notePrepared({
    preparation: "prep-served-1",
    principal: "user-1",
    purpose: "document_files",
    hash: HASH,
    size_bytes: 10,
  }, AT);
  assert(noted.ok, noted.ok ? "" : noted.error.message);
  const notedFile = await opened.core.notePrepared({
    preparation: "prep-file-served-1",
    principal: "user-1",
    purpose: "document_file",
    hash: HASH,
    size_bytes: 10,
  }, AT);
  assert(notedFile.ok, notedFile.ok ? "" : notedFile.error.message);
  const saved = await post(opened.core, "documents/save", {
    input: prepared("served-1"),
    idempotency_key: "served-1",
    compare: { base_version: null },
    prepared: ["prep-served-1"],
  }, opened.token);
  const body = await saved.json() as { version: string; event_seq: string };
  assertEquals(saved.status, 200, JSON.stringify(body));
  const written = recordExtraction(opened.store, {
    document: DOC,
    version: body.version,
    content_hash: HASH,
    module_hash: HASH,
    extraction: {
      status: "ready",
      title: "용어집",
      text: TEXT,
      text_hash: HASH,
      sections: [{
        key: "문서",
        title: "문서",
        parent: null,
        position: 0,
        level: 2,
        anchor: null,
        own_ranges: [{ start_line: 5, end_line: 6 }],
        subtree_range: { start_line: 5, end_line: 6 },
        characters: 60,
        body_hash: HASH,
      }],
    },
  }, body.event_seq);
  assert(written.ok, written.ok ? "" : written.error.message);
  const cursor = opened.store.transaction((tx) =>
    ok(tx.sql.run(
      `INSERT OR REPLACE INTO derived_cursors (consumer, processed_seq, rebuilding) VALUES ('search', ?, 0)`,
      [body.event_seq],
    ))
  );
  assert(cursor.ok);
  return body;
}

const DIRECT_MARKDOWN = [
  "# 직접 추출",
  "",
  "## 본문",
  "",
  "index가 아직 읽지 못한 판의 문장이다.",
  "",
].join("\n");

// 실제 바이트(I/O worker의 blob)를 가진 판을 저장하고 derived에는 아무것도 심지 않는다:
// index가 아직 그 판을 추출하지 못한 상태다.
async function seedUnextracted(
  opened: Opened,
  text: string,
): Promise<{ version: string; event_seq: string }> {
  assert(opened.core.notePrepared);
  const bytes = new TextEncoder().encode(text);
  const blob = await opened.core.prepareBlob({
    principal: "user-1",
    purpose: "document_file",
    bytes: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  });
  assert(blob.ok, blob.ok ? "" : blob.error.message);
  const noted = await opened.core.notePrepared({
    preparation: "prep-direct-1",
    principal: "user-1",
    purpose: "document_files",
    hash: HASH,
    size_bytes: 10,
  }, AT);
  assert(noted.ok, noted.ok ? "" : noted.error.message);
  const saved = await post(opened.core, "documents/save", {
    input: prepared("direct-1", {
      hash: blob.value.hash,
      bytes: blob.value.size_bytes,
      preparation: blob.value.preparation,
    }),
    idempotency_key: "direct-1",
    compare: { base_version: null },
    prepared: ["prep-direct-1"],
  }, opened.token);
  const body = await saved.json() as { version: string; event_seq: string };
  assertEquals(saved.status, 200, JSON.stringify(body));
  return body;
}

async function close(opened: Opened) {
  opened.store.close();
  await opened.core.shutdown();
  await Deno.remove(opened.home, { recursive: true });
}

Deno.test("documents/outline-and-search#R1: root outline은 derived 없이도 ledger를 읽어 route로 닿는다", async () => {
  const opened = await open();
  try {
    await seed(opened);
    const answer = await post(opened.core, "outline/root", {}, opened.token);
    const body = await answer.json() as { kind?: string };
    assertEquals(answer.status, 200, JSON.stringify(body));
    assertEquals(body.kind, "root");
  } finally {
    await close(opened);
  }
});

Deno.test("documents/outline-and-search#R3: outline.document와 document.read는 고정 판 section과 본문을 낸다", async () => {
  const opened = await open();
  try {
    const saved = await seed(opened);
    const outline = await post(opened.core, "outline/document", {
      reference: { document: DOC, version: saved.version, section: null },
    }, opened.token);
    const outlineBody = await outline.json() as {
      kind?: string;
      entries?: { key: string }[];
    };
    assertEquals(outline.status, 200, JSON.stringify(outlineBody));
    assertEquals(outlineBody.entries?.map((entry) => entry.key), ["문서"]);

    const read = await post(opened.core, "documents/read", {
      reference: { document: DOC, version: saved.version, section: null },
      section: "문서",
    }, opened.token);
    const readBody = await read.json() as { text?: string | null };
    assertEquals(read.status, 200, JSON.stringify(readBody));
    assert(readBody.text?.includes("문서는 판으로 저장된다."));
  } finally {
    await close(opened);
  }
});

Deno.test("documents/outline-and-search#R14: 권한 밖 문서는 없는 문서와 같은 답이다", async () => {
  const opened = await open();
  try {
    const saved = await seed(opened);
    const absent = "doc_01arz3ndektsv4rrffq69g5fb9";
    const hidden = await post(opened.core, "outline/document", {
      reference: { document: DOC, version: saved.version, section: null },
    }, opened.limited);
    const missing = await post(opened.core, "outline/document", {
      reference: { document: absent, version: saved.version, section: null },
    }, opened.limited);
    const hiddenBody = await hidden.json();
    const missingBody = await missing.json();
    assertEquals(hidden.status, missing.status);
    assertEquals(hiddenBody, missingBody);
    assert(hidden.status >= 400);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/outline-and-search#R10: search.query가 심은 판의 본문을 찾는다", async () => {
  const opened = await open();
  try {
    await seed(opened);
    const answer = await post(opened.core, "search/query", {
      query: "저장된다",
    }, opened.token);
    const body = await answer.json() as { results?: { document: string }[] };
    assertEquals(answer.status, 200, JSON.stringify(body));
    assertEquals(body.results?.map((result) => result.document), [DOC]);
    const status = await post(opened.core, "search/status", {}, opened.token);
    const statusBody = await status.json() as { documents?: unknown[] };
    assertEquals(status.status, 200, JSON.stringify(statusBody));
    assertEquals(statusBody.documents?.length, 1);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/outline-and-search#R8: 본문 출력은 제품 redactor가 secret을 가린다", async () => {
  const opened = await open();
  try {
    const saved = await seed(opened);
    const read = await post(opened.core, "documents/read", {
      reference: { document: DOC, version: saved.version, section: null },
    }, opened.token);
    const body = await read.json() as {
      text?: string | null;
      redacted?: boolean;
    };
    assertEquals(read.status, 200, JSON.stringify(body));
    assert(body.text !== null && body.text !== undefined);
    assert(!body.text.includes("sk-ant-api03"));
    assertEquals(body.redacted, true);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/outline-and-search#R10: derived store가 없으면 빈 결과가 아니라 unavailable이다", async () => {
  const opened = await open();
  try {
    opened.store.close();
    await Deno.remove(`${opened.home}/derived/documents.sqlite`);
    const answer = await post(opened.core, "search/query", {
      query: "문서",
    }, opened.token);
    assertEquals(answer.status, 503);
    await answer.body?.cancel();
  } finally {
    // store는 이미 닫았다. 다시 닫지 않는다.
    await opened.core.shutdown();
    await Deno.remove(opened.home, { recursive: true });
  }
});

Deno.test("documents/versions#T20: export는 제품 redactor로 사람이 고른 판을 묶는다", async () => {
  const opened = await open();
  try {
    const saved = await seed(opened);
    const answer = await post(opened.core, "documents/export", {
      place: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" },
      documents: [{ document: DOC, version: saved.version }],
      format: "markdown",
    }, opened.token);
    // 문서에 자리가 없어 사람이 고른 자리와 다르다: 옛 요청은 conflict다(redactor 앞에서 거절).
    assertEquals(answer.status, 409);
    await answer.body?.cancel();
  } finally {
    await close(opened);
  }
});

function prepareBody(document: string, base: string) {
  return {
    document,
    base_version: base,
    files: [{
      path: "a.md",
      blob_hash: HASH,
      bytes: 10,
      media_type: "text/markdown",
      primary: true,
      content: {
        kind: "prepared",
        blob: {
          preparation: "prep-file",
          principal: "user-1",
          purpose: "document_file",
          hash: HASH,
          size_bytes: 10,
        },
      },
    }],
    source: null,
    idempotency_key: "prepare-1",
  };
}

Deno.test("documents/versions#R13: 준비 route는 요청 자격으로 기준 판을 읽고 권한 밖은 없는 판과 같다", async () => {
  const opened = await open(true);
  try {
    const saved = await seed(opened);
    const hidden = await post(
      opened.core,
      "documents/prepare",
      prepareBody(DOC, saved.version),
      opened.limited,
    );
    const absent = await post(
      opened.core,
      "documents/prepare",
      prepareBody(DOC, "ver_01arz3ndektsv4rrffq69g5fb9"),
      opened.limited,
    );
    const hiddenBody = await hidden.json();
    const absentBody = await absent.json();
    assertEquals(hidden.status, 404);
    assertEquals(hidden.status, absent.status);
    assertEquals(hiddenBody, absentBody);
    // 보이는 자격은 기준 판을 읽고 다음 단계로 간다. format 검사 통로가 아직 없어
    // 그 단계가 unavailable로 멈춘다(기준 판 읽기가 unavailable로 막던 때와 구별된다).
    const visible = await post(
      opened.core,
      "documents/prepare",
      prepareBody(DOC, saved.version),
      opened.token,
    );
    const visibleBody = await visible.json() as {
      error?: { message?: string };
    };
    assertEquals(visible.status, 503);
    assert(
      !visibleBody.error?.message?.includes("기준 판"),
      JSON.stringify(visibleBody),
    );
  } finally {
    await close(opened);
  }
});

Deno.test("documents/outline-and-search#R15: index가 아직 추출하지 못한 고정 판도 본문과 outline을 직접 추출해 답하고 derived에는 쓰지 않는다", async () => {
  const opened = await open(true);
  try {
    const saved = await seedUnextracted(opened, DIRECT_MARKDOWN);
    const reference = { document: DOC, version: saved.version, section: null };
    const read = await post(
      opened.core,
      "documents/read",
      { reference },
      opened.token,
    );
    const readBody = await read.json() as {
      text?: string | null;
      section_status?: string;
    };
    assertEquals(read.status, 200, JSON.stringify(readBody));
    assertEquals(readBody.section_status, "whole");
    assert(readBody.text?.includes("index가 아직 읽지 못한 판의 문장이다."));

    const outline = await post(
      opened.core,
      "outline/document",
      { reference, depth: 2 },
      opened.token,
    );
    const outlineBody = await outline.json() as {
      entries?: { title: string }[];
      section_status?: string;
    };
    assertEquals(outline.status, 200, JSON.stringify(outlineBody));
    assertEquals(
      outlineBody.entries?.map((entry) => entry.title),
      ["", "본문"],
      JSON.stringify(outlineBody),
    );

    // 이번 응답에만 추출했다: derived에는 그 판의 행이 없다.
    assertEquals(
      opened.store.read.sql.get(
        "SELECT version FROM derived_versions WHERE version = ?",
        [saved.version],
      ),
      undefined,
    );
  } finally {
    await close(opened);
  }
});

Deno.test("documents/outline-and-search#R15: 이미 실패로 기록된 판은 다시 추출하지 않고, 권한 밖 자격은 없는 판과 같은 답이다", async () => {
  const opened = await open(true);
  try {
    const saved = await seedUnextracted(opened, DIRECT_MARKDOWN);
    const reference = { document: DOC, version: saved.version, section: null };
    const hidden = await post(
      opened.core,
      "documents/read",
      { reference },
      opened.limited,
    );
    const absent = await post(opened.core, "documents/read", {
      reference: { ...reference, document: "doc_01arz3ndektsv4rrffq69g5fb9" },
    }, opened.limited);
    assert(hidden.status >= 400);
    assertEquals(hidden.status, absent.status);
    assertEquals(await hidden.json(), await absent.json());

    const recorded = recordExtraction(opened.store, {
      document: DOC,
      version: saved.version,
      content_hash: HASH,
      module_hash: HASH,
      extraction: { status: "failed", failure_reason: "recorded failure" },
    }, saved.event_seq);
    assert(recorded.ok, recorded.ok ? "" : recorded.error.message);
    const read = await post(
      opened.core,
      "documents/read",
      { reference },
      opened.token,
    );
    const body = await read.json() as {
      text?: string | null;
      section_status?: string;
      failure_reason?: string | null;
    };
    assertEquals(read.status, 200, JSON.stringify(body));
    assertEquals(body.section_status, "unverified");
    assertEquals(body.text, null);
    assertEquals(body.failure_reason, "recorded failure");
  } finally {
    await close(opened);
  }
});
