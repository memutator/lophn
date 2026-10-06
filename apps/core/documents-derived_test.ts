// documents/outline-and-search#R10·R11·R12·R14·R16: 제품 core가 documents coordinator의 derived
// store와 search consumer를 붙여 search·outline·읽기가 unavailable 대신 데이터를 돌려준다
// (documents#T21, T11·T13에서 넘어온 것). core·documents worker·I/O worker·format runner는
// 모두 실제 자식 프로세스고 데이터 root는 temp dir다. 사람 데이터 root는 열지 않는다.
// event는 core 안 구독자(machine:documents-feed)가 읽어 coordinator로 보낸다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import {
  saveFromPaths,
  uploadPrepareBytes,
} from "../../packages/coding-agent/connection/mod.ts";
import { type Core, startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

const teams: TeamModule[] = [{ createLedgerRegistration }];
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const AGENT_TOKEN = "a".repeat(43);
const USER_TOKEN = "c".repeat(43);
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";

const AGENT_OPERATIONS = [
  "document.upload",
  "document.prepare",
  "document.save",
  "document.list",
];
const USER_OPERATIONS = [
  "project.create",
  "document.archive",
  "document.unarchive",
  "document.get",
  "search.query",
  "search.status",
  "outline.place",
  "outline.document",
  "document.read",
];

type Opened = {
  core: Core;
  home: string;
  work: string;
  dispose(): Promise<void>;
};

async function open(home?: string, work?: string): Promise<Opened> {
  const reopening = home !== undefined;
  const dataRoot = home ??
    await Deno.makeTempDir({ prefix: "lophn-doc-derived-" });
  const workRoot = work ?? await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-doc-derived-work-" }),
  );
  const started = await startCore({
    lophnHome: dataRoot,
    port: 0,
    teams,
    teamModules: [new URL("./documents.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    // 다시 여는 core는 다른 seed로 새 자격 ref를 받는다(같은 ref의 기록은 한 번만 있다).
    random: seededRandom(reopening ? 32 : 31),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
    // 다시 여는 core의 폴더는 처음 연 시험의 것이다.
    if (!reopening) await Deno.remove(dataRoot, { recursive: true });
    if (work === undefined) await Deno.remove(workRoot, { recursive: true });
  });
  const core = started.value;
  const contexts: [AuthenticatedContext, string][] = [
    [{
      principal: `coding_agent:${CAC}`,
      actor: `coding_agent:${CAC}`,
      scope: { operations: AGENT_OPERATIONS, targets: {} },
      conditions: {},
      credential_ref: "cred-agent",
    }, AGENT_TOKEN],
    [{
      principal: "user",
      actor: "user",
      scope: { operations: USER_OPERATIONS, targets: {} },
      conditions: {},
      credential_ref: "cred-user",
    }, USER_TOKEN],
  ];
  for (const [context, token] of contexts) {
    const accepted = await core.acceptTestCredential?.(context, token);
    assert(accepted?.ok);
    // 같은 data root를 다시 열면 credential 기록은 이미 있다.
    if (reopening) continue;
    const recorded = await core.record(context);
    assert(recorded.ok);
  }
  guard.keep();
  return {
    core,
    home: dataRoot,
    work: workRoot,
    async dispose() {
      await core.shutdown();
      await Deno.remove(dataRoot, { recursive: true });
      await Deno.remove(workRoot, { recursive: true });
    },
  };
}

type Json = Record<string, unknown>;

async function post(
  core: Core,
  path: string,
  body: unknown,
  token = USER_TOKEN,
): Promise<{ status: number; body: Json }> {
  const response = await fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})) as Json,
  };
}

async function createProject(core: Core): Promise<void> {
  const created = await post(core, "projects/create", {
    input: {
      id: PROJECT,
      name: "mahas",
      title: "Notes",
      purpose: "",
      folders: [{ path: "/tmp/lophn-test-doc-derived", description: "" }],
      tracking: { enabled: false, patterns: [], use_gitignore: false },
    },
    idempotency_key: "project-1",
    compare: {},
    prepared: [],
  });
  assertEquals(created.status, 200, JSON.stringify(created.body));
}

function saver(opened: Opened) {
  const client = createCoreClient({
    baseUrl: `http://127.0.0.1:${opened.core.port}`,
    connection: CAC,
    provider: () =>
      Promise.resolve({ ok: true, value: { token: AGENT_TOKEN } }),
  });
  const deps = {
    client,
    scope: { root: opened.work, forbidden: [opened.home] },
    prepareBytes: uploadPrepareBytes(client),
  };
  return async (path: string, slug: string) => {
    const saved = await saveFromPaths(deps, {
      paths: [path],
      place: { kind: "project" as const, id: PROJECT },
      slug,
    });
    assert(saved.ok, saved.ok ? "" : JSON.stringify(saved.error));
    return saved.value.saved as { document: string; version: string };
  };
}

type Hit = { document: string; version: string; section: string | null };

async function search(core: Core, query: string): Promise<Hit[]> {
  const found = await post(core, "search/query", { query });
  assertEquals(found.status, 200, JSON.stringify(found.body));
  return found.body["results"] as Hit[];
}

// index가 따라올 때까지 기다린다. consumer는 event 구독을 따라 비동기로 반영한다.
async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  what: string,
): Promise<T> {
  const deadline = Date.now() + 60_000;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await read();
    if (done(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${what}: ${JSON.stringify(last)}`);
}

const PLAN = [
  "# 계획",
  "",
  "가을 출시 일정을 정한다.",
  "",
  "## 위험",
  "",
  "배포 승인이 늦어질 수 있다.",
  "",
].join("\n");

Deno.test("documents/outline-and-search#R10: 저장한 문서가 coordinator의 section 추출을 거쳐 search·outline·읽기에서 보인다", async () => {
  const opened = await open();
  try {
    await createProject(opened.core);
    await Deno.writeTextFile(`${opened.work}/plan.md`, PLAN);
    const saved = await saver(opened)("plan.md", "plan");

    // 두 글자 한글 질의(LIKE 갈래)와 세 글자 이상(FTS 갈래)이 모두 찾는다.
    const short = await until(
      () => search(opened.core, "계획"),
      (hits) => hits.length > 0,
      "search가 문서를 찾지 못했다",
    );
    assertEquals(short[0].document, saved.document);
    assertEquals(short[0].version, saved.version);
    const long = await search(opened.core, "배포 승인");
    assertEquals(long.length, 1);
    assertEquals(long[0].section !== null, true);
    assertEquals(await search(opened.core, "없는낱말"), []);

    // 같은 판의 section 목차와 본문 읽기도 derived store에서 온다.
    const outline = await post(opened.core, "outline/document", {
      reference: { document: saved.document, version: null, section: null },
    });
    assertEquals(outline.status, 200, JSON.stringify(outline.body));
    const titles = (outline.body["entries"] as { title: string }[]).map((
      entry,
    ) => entry.title);
    assertEquals(titles.includes("위험"), true, JSON.stringify(titles));
    const read = await post(opened.core, "documents/read", {
      reference: {
        document: saved.document,
        version: saved.version,
        section: null,
      },
    });
    assertEquals(read.status, 200, JSON.stringify(read.body));
    assertEquals(String(read.body["text"]).includes("가을 출시"), true);

    // 반영이 끝나면 coverage는 뒤처지지 않는다.
    const status = await post(opened.core, "search/status", {});
    assertEquals(status.status, 200, JSON.stringify(status.body));
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/outline-and-search#R11·R17: 고친 판은 새 본문으로 찾고 옛 낱말은 잃으며 보관한 문서는 결과에서 빠진다", async () => {
  const opened = await open();
  try {
    await createProject(opened.core);
    const save = saver(opened);
    await Deno.writeTextFile(`${opened.work}/plan.md`, PLAN);
    const first = await save("plan.md", "plan");
    await until(
      () => search(opened.core, "가을 출시"),
      (hits) => hits.length === 1,
      "첫 판이 index에 오르지 않았다",
    );
    await Deno.writeTextFile(
      `${opened.work}/plan.md`,
      PLAN.replace("가을 출시", "겨울 출시"),
    );
    const second = await save("plan.md", "plan");
    assertEquals(second.document, first.document);
    assert(second.version !== first.version);
    const winter = await until(
      () => search(opened.core, "겨울 출시"),
      (hits) => hits.length === 1,
      "고친 판이 index에 오르지 않았다",
    );
    assertEquals(winter[0].version, second.version);
    assertEquals(await search(opened.core, "가을 출시"), []);

    // 보관하면 기본 결과에서 빠지고, 보관 해제 뒤 다시 보인다.
    const revision = async () => {
      const got = await post(opened.core, "documents/get", {
        document: first.document,
      });
      assertEquals(got.status, 200, JSON.stringify(got.body));
      return (got.body["document"] as { revision: string }).revision;
    };
    const archived = await post(opened.core, "documents/archive", {
      input: { document: first.document },
      idempotency_key: "archive-1",
      compare: { base_revision: await revision() },
      prepared: [],
    });
    assertEquals(archived.status, 200, JSON.stringify(archived.body));
    await until(
      () => search(opened.core, "겨울 출시"),
      (hits) => hits.length === 0,
      "보관한 문서가 결과에 남았다",
    );
    const unarchived = await post(opened.core, "documents/unarchive", {
      input: { document: first.document },
      idempotency_key: "unarchive-1",
      compare: { base_revision: await revision() },
      prepared: [],
    });
    assertEquals(unarchived.status, 200, JSON.stringify(unarchived.body));
    await until(
      () => search(opened.core, "겨울 출시"),
      (hits) => hits.length === 1,
      "보관을 푼 문서가 다시 보이지 않는다",
    );
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/outline-and-search#R10: core를 다시 띄워도 derived index는 남아 있고 이어서 반영한다", async () => {
  const opened = await open();
  let reopened: Opened | undefined;
  try {
    await createProject(opened.core);
    await Deno.writeTextFile(`${opened.work}/plan.md`, PLAN);
    const first = await saver(opened)("plan.md", "plan");
    await until(
      () => search(opened.core, "가을 출시"),
      (hits) => hits.length === 1,
      "첫 판이 index에 오르지 않았다",
    );
    // 같은 data root로 다시 띄운다. 이미 반영한 event는 다시 추출하지 않아도 결과가 남는다.
    await opened.core.shutdown();
    reopened = await open(opened.home, opened.work);
    const again = await until(
      () => search(reopened!.core, "가을 출시"),
      (hits) => hits.length === 1,
      "다시 띄운 뒤 index가 사라졌다",
    );
    assertEquals(again[0].document, first.document);
    // 다시 띄운 core에서 저장한 새 문서도 이어서 반영된다.
    await Deno.writeTextFile(
      `${reopened.work}/other.md`,
      "# 회고\n\n여름 점검 결과를 적는다.\n",
    );
    const other = await saver(reopened)("other.md", "other");
    const found = await until(
      () => search(reopened!.core, "여름 점검"),
      (hits) => hits.length === 1,
      "다시 띄운 뒤 저장한 문서가 반영되지 않았다",
    );
    assertEquals(found[0].document, other.document);
  } finally {
    await (reopened ?? opened).dispose();
  }
});

Deno.test("documents/outline-and-search#R14 documents/formats#R20: 대표 파일이 검사 한도(1 MiB)를 넘는 판은 runner를 부르지 않고 이유를 밝힌 미확인으로 남으며 뒤의 문서를 막지 않는다", async () => {
  const opened = await open();
  try {
    await createProject(opened.core);
    const save = saver(opened);
    // 1 MiB를 넘는 Markdown. 새 문서는 format을 지정하지 않아 저장은 되고 추출만 못 한다.
    const big = `# 큰 문서\n\n${"한 줄 본문이다. ".repeat(80_000)}\n`;
    await Deno.writeTextFile(`${opened.work}/big.md`, big);
    const first = await save("big.md", "big");
    await Deno.writeTextFile(`${opened.work}/plan.md`, PLAN);
    const second = await save("plan.md", "plan");
    // 큰 문서 뒤의 문서도 index에 오른다(큰 문서가 cursor를 막지 않는다).
    await until(
      () => search(opened.core, "배포 승인"),
      (hits) => hits.some((hit) => hit.document === second.document),
      "큰 문서 뒤의 문서가 index에 오르지 않았다",
    );
    const page = await post(opened.core, "search/query", {
      query: "배포 승인",
    });
    const omissions = (page.body["coverage"] as {
      omissions: { document: string; version: string; reason: string }[];
    }).omissions;
    const skipped = omissions.find((item) => item.document === first.document);
    assert(skipped !== undefined, JSON.stringify(omissions));
    assertEquals(skipped.version, first.version);
    assertEquals(skipped.reason.includes("over the 1048576 byte limit"), true);
    // 원문을 읽는 쪽은 구조를 읽지 못했다는 같은 이유를 받는다(원문 부재로 꾸미지 않는다).
    const read = await post(opened.core, "documents/read", {
      reference: {
        document: first.document,
        version: first.version,
        section: null,
      },
    });
    assertEquals(read.body["section_status"], "unverified");
    assertEquals(
      String(read.body["failure_reason"]).includes("byte limit"),
      true,
    );
  } finally {
    await opened.dispose();
  }
});
