// documents/file-tracking#R9·R3, documents/versions#R13: 제품 core가 documents worker를
// 실제 자식 프로세스로 띄우고 감독 pipe로 묻는다. 데이터 root는 temp dir다. 사람
// 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { createCoreClient, productFetch } from "../worker/documents/submit.ts";
import { type Core, startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";

const teams: TeamModule[] = [{ createLedgerRegistration }];
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const TOKEN = "c".repeat(43);

type Hello = { credential: string; api_port: number };

async function openCore(
  superviseIo: boolean,
  onHello?: (hello: Hello) => void,
): Promise<{ core: Core; home: string }> {
  const home = await Deno.makeTempDir({ prefix: "lophn-docs-worker-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [new URL("./documents.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(3),
    testCredentials: true,
    superviseIo,
    ...(onHello === undefined ? {} : { onDocumentsHello: onHello }),
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const context: AuthenticatedContext = {
    principal: "user-1",
    actor: "user",
    scope: { operations: ["files.status"], targets: {} },
    conditions: {},
    credential_ref: "cred-docs-worker",
  };
  const accepted = await started.value.acceptTestCredential?.(context, TOKEN);
  assert(accepted?.ok);
  const recorded = await started.value.record(context);
  assert(recorded.ok);
  return { core: started.value, home };
}

function status(port: number): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/v1/files/status`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      target: { kind: "project_file", project: PROJECT, path: "/work/a.md" },
    }),
  });
}

Deno.test("documents/file-tracking#R9: documents worker가 없으면 FileStatus는 추적 안 함이 아니라 unavailable이다", async () => {
  const { core, home } = await openCore(false);
  try {
    const answer = await status(core.port);
    const body = await answer.json() as { error?: { code?: string } };
    assertEquals(answer.status, 503);
    assertEquals(body.error?.code, "unavailable");
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("documents/file-tracking#R9: 실제 documents worker가 감독 pipe로 관측 없음을 답하면 추적 안 함이다", async () => {
  const { core, home } = await openCore(true);
  try {
    const answer = await status(core.port);
    const body = await answer.json() as {
      status?: { state?: string; observed_hash?: string | null };
    };
    assertEquals(answer.status, 200, JSON.stringify(body));
    assertEquals(body.status?.state, "not_tracked");
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

const HASH = "ab".repeat(32);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const AT = Date.UTC(2024, 0, 1);

function prepared(key: string, base: string | null) {
  return {
    document: DOC,
    base_version: base,
    files_hash: HASH,
    file_count: 1,
    primary_path: "a.md",
    content_hash: HASH,
    preparation_ref: `prep-${key}`,
    idempotency_key: key,
    ...(base === null
      ? { metadata: { title: "관측", place: null, name: null } }
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

Deno.test("documents/versions#R13: core가 hello로 준 machine credential은 document.save만 낸다", async () => {
  let hello: Hello | undefined;
  const { core, home } = await openCore(true, (value) => hello = value);
  try {
    assert(hello !== undefined, "hello가 documents worker에 가야 한다");
    assertEquals(hello.api_port, core.port);
    const client = createCoreClient({
      baseUrl: `http://127.0.0.1:${hello.api_port}`,
      credential: hello.credential,
      fetch: productFetch(),
    });
    assert(core.notePrepared);
    // 준비 참조의 principal은 저장 주체와 같아야 한다.
    const noted = await core.notePrepared({
      preparation: "prep-observe-1",
      principal: "machine:documents",
      purpose: "document_files",
      hash: HASH,
      size_bytes: 10,
    }, AT);
    assert(noted.ok, noted.ok ? "" : noted.error.message);
    const saved = await client.call("documents/save", {
      input: prepared("observe-1", null),
      idempotency_key: "observe-1",
      compare: { base_version: null },
      prepared: ["prep-observe-1"],
    });
    assert(saved.ok, saved.ok ? "" : saved.error.message);
    assertEquals((saved.value as { status: string }).status, "saved");
    // 다른 command와 read는 scope 밖이다.
    const create = await client.call("projects/create", {
      input: {},
      idempotency_key: "k",
      compare: {},
      prepared: [],
    });
    assert(!create.ok);
    assertEquals(create.error.code, "forbidden");
    const read = await client.call("files/status", {
      target: { kind: "project_file", project: PROJECT, path: "/a.md" },
    });
    assert(!read.ok);
    assertEquals(read.error.code, "forbidden");
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
