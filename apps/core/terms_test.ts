// documents/terms#R1·R2·R4·R5: 실제 core에서 문서·context를 만들고 용어를 제안·정의·
// 수정·보관한 뒤 read로 읽는다. 데이터 root는 harness가 만든 temp dir다. 사람 데이터
// root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { type CoreHarness, createCoreHarness } from "./testing/core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";

const teams: TeamModule[] = [{ createLedgerRegistration }];
const HASH = "ab".repeat(32);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fav";
const CANDIDATE = "trm_01arz3ndektsv4rrffq69g5fav";
const DIRECT = "trm_01arz3ndektsv4rrffq69g5faw";

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
    metadata: { title: "Notes", place: null, name: null },
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
  "term.propose",
  "term.define",
  "term.update",
  "term.archive",
  "term.unarchive",
  "term.list",
  "term.get",
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
    scope: { operations: OPERATIONS, targets: {} },
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

type TermBody = {
  id: string;
  context: string;
  name: string;
  definition: string | null;
  evidence: { document: string; version: string; section: string | null }[];
  revision: string;
  status: string;
};

async function json<T>(response: Response, status = 200): Promise<T> {
  const text = await response.text();
  assertEquals(response.status, status, text);
  return JSON.parse(text) as T;
}

Deno.test("documents/terms#R1 #R2 #R4 #R5: core에서 후보를 제안하고 사람이 정의·수정·보관해 glossary로 읽는다", async () => {
  const { harness, token } = await open();
  try {
    const saved = await json<{ status: string; version: string }>(
      await post(harness, "documents/save", {
        input: prepared("create"),
        idempotency_key: "create",
        compare: { base_version: null },
        prepared: ["prep-create"],
      }, token),
    );
    assertEquals(saved.status, "saved");
    await json(
      await post(harness, "contexts/create", {
        input: { id: CONTEXT, title: "판단 기준", purpose: "용어", items: [] },
        idempotency_key: "ctx-create",
        compare: {},
        prepared: [],
      }, token),
    );

    // 후보는 저장한 고정 판의 section 근거를 달아 제안한다.
    const evidence = {
      document: DOC,
      version: saved.version,
      section: "요약",
      start_line: null,
      end_line: null,
    };
    const candidate = await json<TermBody>(
      await post(harness, "terms/propose", {
        input: {
          id: CANDIDATE,
          context: CONTEXT,
          name: "범위",
          evidence: [evidence],
        },
        idempotency_key: "term-propose",
        compare: {},
        prepared: [],
      }, token),
    );
    assertEquals(candidate.definition, null);
    assertEquals(candidate.evidence[0].version, saved.version);

    // 근거 없는 후보와 없는 판의 근거는 거절된다.
    const bare = await json<{ error: { code: string } }>(
      await post(harness, "terms/propose", {
        input: {
          id: DIRECT,
          context: CONTEXT,
          name: "근거 없음",
          evidence: [],
        },
        idempotency_key: "term-bare",
        compare: {},
        prepared: [],
      }, token),
      400,
    );
    assertEquals(bare.error.code, "invalid_input");
    const missing = await json<{ error: { code: string } }>(
      await post(harness, "terms/propose", {
        input: {
          id: DIRECT,
          context: CONTEXT,
          name: "없는 판",
          evidence: [{
            ...evidence,
            version: "ver_01arz3ndektsv4rrffq69g5fzz",
          }],
        },
        idempotency_key: "term-missing",
        compare: {},
        prepared: [],
      }, token),
      400,
    );
    assertEquals(missing.error.code, "invalid_input");

    // 사람이 후보를 정의한다.
    const defined = await json<TermBody>(
      await post(harness, "terms/define", {
        input: {
          term: CANDIDATE,
          name: "범위",
          definition: "이번 판단의 대상",
        },
        idempotency_key: "term-define",
        compare: { base_revision: candidate.revision },
        prepared: [],
      }, token),
    );
    assertEquals(defined.definition, "이번 판단의 대상");
    assertEquals(defined.evidence, candidate.evidence);

    // 후보 없이 새 용어를 직접 정의한다. 같은 이름은 conflict다.
    const direct = await json<TermBody>(
      await post(harness, "terms/define", {
        input: {
          id: DIRECT,
          context: CONTEXT,
          name: "직접",
          definition: "바로 정의",
        },
        idempotency_key: "term-direct",
        compare: {},
        prepared: [],
      }, token),
    );
    assertEquals(direct.evidence, []);
    const clash = await json<{ error: { code: string } }>(
      await post(harness, "terms/define", {
        input: {
          id: "trm_01arz3ndektsv4rrffq69g5fax",
          context: CONTEXT,
          name: "직접",
          definition: "중복",
        },
        idempotency_key: "term-clash",
        compare: {},
        prepared: [],
      }, token),
      409,
    );
    assertEquals(clash.error.code, "conflict");

    // 사람이 정의를 고치고 오래된 revision은 conflict다.
    const updated = await json<TermBody>(
      await post(harness, "terms/update", {
        input: { term: CANDIDATE, definition: "고친 뜻" },
        idempotency_key: "term-update",
        compare: { base_revision: defined.revision },
        prepared: [],
      }, token),
    );
    assertEquals(updated.definition, "고친 뜻");
    await json(
      await post(harness, "terms/update", {
        input: { term: CANDIDATE, definition: "낡은 revision" },
        idempotency_key: "term-stale",
        compare: { base_revision: defined.revision },
        prepared: [],
      }, token),
      409,
    );

    // glossary는 정의를 목록에, 후보는 별도로 읽는다.
    const listed = await json<{
      definitions: TermBody[];
      candidates: TermBody[];
      complete: boolean;
    }>(await post(harness, "terms/list", { context: CONTEXT }, token));
    assertEquals(listed.definitions.map((term) => term.name), [
      "범위",
      "직접",
    ]);
    assertEquals(listed.candidates, []);
    assertEquals(listed.complete, true);

    // 보관하면 목록에서 빠지고 get으로는 정의와 근거가 그대로 읽힌다.
    const archived = await json<TermBody>(
      await post(harness, "terms/archive", {
        input: { term: CANDIDATE },
        idempotency_key: "term-archive",
        compare: { base_revision: updated.revision },
        prepared: [],
      }, token),
    );
    assertEquals(archived.status, "archived");
    const got = await json<{ term: TermBody }>(
      await post(harness, "terms/get", { term: CANDIDATE }, token),
    );
    assertEquals(got.term.definition, "고친 뜻");
    assertEquals(got.term.evidence.length, 1);
    const after = await json<{ definitions: TermBody[] }>(
      await post(harness, "terms/list", { context: CONTEXT }, token),
    );
    assertEquals(after.definitions.map((term) => term.name), ["직접"]);
    const restored = await json<TermBody>(
      await post(harness, "terms/unarchive", {
        input: { term: CANDIDATE },
        idempotency_key: "term-unarchive",
        compare: { base_revision: archived.revision },
        prepared: [],
      }, token),
    );
    assertEquals(restored.status, "active");
  } finally {
    await harness.close();
  }
});

Deno.test("documents/terms#R2: agent 자격은 정의를 확정하지 못한다", async () => {
  const { harness } = await open();
  try {
    const issued = await harness.credential({
      actor: "coding_agent",
      principal: "user-1",
      scope: { operations: OPERATIONS, targets: {} },
      conditions: {},
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    const response = await post(harness, "terms/define", {
      input: {
        id: CANDIDATE,
        context: CONTEXT,
        name: "범위",
        definition: "뜻",
      },
      idempotency_key: "agent-define",
      compare: {},
      prepared: [],
    }, issued.value.token);
    const text = await response.text();
    assertEquals(response.status, 403, text);
  } finally {
    await harness.close();
  }
});
