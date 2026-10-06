// documents/versions#R8: `/v1/documents/file`을 제품 core가 판의 경로별 원문 bytes로 서빙한다.
// 여러 파일을 가진 판은 coding agent의 저장 경로로 만든다(core, documents worker, I/O worker는
// 모두 실제 자식 프로세스, 데이터 root는 temp dir). 사람 데이터 root는 열지 않는다.
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
import { lophnAgentDefinitions } from "./lophn-agent.ts";

const teams: TeamModule[] = [
  { lophnAgentDefinitions },
  { createLedgerRegistration },
];
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const AGENT_TOKEN = "a".repeat(43);
const LIMITED_TOKEN = "b".repeat(43);
const USER_TOKEN = "c".repeat(43);
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const ABSENT_VERSION = "ver_01arz3ndektsv4rrffq69g5fb9";

type Opened = {
  core: Core;
  home: string;
  work: string;
  dispose(): Promise<void>;
};

async function open(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-doc-file-" });
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-doc-file-work-" }),
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
    random: seededRandom(23),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
    await Deno.remove(home, { recursive: true });
    await Deno.remove(work, { recursive: true });
  });
  const core = started.value;
  const operations = [
    "document.upload",
    "document.prepare",
    "document.save",
    "document.list",
    "document.file",
  ];
  const contexts: [AuthenticatedContext, string][] = [
    [{
      principal: `coding_agent:${CAC}`,
      actor: `coding_agent:${CAC}`,
      scope: { operations, targets: {} },
      conditions: {},
      credential_ref: "cred-agent",
    }, AGENT_TOKEN],
    // 다른 문서만 닿는 자격. 이 판은 없는 판과 같아야 한다.
    [{
      principal: `coding_agent:${CAC}`,
      actor: `coding_agent:${CAC}`,
      scope: {
        operations: ["document.file"],
        targets: { document: "doc_01arz3ndektsv4rrffq69g5fb0" },
      },
      conditions: {},
      credential_ref: "cred-limited",
    }, LIMITED_TOKEN],
    [{
      principal: "user",
      actor: "user",
      scope: { operations: ["project.create"], targets: {} },
      conditions: {},
      credential_ref: "cred-user",
    }, USER_TOKEN],
  ];
  for (const [context, token] of contexts) {
    const accepted = await core.acceptTestCredential?.(context, token);
    assert(accepted?.ok);
    const recorded = await core.record(context);
    assert(recorded.ok);
  }
  guard.keep();
  return {
    core,
    home,
    work,
    async dispose() {
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
      await Deno.remove(work, { recursive: true });
    },
  };
}

async function readFile(
  core: Core,
  version: string,
  path: string,
  token = AGENT_TOKEN,
): Promise<{ status: number; bytes: Uint8Array }> {
  const response = await fetch(
    `http://127.0.0.1:${core.port}/v1/documents/file`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ version, path }),
    },
  );
  return {
    status: response.status,
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

Deno.test("documents/versions#R8: 여러 파일을 가진 판은 경로마다 원문 bytes 그대로 읽히고 옛 판은 그 판의 bytes다", async () => {
  const opened = await open();
  try {
    const created = await fetch(
      `http://127.0.0.1:${opened.core.port}/v1/projects/create`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${USER_TOKEN}`,
        },
        body: JSON.stringify({
          input: {
            id: PROJECT,
            name: "mahas",
            title: "Notes",
            purpose: "",
            folders: [{
              path: `${opened.work}/project-folder`,
              description: "",
            }],
            tracking: { enabled: false, patterns: [], use_gitignore: false },
          },
          idempotency_key: "project-1",
          compare: {},
          prepared: [],
        }),
      },
    );
    assertEquals(created.status, 200, await created.text());
    await Deno.mkdir(`${opened.work}/notes`);
    const plan = "# 계획\n본문\n";
    const extra = "첨부 하나\n둘째 줄\n";
    await Deno.writeTextFile(`${opened.work}/notes/plan.md`, plan);
    await Deno.writeTextFile(`${opened.work}/notes/extra.txt`, extra);
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
    const input = {
      paths: ["notes/plan.md", "notes/extra.txt"],
      place: { kind: "project" as const, id: PROJECT },
      slug: "plan",
    };
    const first = await saveFromPaths(deps, input);
    assert(first.ok, first.ok ? "" : JSON.stringify(first.error));
    // 한 파일만 고친 두 번째 판은 같은 문서의 다음 판이다.
    const edited = "첨부 하나\n고친 둘째 줄, 더 길다\n";
    await Deno.writeTextFile(`${opened.work}/notes/extra.txt`, edited);
    const second = await saveFromPaths(deps, input);
    assert(second.ok, second.ok ? "" : JSON.stringify(second.error));
    assertEquals(second.value.saved.document, first.value.saved.document);
    assert(second.value.saved.version !== first.value.saved.version);
    const encode = (text: string) => new TextEncoder().encode(text);

    const expected: [string, string, string][] = [
      [first.value.saved.version, "plan.md", plan],
      [first.value.saved.version, "extra.txt", extra],
      [second.value.saved.version, "plan.md", plan],
      [second.value.saved.version, "extra.txt", edited],
    ];
    for (const [version, path, text] of expected) {
      const got = await readFile(opened.core, version, path);
      assertEquals(got.status, 200, `${version} ${path}`);
      assertEquals(got.bytes, encode(text), `${version} ${path}`);
    }

    // 판에 없는 경로·없는 판·범위 밖 자격은 모두 같은 답이고 bytes가 없다.
    const noPath = await readFile(
      opened.core,
      first.value.saved.version,
      "none.md",
    );
    const noVersion = await readFile(opened.core, ABSENT_VERSION, "plan.md");
    const hidden = await readFile(
      opened.core,
      first.value.saved.version,
      "plan.md",
      LIMITED_TOKEN,
    );
    const absentToLimited = await readFile(
      opened.core,
      ABSENT_VERSION,
      "plan.md",
      LIMITED_TOKEN,
    );
    assertEquals(noPath.status, 404);
    assertEquals(noVersion.status, 404);
    assertEquals(hidden.status, absentToLimited.status);
    assertEquals(hidden.bytes, absentToLimited.bytes);
    assertEquals(hidden.bytes, noVersion.bytes);
  } finally {
    await opened.dispose();
  }
});
