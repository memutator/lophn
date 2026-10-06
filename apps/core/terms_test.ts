// documents/terms#R1·R2·R4·R5: 실제 core에서 문서·context를 만들고 용어를 제안·정의·
// 수정·보관한 뒤 read로 읽는다. 데이터 root는 harness가 만든 temp dir다. 사람 데이터
// root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import {
  saveFromPaths,
  uploadPrepareBytes,
} from "../../packages/coding-agent/connection/mod.ts";
import { documentIdForKey } from "../../packages/coding-agent/connection/document-save.ts";
import { type CoreHarness, createCoreHarness } from "./testing/core.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { type Core, startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";
import { lophnAgentDefinitions } from "./lophn-agent.ts";

const teams: TeamModule[] = [
  { lophnAgentDefinitions },
  { createLedgerRegistration },
];
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const AGENT_TOKEN = "a".repeat(43);
const USER_TOKEN = "u".repeat(43);
// 실제 문서의 ID는 저장 key에서 정해진다(coding agent 저장 통로).
const SAVE_KEY = "terms-source";
const DOC = await documentIdForKey(SAVE_KEY);
const CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fav";
const CANDIDATE = "trm_01arz3ndektsv4rrffq69g5fav";
const DIRECT = "trm_01arz3ndektsv4rrffq69g5faw";

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
    teamModules: [
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./documents.ts", import.meta.url).href,
    ],
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
  return { harness, token: issued.value.token };
}

// 실제 core·documents worker·I/O worker·format runner. 문서는 coding agent 저장 통로로
// 임시 폴더의 파일을 올려 만들고 derived index가 오를 때까지 기다린다(용어 근거 확인이
// derived store의 고정 판 본문을 읽는다).
const REAL_OPERATIONS = [...OPERATIONS, "search.query"];
const SOURCE_TEXT = [
  "# 용어",
  "",
  "## 요약",
  "",
  "범위는 이번 판단의 대상이다.",
  "",
  "## 부록",
  "",
  "경계는 여기 적지 않는다.",
  "",
].join("\n");

type Real = {
  core: Core;
  token: string;
  version: string;
  dispose(): Promise<void>;
};

async function openReal(): Promise<Real> {
  const home = await Deno.makeTempDir({ prefix: "lophn-terms-" });
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-terms-work-" }),
  );
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./documents.ts", import.meta.url).href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(41),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  for (
    const [context, token] of [
      [{
        principal: "user-1",
        actor: "user" as const,
        credential_ref: "cred-user",
        scope: { operations: REAL_OPERATIONS, targets: {} },
        conditions: {},
      }, USER_TOKEN],
      [{
        principal: `coding_agent:${CAC}`,
        actor: `coding_agent:${CAC}` as const,
        credential_ref: "cred-agent",
        scope: {
          operations: [
            "document.upload",
            "document.prepare",
            "document.save",
            "document.list",
          ],
          targets: {},
        },
        conditions: {},
      }, AGENT_TOKEN],
    ] satisfies [AuthenticatedContext, string][]
  ) {
    const accepted = await core.acceptTestCredential?.(context, token);
    assert(accepted?.ok);
    const recorded = await core.record(context);
    assert(recorded.ok);
  }
  await Deno.writeTextFile(`${work}/terms.md`, SOURCE_TEXT);
  const client = createCoreClient({
    baseUrl: `http://127.0.0.1:${core.port}`,
    connection: CAC,
    provider: () =>
      Promise.resolve({ ok: true, value: { token: AGENT_TOKEN } }),
  });
  const saved = await saveFromPaths(
    {
      client,
      scope: { root: work, forbidden: [home] },
      prepareBytes: uploadPrepareBytes(client),
    },
    { paths: ["terms.md"], title: "용어", idempotency_key: SAVE_KEY },
  );
  assert(saved.ok, saved.ok ? "" : JSON.stringify(saved.error));
  assertEquals(saved.value.saved.document, DOC);
  const deadline = Date.now() + 60_000;
  for (;;) {
    const found = await fetch(`http://127.0.0.1:${core.port}/v1/search/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${USER_TOKEN}`,
      },
      body: JSON.stringify({ query: "이번 판단" }),
    });
    const body = await found.json() as { results?: unknown[] };
    if ((body.results ?? []).length > 0) break;
    assert(Date.now() < deadline, "문서가 index에 오르지 않았다");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return {
    core,
    token: USER_TOKEN,
    version: saved.value.saved.version,
    async dispose() {
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
      await Deno.remove(work, { recursive: true });
    },
  };
}

function post(
  harness: { port: number },
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
  const real = await openReal();
  const harness = real.core;
  const token = real.token;
  const saved = { version: real.version };
  try {
    await json(
      await post(harness, "contexts/create", {
        input: { id: CONTEXT, title: "판단 기준", purpose: "용어", items: [] },
        idempotency_key: "ctx-create",
        compare: {},
        prepared: [],
      }, token),
    );

    // 후보는 저장한 고정 판의 section 근거를 달아 제안한다. 이름이 그 section 본문에 나와야 한다.
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

    // route 앞단의 출현 확인(Q8): 근거 section 본문에 이름이 없으면 command를 부르지 않고
    // 거절한다. 다른 section(부록)에만 있는 이름도 같다. 용어는 만들어지지 않는다.
    const absent = await json<{ error: { code: string } }>(
      await post(harness, "terms/propose", {
        input: {
          id: DIRECT,
          context: CONTEXT,
          name: "경계",
          evidence: [evidence],
        },
        idempotency_key: "term-absent",
        compare: {},
        prepared: [],
      }, token),
      400,
    );
    assertEquals(absent.error.code, "invalid_input");
    const noSuchSection = await json<{ error: { code: string } }>(
      await post(harness, "terms/propose", {
        input: {
          id: DIRECT,
          context: CONTEXT,
          name: "범위",
          evidence: [{ ...evidence, section: "없는 section" }],
        },
        idempotency_key: "term-no-section",
        compare: {},
        prepared: [],
      }, token),
      400,
    );
    assertEquals(noSuchSection.error.code, "invalid_input");
    const none = await json<{ candidates: TermBody[] }>(
      await post(harness, "terms/list", { context: CONTEXT }, token),
    );
    assertEquals(none.candidates.map((term) => term.name), ["범위"]);

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

    // 근거를 바꾸는 update도 같은 확인을 지난다: 이름이 나오지 않는 section으로는 바꾸지 못한다.
    const wrongEvidence = await json<{ error: { code: string } }>(
      await post(harness, "terms/update", {
        input: {
          term: CANDIDATE,
          evidence: [{ ...evidence, section: "부록" }],
        },
        idempotency_key: "term-evidence-wrong",
        compare: { base_revision: defined.revision },
        prepared: [],
      }, token),
      400,
    );
    assertEquals(wrongEvidence.error.code, "invalid_input");

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
    await real.dispose();
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
