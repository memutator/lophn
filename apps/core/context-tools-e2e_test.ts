// coding-agent#T17 끝에서 끝까지: coding agent가 `lophn_context`로 context를 읽고 변경안을
// 낸다. core, documents worker, I/O worker는 실제 자식 프로세스이고 데이터 root는 temp
// dir다. 사람 데이터 root는 열지 않는다. context·용어·문서는 사람 자격의 실제 command로
// 만들고, agent 자격은 읽기와 문서 저장 operation만 가진다: context·term command
// operation이 없으므로 propose가 그것을 불렀다면 forbidden으로 실패한다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, ok, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { documentGet } from "../../packages/contracts/documents/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import {
  proposeContextChange,
  uploadPrepareBytes,
} from "../../packages/coding-agent/connection/mod.ts";
import { createContextTool } from "../../packages/coding-agent/mcp-server/tools/context.ts";
import { resolveRoute } from "../../packages/coding-agent/mcp-server/registry.ts";
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

const teams: TeamModule[] = [
  { createLedgerRegistration },
  { createLedgerRegistration: createAppsRegistration },
];
const HASH = "a".repeat(64);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const OTHER = "doc_01arz3ndektsv4rrffq69g5fb0";
const CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fav";
const ARCHIVED = "ctx_01arz3ndektsv4rrffq69g5faw";
const NEW_CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fax";
const TERM = "trm_01arz3ndektsv4rrffq69g5fav";
const CANDIDATE = "trm_01arz3ndektsv4rrffq69g5faw";
const NEW_TERM = "trm_01arz3ndektsv4rrffq69g5fax";
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const AT = Date.UTC(2024, 0, 1);
const USER_TOKEN = "d".repeat(43);
const AGENT_TOKEN = "a".repeat(43);
const LIMITED_TOKEN = "e".repeat(43);

const USER_OPERATIONS = [
  "document.save",
  "document.prepare",
  "context.create",
  "context.archive",
  "context.get",
  "term.define",
  "term.propose",
  "term.list",
  "document.list",
];
// agent는 읽기와 문서 저장뿐이다. context·term command operation이 없다.
const AGENT_OPERATIONS = [
  "context.list",
  "context.get",
  "context.related",
  "outline.context",
  "term.list",
  "document.upload",
  "document.prepare",
  "document.save",
  "document.get",
  "document.list",
];

type Opened = {
  core: Core;
  home: string;
  store: DerivedStore;
  work: string;
};

async function credential(
  core: Core,
  context: AuthenticatedContext,
  token: string,
) {
  const accepted = await core.acceptTestCredential?.(context, token);
  assert(accepted?.ok);
  const recorded = await core.record(context);
  assert(recorded.ok);
}

async function open(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-context-tools-" });
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-context-tools-work-" }),
  );
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [
      new URL("./documents.ts", import.meta.url).href,
      new URL("./apps.ts", import.meta.url).href,
    ],
    clock: manualClock(AT),
    random: seededRandom(17),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  await credential(core, {
    principal: "user-1",
    actor: "user",
    scope: { operations: USER_OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: "cred-user",
  }, USER_TOKEN);
  await credential(core, {
    principal: `coding_agent:${CAC}`,
    actor: `coding_agent:${CAC}`,
    scope: { operations: AGENT_OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: "cred-agent",
  }, AGENT_TOKEN);
  // 다른 문서만 닿는 자격. 이 context는 없는 것과 같아야 한다.
  await credential(core, {
    principal: `coding_agent:${CAC}`,
    actor: `coding_agent:${CAC}`,
    scope: { operations: AGENT_OPERATIONS, targets: { document: OTHER } },
    conditions: {},
    credential_ref: "cred-limited",
  }, LIMITED_TOKEN);
  await Deno.mkdir(`${home}/derived`, { recursive: true });
  const store = openDerived(derivedPath(`${home}/derived`));
  assert(store.ok, store.ok ? "" : store.error.message);
  return { core, home, store: store.value, work };
}

async function close(opened: Opened) {
  opened.store.close();
  await opened.core.shutdown();
  await Deno.remove(opened.home, { recursive: true });
  await Deno.remove(opened.work, { recursive: true });
}

async function post(
  opened: Opened,
  path: string,
  body: unknown,
  token = USER_TOKEN,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `http://127.0.0.1:${opened.core.port}/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );
  const text = await response.text();
  assertEquals(response.status, 200, `${path}: ${text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

function agent(opened: Opened, token = AGENT_TOKEN) {
  const client = createCoreClient({
    baseUrl: `http://127.0.0.1:${opened.core.port}`,
    connection: CAC,
    provider: () => Promise.resolve({ ok: true, value: { token } }),
  });
  const deps = { client, prepareBytes: uploadPrepareBytes(client) };
  const tool = createContextTool(deps);
  return {
    client,
    deps,
    run(input: Record<string, unknown>) {
      const resolved = resolveRoute("lophn_context", input.op as string);
      assert(resolved);
      return tool("lophn_context", resolved.route, input);
    },
  };
}

function prepared(key: string) {
  return {
    document: DOC,
    base_version: null,
    files_hash: HASH,
    file_count: 1,
    primary_path: "a.md",
    content_hash: HASH,
    preparation_ref: `prep-${key}`,
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

// 사람 자격으로 문서 첫 판을 저장하고 구역을 추출해 context 목차가 읽게 한다.
async function savedSource(opened: Opened) {
  assert(opened.core.notePrepared);
  const noted = await opened.core.notePrepared({
    preparation: "prep-source",
    principal: "user-1",
    purpose: "document_files",
    hash: HASH,
    size_bytes: 10,
  }, AT);
  assert(noted.ok, noted.ok ? "" : noted.error.message);
  const saved = await post(opened, "documents/save", {
    input: prepared("source"),
    idempotency_key: "source",
    compare: { base_version: null },
    prepared: ["prep-source"],
  }) as { version: string; event_seq: string };
  const written = recordExtraction(opened.store, {
    document: DOC,
    version: saved.version,
    content_hash: HASH,
    module_hash: HASH,
    extraction: {
      status: "ready",
      title: "용어집",
      text: "# 용어집",
      text_hash: HASH,
      sections: ["문서"].map((key, position) => ({
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
  }, saved.event_seq);
  assert(written.ok, written.ok ? "" : written.error.message);
  const cursor = opened.store.transaction((tx) =>
    ok(tx.sql.run(
      `INSERT OR REPLACE INTO derived_cursors (consumer, processed_seq, rebuilding) VALUES ('search', ?, 0)`,
      [saved.event_seq],
    ))
  );
  assert(cursor.ok);
  return saved;
}

async function createContexts(opened: Opened) {
  await post(opened, "contexts/create", {
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
  });
  const old = await post(opened, "contexts/create", {
    input: {
      id: ARCHIVED,
      title: "옛 묶음",
      purpose: "지금은 쓰지 않는다",
      items: [],
    },
    idempotency_key: "ctx-old",
    compare: {},
    prepared: [],
  }) as { revision: string };
  await post(opened, "contexts/archive", {
    input: { context: ARCHIVED },
    idempotency_key: "ctx-archive",
    compare: { base_revision: old.revision },
    prepared: [],
  });
}

async function contextState(opened: Opened) {
  const got = await post(opened, "contexts/get", { context: CONTEXT });
  const terms = await post(opened, "terms/list", { context: CONTEXT });
  return JSON.stringify({
    context: (got as { context: unknown }).context,
    definitions: terms.definitions,
    candidates: terms.candidates,
  });
}

Deno.test("coding-agent/mcp-server#R17: 실제 core에서 목록(보관 포함)·상세·관점 항목·읽기 깊이·용어·참조 context를 읽는다", async () => {
  const opened = await open();
  try {
    const source = await savedSource(opened);
    await createContexts(opened);
    // 사람이 용어를 정의하고 후보 하나를 올려 둔다.
    await post(opened, "terms/define", {
      input: {
        id: TERM,
        context: CONTEXT,
        name: "범위",
        definition: "이번 판단의 대상",
      },
      idempotency_key: "term-define",
      compare: {},
      prepared: [],
    });
    await post(opened, "terms/propose", {
      input: {
        id: CANDIDATE,
        context: CONTEXT,
        name: "경계",
        evidence: [{
          document: DOC,
          version: source.version,
          section: "문서",
          start_line: null,
          end_line: null,
        }],
      },
      idempotency_key: "term-propose",
      compare: {},
      prepared: [],
    });
    const { run } = agent(opened);

    // status active는 활성만이고 생략·all은 보관 context를 함께 낸다.
    const active = await run({ op: "list", status: "active" });
    assertEquals(active.isError, undefined);
    assertEquals(
      (active.data as { contexts: { id: string }[] }).contexts.map((c) => c.id),
      [CONTEXT],
    );
    const all = await run({ op: "list", status: "all" });
    assertEquals(
      (all.data as { contexts: { id: string }[] }).contexts.map((c) => c.id)
        .sort(),
      [CONTEXT, ARCHIVED].sort(),
    );
    const unfiltered = await run({ op: "list" });
    assertEquals(
      (unfiltered.data as { contexts: unknown[] }).contexts.length,
      2,
    );
    assertEquals(all.summary.includes("보관 1개 포함"), true);
    // context는 문서의 소속이 아니라 관점이라고 매번 알린다.
    assertEquals(all.summary.includes("소속이 아니라 읽는 관점"), true);

    const shown = await run({ op: "show", context: CONTEXT });
    assertEquals(shown.isError, undefined);
    assertEquals(
      shown.summary.startsWith("판단 묶음: 기준 1·참고 0·watch 1"),
      true,
    );

    // 목차는 기준 → 참고 → watch 순서이고 perspective filter는 그 관점만 남긴다.
    const items = await run({ op: "items", context: CONTEXT });
    const page = items.data as {
      entries: { perspective: string; version: string | null }[];
      perspectives: Record<string, unknown[]>;
      glossary: { name: string }[];
      candidates: { name: string; definition: null }[];
      complete: boolean;
    };
    assertEquals(page.entries.map((entry) => entry.perspective), [
      "basis",
      "watch",
    ]);
    assertEquals(page.entries[0].version, source.version);
    assertEquals(page.glossary.map((term) => term.name), ["범위"]);
    assertEquals(page.candidates.map((term) => term.name), ["경계"]);
    const watch = await run({
      op: "items",
      context: CONTEXT,
      perspective: "watch",
    });
    const watchPage = watch.data as {
      entries: { perspective: string }[];
      perspectives: Record<string, unknown[]>;
    };
    assertEquals(watchPage.entries.map((entry) => entry.perspective), [
      "watch",
    ]);
    assertEquals(Object.keys(watchPage.perspectives), ["watch"]);
    // 읽기 깊이: 아주 작은 예산은 이어 읽기를 남긴다.
    const shallow = await run({
      op: "items",
      context: CONTEXT,
      estimated_token_budget: 1,
    });
    assertEquals(shallow.isError, undefined);
    const shallowPage = shallow.data as {
      complete: boolean;
      next_cursor: string | null;
    };
    if (!shallowPage.complete) {
      assert(shallowPage.next_cursor !== null);
      assertEquals(shallow.next[0].includes("next_cursor"), true);
    }

    // 용어 정의와 후보는 구별된다.
    const glossary = await run({ op: "glossary", context: CONTEXT });
    const terms = glossary.data as {
      definitions: { name: string }[];
      candidates: { name: string; definition: null }[];
    };
    assertEquals(terms.definitions.map((term) => term.name), ["범위"]);
    assertEquals(terms.candidates.map((term) => term.name), ["경계"]);
    assertEquals(glossary.summary.startsWith("용어 정의 1개, 후보 1개"), true);

    // 문서를 참조하는 context.
    const of = await run({
      op: "of",
      target: { kind: "document", document: DOC, section: null },
    });
    assertEquals(
      (of.data as { contexts: { id: string }[] }).contexts.map((c) => c.id),
      [CONTEXT],
    );
  } finally {
    await close(opened);
  }
});

Deno.test("coding-agent/mcp-server#R17: 범위 밖 자격에는 있는 context도 없는 context와 같은 not_found다", async () => {
  const opened = await open();
  try {
    await savedSource(opened);
    await createContexts(opened);
    const { run } = agent(opened, LIMITED_TOKEN);
    const hidden = await run({ op: "show", context: CONTEXT });
    const absent = await run({
      op: "show",
      context: "ctx_01arz3ndektsv4rrffq69g5fb9",
    });
    assertEquals(hidden.isError, true);
    assertEquals(absent.isError, true);
    assertEquals(
      (hidden.data as { code: string }).code,
      (absent.data as { code: string }).code,
    );
    assertEquals(hidden.summary, absent.summary);
    // propose도 같다: 읽을 수 없는 context의 변경안은 접수하지 않는다.
    const proposed = await run({
      op: "propose",
      change: { kind: "rename", context: CONTEXT, title: "새 이름" },
      reason: "더 정확하다",
    });
    assertEquals(proposed.isError, true);
    const refused = await run({
      op: "propose",
      change: {
        kind: "rename",
        context: "ctx_01arz3ndektsv4rrffq69g5fb9",
        title: "새 이름",
      },
      reason: "더 정확하다",
    });
    assertEquals(proposed.summary, refused.summary);
  } finally {
    await close(opened);
  }
});

Deno.test("coding-agent/mcp-server#R17 coding-agent/cli#R19: 생성·이름 변경·항목 추가와 제거·관점 변경·용어 추가와 채택 변경이 변경안 문서로 보존되고 context·용어는 그대로다", async () => {
  const opened = await open();
  try {
    const source = await savedSource(opened);
    await createContexts(opened);
    const { client, run } = agent(opened);
    const before = await contextState(opened);
    const itemTarget = { kind: "document", document: DOC, section: "문서" };
    const changes: Record<string, unknown>[] = [
      {
        kind: "create",
        id: NEW_CONTEXT,
        title: "새 묶음",
        purpose: "새로 읽을 관점",
        items: [{
          target: { kind: "document", document: DOC, section: null },
          perspective: "reference",
          reason: "참고한다",
        }],
      },
      { kind: "rename", context: CONTEXT, title: "판단 묶음 2" },
      {
        kind: "set_item",
        context: CONTEXT,
        item: {
          target: { kind: "document", document: DOC, section: "추가" },
          perspective: "reference",
          reason: "추가로 참고한다",
        },
      },
      {
        kind: "set_item",
        context: CONTEXT,
        item: {
          target: itemTarget,
          perspective: "watch",
          reason: "기준에서 watch로 바꾼다",
        },
      },
      { kind: "remove_item", context: CONTEXT, target: itemTarget },
      {
        kind: "term_propose",
        id: NEW_TERM,
        context: CONTEXT,
        name: "새 용어",
        evidence: [{
          document: DOC,
          version: source.version,
          section: "문서",
          start_line: null,
          end_line: null,
        }],
      },
      { kind: "term_update", term: TERM, definition: "다른 정의" },
    ];
    const addresses = new Set<string>();
    const documentIds: string[] = [];
    for (const change of changes) {
      const result = await run({
        op: "propose",
        change,
        reason: `이유: ${change.kind}`,
      });
      assertEquals(result.isError, undefined, JSON.stringify(result.data));
      const data = result.data as {
        proposal: { document: string; version: string; address: string };
        kind: string;
        applied: boolean;
        run_created: boolean;
        question_created: boolean;
      };
      assertEquals(data.kind, change.kind);
      assertEquals(data.applied, false);
      assertEquals(data.run_created, false);
      assertEquals(data.question_created, false);
      assertEquals(result.next[0].includes("Context Engineer"), true);
      addresses.add(data.proposal.address);
      documentIds.push(data.proposal.document);
    }
    // 변경안마다 다른 고정 문서가 남는다.
    assertEquals(addresses.size, changes.length);

    // 고정 주소로 다시 읽으면 저장된 변경안 문서다.
    const first = documentIds[0];
    const got = await client.read(documentGet, { document: first });
    assert(got.ok, got.ok ? "" : JSON.stringify(got.error));
    assertEquals(
      (got.value as { version: { number: number } }).version.number,
      1,
    );

    // 제안만으로 context·용어는 바뀌지 않았다. agent에게 context·term command operation이
    // 없으니 호출했다면 위에서 forbidden으로 실패했다.
    assertEquals(await contextState(opened), before);
    const listedContexts = await run({ op: "list", status: "all" });
    assertEquals(
      (listedContexts.data as { contexts: { id: string }[] }).contexts.some((
        c,
      ) => c.id === NEW_CONTEXT),
      false,
    );

    // 같은 변경안을 다시 내도 새 문서가 늘지 않는다.
    const again = await run({
      op: "propose",
      change: changes[1],
      reason: `이유: ${changes[1].kind}`,
    });
    assertEquals(again.isError, undefined);
    assertEquals(
      (again.data as { proposal: { document: string } }).proposal.document,
      documentIds[1],
    );
    const listed = await post(opened, "documents/list", {}, AGENT_TOKEN);
    assertEquals((listed.documents as unknown[]).length, changes.length + 1);
  } finally {
    await close(opened);
  }
});

Deno.test("coding-agent/mcp-server#R17 coding-agent/cli#R18: 폴더·untracked 파일 항목 제안은 거절되고 문서가 저장되지 않는다", async () => {
  const opened = await open();
  try {
    await savedSource(opened);
    await createContexts(opened);
    const { deps } = agent(opened);
    const before = await contextState(opened);
    const listedBefore = await post(opened, "documents/list", {}, AGENT_TOKEN);
    for (
      const target of [
        { kind: "folder", path: "/home/me/project" },
        { kind: "file", path: "notes/untracked.md" },
        { kind: "document", document: "/home/me/notes.md", section: null },
      ]
    ) {
      const refused = await proposeContextChange(deps, {
        change: {
          kind: "set_item",
          context: CONTEXT,
          item: { target, perspective: "basis", reason: "읽는다" },
        },
        reason: "기준으로 넣는다",
      });
      assert(!refused.ok);
      assertEquals(refused.error.code, "invalid_input");
      assertEquals(
        refused.error.message.includes("폴더나 untracked 파일"),
        true,
      );
    }
    const listedAfter = await post(opened, "documents/list", {}, AGENT_TOKEN);
    assertEquals(listedAfter.documents, listedBefore.documents);
    assertEquals(await contextState(opened), before);
  } finally {
    await close(opened);
  }
});
