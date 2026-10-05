// documents/contexts#R1·R2·R5·R8: 실제 core에서 context를 만들고 항목을 더한 뒤
// read로 읽는다. 데이터 root는 harness가 만든 temp dir다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { type CoreHarness, createCoreHarness } from "./testing/core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";

const teams: TeamModule[] = [{ createLedgerRegistration }];
const HASH = "ab".repeat(32);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fav";

function prepared(base: string | null, key: string) {
  return {
    document: DOC,
    base_version: base,
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
    ...(base === null
      ? { metadata: { title: "Notes", place: null, name: null } }
      : {}),
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

const OPERATIONS = [
  "document.save",
  "context.create",
  "context.update",
  "context.set_item",
  "context.remove_item",
  "context.archive",
  "context.list",
  "context.get",
  "context.related",
];

async function open(): Promise<{ harness: CoreHarness; token: string }> {
  const opened = await createCoreHarness({
    teams,
    teamModules: [new URL("./documents.ts", import.meta.url).href],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  const issued = await harness.credential({
    actor: "user",
    principal: "user-1",
    scope: {
      operations: OPERATIONS,
      targets: {},
    },
    conditions: {},
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  const noted = await harness.notePrepared(
    {
      preparation: "prep-create",
      principal: "user-1",
      purpose: "document_files",
      hash: HASH,
      size_bytes: 0,
    },
    Date.UTC(2024, 0, 1),
  );
  assert(noted.ok, noted.ok ? "" : noted.error.message);
  const notedFile = await harness.notePrepared(
    {
      preparation: "prep-file-create",
      principal: "user-1",
      purpose: "document_file",
      hash: HASH,
      size_bytes: 10,
    },
    Date.UTC(2024, 0, 1),
  );
  assert(notedFile.ok, notedFile.ok ? "" : notedFile.error.message);
  return { harness, token: issued.value.token };
}

function post(
  harness: CoreHarness,
  path: string,
  body: unknown,
  token: string,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

Deno.test("documents/contexts#R2 #R5: core에서 문서를 만들고 context 항목으로 넣어 read로 읽는다", async () => {
  const { harness, token } = await open();
  try {
    // 먼저 문서를 확정한다(context 항목의 대상이다).
    const saved = await post(harness, "documents/save", {
      input: prepared(null, "create"),
      idempotency_key: "create",
      compare: { base_version: null },
      prepared: ["prep-create"],
    }, token);
    const savedText = await saved.text();
    assertEquals(saved.status, 200, savedText);
    const first = JSON.parse(savedText) as { status: string; version: string };
    assertEquals(first.status, "saved");

    // context 생성. 문서 전체 항목 하나다.
    const created = await post(harness, "contexts/create", {
      input: {
        id: CONTEXT,
        title: "판단 기준",
        purpose: "기준 자료 묶음",
        items: [{
          target: { kind: "document", document: DOC, section: null },
          perspective: "basis",
          reason: "판단의 근거 문서",
        }],
      },
      idempotency_key: "ctx-create",
      compare: {},
      prepared: [],
    }, token);
    const createdText = await created.text();
    assertEquals(created.status, 200, createdText);
    const context = JSON.parse(createdText) as {
      id: string;
      title: string;
      revision: string;
      status: string;
      items: {
        target: { document: string; section: string | null };
        perspective: string;
        reason: string;
      }[];
    };
    assertEquals(context.id, CONTEXT);
    assertEquals(context.status, "active");
    assertEquals(context.items.length, 1);
    assertEquals(context.items[0].target.section, null);
    assertEquals(context.items[0].perspective, "basis");
    assertEquals(context.items[0].reason, "판단의 근거 문서");

    // 항목 추가(section target).
    const setItem = await post(harness, "contexts/set_item", {
      input: {
        context: CONTEXT,
        item: {
          target: { kind: "document", document: DOC, section: "요약" },
          perspective: "watch",
          reason: "변화 확인",
        },
      },
      idempotency_key: "ctx-set",
      compare: { base_revision: context.revision },
      prepared: [],
    }, token);
    const setText = await setItem.text();
    assertEquals(setItem.status, 200, setText);
    const withSection = JSON.parse(setText) as {
      revision: string;
      items: { target: { section: string | null }; perspective: string }[];
    };
    assertEquals(withSection.items.length, 2);

    // get으로 읽는다.
    const got = await post(harness, "contexts/get", {
      context: CONTEXT,
    }, token);
    const gotText = await got.text();
    assertEquals(got.status, 200, gotText);
    const detail = JSON.parse(gotText) as {
      context: { id: string; items: { perspective: string }[] };
    };
    assertEquals(detail.context.id, CONTEXT);
    assertEquals(
      detail.context.items.map((entry) => entry.perspective),
      ["basis", "watch"],
    );

    // related는 항목이 직접 든 context를 계산한다.
    const related = await post(harness, "contexts/related", {
      target: { kind: "document", document: DOC, section: null },
    }, token);
    const relatedText = await related.text();
    assertEquals(related.status, 200, relatedText);
    const relatedPage = JSON.parse(relatedText) as {
      contexts: { id: string }[];
      complete: boolean;
    };
    assertEquals(relatedPage.contexts.map((entry) => entry.id), [CONTEXT]);
    assertEquals(relatedPage.complete, true);

    // 목록.
    const listed = await post(harness, "contexts/list", {}, token);
    const listedText = await listed.text();
    assertEquals(listed.status, 200, listedText);
    const page = JSON.parse(listedText) as { contexts: { id: string }[] };
    assertEquals(page.contexts.map((entry) => entry.id), [CONTEXT]);
  } finally {
    await harness.close();
  }
});

Deno.test("documents/contexts#R2: 저장 판이 없는 문서 항목은 거절한다", async () => {
  const { harness, token } = await open();
  try {
    const created = await post(harness, "contexts/create", {
      input: {
        id: CONTEXT,
        title: "기준",
        purpose: "기준 자료",
        items: [{
          target: { kind: "document", document: DOC, section: null },
          perspective: "basis",
          reason: "없는 문서",
        }],
      },
      idempotency_key: "ctx-missing",
      compare: {},
      prepared: [],
    }, token);
    const text = await created.text();
    const body = JSON.parse(text) as { error?: { code?: string } };
    assertEquals(created.status, 400, text);
    assertEquals(body.error?.code, "invalid_input");
  } finally {
    await harness.close();
  }
});
