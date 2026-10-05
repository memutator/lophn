// documents/contexts#R14: 제품 core가 `/v1/contexts/export`를 reader Worker의 snapshot으로
// 서빙한다. 문서·context·용어는 실제 command로 만들고, 데이터 root는 temp dir다. 사람 데이터
// root는 열지 않는다.
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

// root outline은 apps 표도 읽으므로 제품처럼 apps 등록이 같이 선다.
const teams: TeamModule[] = [
  { createLedgerRegistration },
  { createLedgerRegistration: createAppsRegistration },
];
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const HASH = "a".repeat(64);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const OTHER = "doc_01arz3ndektsv4rrffq69g5fb0";
const SECRET = "ghp_" + "a".repeat(30);
const CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fav";
const ABSENT_CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fb9";
const AT = Date.UTC(2024, 0, 1);
const OPERATIONS = [
  "document.save",
  "document.prepare",
  "context.create",
  "context.update",
  "term.define",
  "context.export",
];

type Opened = {
  core: Core;
  home: string;
  token: string;
  limited: string;
  codingAgent: string;
  store: DerivedStore;
};

async function user(
  core: Core,
  ref: string,
  token: string,
  targets: Record<string, string>,
  actor: "user" | "coding_agent" = "user",
) {
  const context: AuthenticatedContext = {
    principal: actor === "user" ? "user-1" : `coding_agent:${CAC}`,
    actor: actor === "user" ? "user" : `coding_agent:${CAC}`,
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
  const core = started.value;
  const token = "d".repeat(43);
  const limited = "e".repeat(43);
  await user(core, "cred-context", token, {});
  // 다른 문서만 닿는 자격. 이 context는 없는 것과 같아야 한다.
  await user(core, "cred-limited", limited, { document: OTHER });
  // 사람이 아닌 actor.
  const codingAgent = "g".repeat(43);
  await user(core, "cred-coding", codingAgent, {}, "coding_agent");
  await Deno.mkdir(`${home}/derived`, { recursive: true });
  const store = openDerived(derivedPath(`${home}/derived`));
  assert(store.ok, store.ok ? "" : store.error.message);
  return {
    core,
    home,
    token,
    limited,
    codingAgent,
    store: store.value,
  };
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
      purpose: `용어를 판단할 때 읽는다 ${SECRET}`,
      items: [
        {
          target: { kind: "document", document: DOC, section: null },
          perspective: "watch",
          reason: "바뀌면 알아야 한다",
        },
        {
          target: { kind: "document", document: DOC, section: "문서" },
          perspective: "basis",
          reason: `따르는 기준 ${SECRET}`,
        },
      ],
    },
    idempotency_key: "ctx-create",
    compare: {},
    prepared: [],
  }, opened.token);
  const text = await created.text();
  assertEquals(created.status, 200, text);
  const defined = await post(opened.core, "terms/define", {
    input: {
      id: "trm_01arz3ndektsv4rrffq69g5fav",
      context: CONTEXT,
      name: "범위",
      definition: "이번 판단의 대상",
    },
    idempotency_key: "term-define",
    compare: {},
    prepared: [],
  }, opened.token);
  assertEquals(defined.status, 200, await defined.text());
}

async function close(opened: Opened) {
  opened.store.close();
  await opened.core.shutdown();
  await Deno.remove(opened.home, { recursive: true });
}

type Exported = {
  context: { id: string; purpose: string; items: { reason: string }[] };
  items: {
    perspective: string;
    reason: string;
    fixed_version: string | null;
    section_status: string | null;
  }[];
  glossary: { name: string; definition: string }[];
  as_of_seq: string;
  next_cursor: string | null;
};

Deno.test("documents/contexts#R14: 제품 core가 context export를 고정 판 참조와 glossary로 서빙하고 secret을 가린다", async () => {
  const opened = await open();
  try {
    const first = await saveVersion(opened, "exp-1", null);
    extract(opened, first.version, first.event_seq, ["문서"]);
    await createContext(opened);
    const answer = await post(opened.core, "contexts/export", {
      context: CONTEXT,
    }, opened.token);
    const text = await answer.text();
    assertEquals(answer.status, 200, text);
    const value = JSON.parse(text) as Exported;
    assertEquals(value.context.id, CONTEXT);
    assertEquals(value.items.length, 2);
    // 생성 순서(watch, basis)와 고른 관점이 그대로고, 항목마다 읽은 고정 판이 붙는다.
    assertEquals(
      value.items.map((item) => [
        item.perspective,
        item.fixed_version,
        item.section_status,
      ]),
      [["watch", first.version, "whole"], ["basis", first.version, "found"]],
    );
    assertEquals(value.glossary, [
      { name: "범위", definition: "이번 판단의 대상" },
    ]);
    // 외부 출력 redaction. secret은 목적·이유 어디에도 남지 않는다.
    assertEquals(text.includes(SECRET), false);
    assert(value.context.purpose.startsWith("용어를 판단할 때 읽는다"));
    assertEquals(value.next_cursor, null);

    // 새 판이 저장되면 같은 항목이 최신 판을 고정 참조로 내고, section은 아직 추출 전이다.
    const second = await saveVersion(
      opened,
      "exp-2",
      first.version,
      "b".repeat(64),
    );
    const later = await post(opened.core, "contexts/export", {
      context: CONTEXT,
    }, opened.token);
    const laterValue = await later.json() as Exported;
    assertEquals(later.status, 200, JSON.stringify(laterValue));
    assertEquals(laterValue.items[1].fixed_version, second.version);
    assertEquals(laterValue.items[1].section_status, "unverified");
  } finally {
    await close(opened);
  }
});

Deno.test("documents/contexts#R14: 범위 밖 자격에는 context가 없는 context와 같은 답이다", async () => {
  const opened = await open();
  try {
    const first = await saveVersion(opened, "hide-1", null);
    extract(opened, first.version, first.event_seq, ["문서"]);
    await createContext(opened);
    const hidden = await post(opened.core, "contexts/export", {
      context: CONTEXT,
    }, opened.limited);
    const absent = await post(opened.core, "contexts/export", {
      context: ABSENT_CONTEXT,
    }, opened.limited);
    assertEquals(hidden.status, absent.status);
    assertEquals(await hidden.json(), await absent.json());
    assert(hidden.status >= 400);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/contexts#R14: 사람이 아닌 actor의 export는 거절된다", async () => {
  const opened = await open();
  try {
    const first = await saveVersion(opened, "actor-1", null);
    extract(opened, first.version, first.event_seq, ["문서"]);
    await createContext(opened);
    const answer = await post(opened.core, "contexts/export", {
      context: CONTEXT,
    }, opened.codingAgent);
    assert(answer.status >= 400, String(answer.status));
    const text = await answer.text();
    assertEquals(text.includes("판단 묶음"), false);
    assertEquals(text.includes(SECRET), false);
  } finally {
    await close(opened);
  }
});
