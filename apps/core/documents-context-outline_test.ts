// documents/outline-and-search#R2·R4, documents/contexts#R4: 제품 core가 root outline의
// context 요약과 `/v1/outline/context`를 reader Worker의 snapshot으로 서빙한다. 문서와
// context는 실제 command로 만들고, 데이터 root는 temp dir다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, ok, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import {
  derivedPath,
  type DerivedStore,
  openDerived,
} from "../../packages/documents/outline-and-search/adapters/store.ts";
import { recordExtraction } from "../../packages/documents/outline-and-search/extraction.ts";
import { type Core, startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

// root outline은 apps 표도 읽으므로 제품처럼 apps 등록이 같이 선다.
const teams: TeamModule[] = [
  { createLedgerRegistration },
  { createLedgerRegistration: createAppsRegistration },
];
const HASH = "a".repeat(64);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const OTHER = "doc_01arz3ndektsv4rrffq69g5fb0";
const CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fav";
const ABSENT_CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fb9";
const AT = Date.UTC(2024, 0, 1);
const OPERATIONS = [
  "document.save",
  "document.prepare",
  "context.create",
  "context.update",
  "outline.context",
  "outline.root",
];

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

async function open(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-context-outline-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [
      new URL("./documents.ts", import.meta.url).href,
      new URL("./apps.ts", import.meta.url).href,
    ],
    clock: manualClock(AT),
    random: seededRandom(5),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
    await Deno.remove(home, { recursive: true });
  });
  const core = started.value;
  const token = "d".repeat(43);
  const limited = "e".repeat(43);
  await user(core, "cred-context", token, {});
  // 다른 문서만 닿는 자격. 이 context는 없는 것과 같아야 한다.
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

function prepared(key: string, base: string | null, hash: string) {
  return {
    document: DOC,
    base_version: base,
    files_hash: HASH,
    file_count: 1,
    primary_path: "a.md",
    content_hash: hash,
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
    ...(base === null
      ? { metadata: { title: "용어집", place: null, name: null } }
      : {}),
    format: { name: "document", module_hash: HASH, explicit: false },
    validation: {
      input_hash: hash,
      module_hash: HASH,
      status: "passed",
      error_count: 0,
      warning_count: 0,
      diagnostics: [],
    },
    source: null,
  };
}

async function saveVersion(
  opened: Opened,
  key: string,
  base: string | null,
  hash = HASH,
): Promise<{ version: string; event_seq: string }> {
  assert(opened.core.notePrepared);
  const noted = await opened.core.notePrepared({
    preparation: `prep-${key}`,
    principal: "user-1",
    purpose: "document_files",
    hash: HASH,
    size_bytes: 10,
  }, AT);
  assert(noted.ok, noted.ok ? "" : noted.error.message);
  const notedFile = await opened.core.notePrepared({
    preparation: `prep-file-${key}`,
    principal: "user-1",
    purpose: "document_file",
    hash: HASH,
    size_bytes: 10,
  }, AT);
  assert(notedFile.ok, notedFile.ok ? "" : notedFile.error.message);
  const saved = await post(opened.core, "documents/save", {
    input: prepared(key, base, hash),
    idempotency_key: key,
    compare: { base_version: base },
    prepared: [`prep-${key}`],
  }, opened.token);
  const body = await saved.json() as { version: string; event_seq: string };
  assertEquals(saved.status, 200, JSON.stringify(body));
  return body;
}

function extract(opened: Opened, version: string, seq: string, keys: string[]) {
  const written = recordExtraction(opened.store, {
    document: DOC,
    version,
    content_hash: HASH,
    module_hash: HASH,
    extraction: {
      status: "ready",
      title: "용어집",
      text: "# 용어집",
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
        characters: 4,
        body_hash: HASH,
      })),
    },
  }, seq);
  assert(written.ok, written.ok ? "" : written.error.message);
  const cursor = opened.store.transaction((tx) =>
    ok(tx.sql.run(
      `INSERT OR REPLACE INTO derived_cursors (consumer, processed_seq, rebuilding) VALUES ('search', ?, 0)`,
      [seq],
    ))
  );
  assert(cursor.ok);
}

async function createContext(opened: Opened) {
  const created = await post(opened.core, "contexts/create", {
    input: {
      id: CONTEXT,
      title: "판단 묶음",
      purpose: "용어를 판단할 때 읽는다",
      items: [
        {
          target: { kind: "document", document: DOC, section: null },
          perspective: "watch",
          reason: "바뀌면 알아야 한다",
        },
        {
          target: { kind: "document", document: DOC, section: "문서" },
          perspective: "basis",
          reason: "따르는 기준",
        },
      ],
    },
    idempotency_key: "ctx-create",
    compare: {},
    prepared: [],
  }, opened.token);
  const text = await created.text();
  assertEquals(created.status, 200, text);
}

async function close(opened: Opened) {
  opened.store.close();
  await opened.core.shutdown();
  await Deno.remove(opened.home, { recursive: true });
}

type ContextPage = {
  kind: string;
  context: string;
  purpose: string;
  complete: boolean;
  entries: {
    perspective: string;
    reason: string;
    version: string | null;
    section_status: string;
    readable: boolean;
  }[];
  perspectives: Record<string, unknown[]>;
};

Deno.test("documents/outline-and-search#R4: 제품 core가 context 목차를 기준→참고→watch 순서와 선택 고정 판으로 서빙한다", async () => {
  const opened = await open();
  try {
    const first = await saveVersion(opened, "ctx-1", null);
    extract(opened, first.version, first.event_seq, ["문서"]);
    await createContext(opened);
    const answer = await post(opened.core, "outline/context", {
      context: CONTEXT,
    }, opened.token);
    const text = await answer.text();
    assertEquals(answer.status, 200, text);
    const page = JSON.parse(text) as ContextPage;
    assertEquals(page.kind, "context");
    assertEquals(page.context, CONTEXT);
    assertEquals(page.purpose, "용어를 판단할 때 읽는다");
    // 생성은 watch가 먼저였지만 목차는 기준이 먼저다.
    assertEquals(
      page.entries.map((entry) => entry.perspective),
      ["basis", "watch"],
    );
    assertEquals(page.entries[0].version, first.version);
    assertEquals(page.entries[0].section_status, "found");
    assertEquals(page.entries[0].readable, true);
    assertEquals(page.entries[1].section_status, "whole");
    // 빈 관점도 key로 남는다.
    assertEquals(Object.keys(page.perspectives), [
      "basis",
      "reference",
      "watch",
    ]);
    assertEquals(page.perspectives.reference, []);

    // documents/contexts#R4: 새 판이 저장되면 같은 항목이 최신 판을 가리킨다. 먼저 받은
    // 응답의 판은 그대로다.
    const second = await saveVersion(
      opened,
      "ctx-2",
      first.version,
      "b".repeat(64),
    );
    const later = await post(opened.core, "outline/context", {
      context: CONTEXT,
    }, opened.token);
    const laterPage = await later.json() as ContextPage;
    assertEquals(later.status, 200, JSON.stringify(laterPage));
    assertEquals(laterPage.entries[0].version, second.version);
    assertEquals(page.entries[0].version, first.version);
    // 새 판은 아직 추출되지 않았다. section 항목을 추정으로 읽을 수 있다고 하지 않는다.
    assertEquals(laterPage.entries[0].section_status, "unverified");
    assertEquals(laterPage.entries[0].readable, false);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/outline-and-search#R2: 제품 core의 root outline이 context 목적·기준 항목 수·활동을 낸다", async () => {
  const opened = await open();
  try {
    const first = await saveVersion(opened, "root-1", null);
    extract(opened, first.version, first.event_seq, ["문서"]);
    await createContext(opened);
    const answer = await post(opened.core, "outline/root", {}, opened.token);
    const text = await answer.text();
    assertEquals(answer.status, 200, text);
    const page = JSON.parse(text) as {
      entries: {
        kind: string;
        id?: string;
        purpose?: string;
        basis_count?: number;
        reference_app_count?: number;
        activity_seq?: string;
      }[];
    };
    const context = page.entries.find((entry) => entry.kind === "context");
    assert(context !== undefined, text);
    assertEquals(context.id, CONTEXT);
    assertEquals(context.purpose, "용어를 판단할 때 읽는다");
    assertEquals(context.basis_count, 1);
    assertEquals(context.reference_app_count, 0);
    assert(context.activity_seq !== undefined);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/outline-and-search#R4: 범위 밖 자격에는 context가 없는 context와 같은 답이다", async () => {
  const opened = await open();
  try {
    const first = await saveVersion(opened, "hide-1", null);
    extract(opened, first.version, first.event_seq, ["문서"]);
    await createContext(opened);
    const hidden = await post(opened.core, "outline/context", {
      context: CONTEXT,
    }, opened.limited);
    const absent = await post(opened.core, "outline/context", {
      context: ABSENT_CONTEXT,
    }, opened.limited);
    const hiddenBody = await hidden.json();
    const absentBody = await absent.json();
    assertEquals(hidden.status, absent.status);
    assertEquals(hiddenBody, absentBody);
    assert(hidden.status >= 400);
    // root에서도 범위 밖 자격에는 context 줄이 없다.
    const root = await post(opened.core, "outline/root", {}, opened.limited);
    const rootBody = await root.json() as { entries: { kind: string }[] };
    assertEquals(root.status, 200, JSON.stringify(rootBody));
    assertEquals(
      rootBody.entries.some((entry) => entry.kind === "context"),
      false,
    );
  } finally {
    await close(opened);
  }
});
