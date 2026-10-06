// documents/versions#R8: `/v1/documents/file`은 판의 파일을 저장된 media type과 함께 창 단위
// stream으로 흘린다. core, documents worker, I/O worker는 모두 실제 자식 프로세스고 데이터
// root는 temp dir다. 사람 데이터 root는 열지 않는다.
import { createHash } from "node:crypto";
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  err,
  manualClock,
  ok,
  seededRandom,
  sha256Hex,
} from "../../packages/base/mod.ts";
import { DOCUMENT_UPLOAD_MAX_BYTES } from "../../packages/contracts/documents/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import {
  saveFromPaths,
  uploadPrepareBytes,
} from "../../packages/coding-agent/connection/mod.ts";
import { type Core, startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";
import {
  STORED_FILE_MAX_BYTES,
  storedFileStreams,
} from "./documents-serving.ts";

const teams: TeamModule[] = [{ createLedgerRegistration }];
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const AGENT_TOKEN = "a".repeat(43);
const USER_TOKEN = "c".repeat(43);
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const WINDOW = 256 * 1024;

type Opened = {
  core: Core;
  home: string;
  work: string;
  dispose(): Promise<void>;
};

async function open(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-doc-stream-" });
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-doc-stream-work-" }),
  );
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [new URL("./documents.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(29),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  const contexts: [AuthenticatedContext, string][] = [
    [{
      principal: `coding_agent:${CAC}`,
      actor: `coding_agent:${CAC}`,
      scope: {
        operations: [
          "document.upload",
          "document.prepare",
          "document.save",
          "document.list",
          "document.file",
        ],
        targets: {},
      },
      conditions: {},
      credential_ref: "cred-agent",
    }, AGENT_TOKEN],
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
  const created = await fetch(
    `http://127.0.0.1:${core.port}/v1/projects/create`,
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
          folders: [{ path: `${work}/project-folder`, description: "" }],
          tracking: { enabled: false, patterns: [], use_gitignore: false },
        },
        idempotency_key: "project-1",
        compare: {},
        prepared: [],
      }),
    },
  );
  assertEquals(created.status, 200, await created.text());
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

async function save(
  opened: Opened,
  files: Record<string, string | Uint8Array>,
  slug: string,
): Promise<string> {
  for (const [name, content] of Object.entries(files)) {
    await Deno.writeFile(
      `${opened.work}/${name}`,
      typeof content === "string" ? new TextEncoder().encode(content) : content,
    );
  }
  const client = createCoreClient({
    baseUrl: `http://127.0.0.1:${opened.core.port}`,
    connection: CAC,
    provider: () =>
      Promise.resolve({ ok: true, value: { token: AGENT_TOKEN } }),
  });
  const saved = await saveFromPaths({
    client,
    scope: { root: opened.work, forbidden: [opened.home] },
    prepareBytes: uploadPrepareBytes(client),
  }, {
    paths: Object.keys(files),
    place: { kind: "project" as const, id: PROJECT },
    slug,
  });
  assert(saved.ok, saved.ok ? "" : JSON.stringify(saved.error));
  return saved.value.saved.version;
}

function request(core: Core, version: string, path: string) {
  return fetch(`http://127.0.0.1:${core.port}/v1/documents/file`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${AGENT_TOKEN}`,
    },
    body: JSON.stringify({ version, path }),
  });
}

function blobFile(home: string, hash: string): string {
  return `${home}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`;
}

async function replaceBlob(file: string, bytes: Uint8Array): Promise<void> {
  await Deno.chmod(file, 0o600);
  await Deno.writeFile(file, bytes);
}

Deno.test("documents/versions#R8: documents/file은 저장된 media type과 정확한 길이를 싣는다", async () => {
  const opened = await open();
  try {
    const version = await save(opened, {
      "plan.md": "# 계획\n",
      "notes.txt": "메모\n",
    }, "types");
    const md = await request(opened.core, version, "plan.md");
    await md.arrayBuffer();
    assertEquals(md.status, 200);
    assertEquals(md.headers.get("content-type"), "text/markdown");
    assertEquals(
      md.headers.get("content-length"),
      String(new TextEncoder().encode("# 계획\n").length),
    );
    const txt = await request(opened.core, version, "notes.txt");
    await txt.arrayBuffer();
    assertEquals(txt.headers.get("content-type"), "text/plain");
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/versions#R8: 여러 창으로 이뤄진 파일은 실제 core에서 stream으로 원문 그대로 읽힌다", async () => {
  const opened = await open();
  try {
    // 256 KiB 창 네 개. 창마다 내용이 달라서 밀리거나 건너뛴 창이 hash에 드러난다.
    // 큰 파일의 저장은 documents-large-text_test.ts가 본다. 아래 서빙 대상 시험은 64 MiB를 본다.
    const size = 4 * WINDOW;
    const content = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      content[i] = 0x20 + ((i * 31 + (i >> 18)) % 90);
    }
    const version = await save(opened, { "big.txt": content }, "big");
    const response = await request(opened.core, version, "big.txt");
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-length"), String(size));
    const digest = createHash("sha256");
    let received = 0;
    let chunks = 0;
    for await (const chunk of response.body!) {
      digest.update(chunk);
      received += chunk.length;
      chunks++;
    }
    assertEquals(received, size);
    assertEquals(digest.digest("hex"), await sha256Hex(content));
    assert(chunks >= 4, "창 단위로 나뉘어 흘렀다");
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/versions#R8: 읽는 도중 blob이 판의 hash와 어긋나면 응답을 완료하지 않고 끊는다", async () => {
  const opened = await open();
  try {
    // 창 셋 남짓. 어긋남은 마지막 창을 읽은 뒤에야 드러나므로 앞 창은 이미 나간다.
    const size = 3 * WINDOW + 123;
    const content = new Uint8Array(size);
    for (let i = 0; i < size; i++) content[i] = 0x61 + (i % 23);
    const version = await save(opened, { "big.txt": content }, "tamper");
    // 크기는 같고 마지막 바이트만 다르다.
    const tampered = content.slice();
    tampered[tampered.length - 1] ^= 0x01;
    await replaceBlob(
      blobFile(opened.home, await sha256Hex(content)),
      tampered,
    );
    const response = await request(opened.core, version, "big.txt");
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-length"), String(size));
    let received = 0;
    await assertRejects(async () => {
      for await (const chunk of response.body!) received += chunk.length;
    });
    assert(received < size, "선언한 길이를 채운 응답으로 끝나면 안 된다");
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/versions#R8: 한 창짜리 파일의 hash 불일치는 헤더를 보내기 전에 unavailable이다", async () => {
  const opened = await open();
  try {
    const text = "작은 파일\n";
    const version = await save(opened, { "small.txt": text }, "small");
    await replaceBlob(
      blobFile(opened.home, await sha256Hex(text)),
      new TextEncoder().encode("다른 파일\n"),
    );
    const response = await request(opened.core, version, "small.txt");
    const body = await response.text();
    assertEquals(response.status, 503);
    assert(!body.includes("다른 파일"));
  } finally {
    await opened.dispose();
  }
});

// ---- 서빙 대상 자체: 64 MiB·끝에서의 어긋남 ----
// 판정(reader)과 blob 읽기(I/O worker)는 같은 모양의 port로 대신하고 stream 조립이 읽고
// 내보내는 순서·양·검사를 본다.

const CTX: AuthenticatedContext = {
  principal: "user",
  actor: "user",
  scope: { operations: ["document.file"], targets: {} },
  conditions: {},
  credential_ref: "cred-handler",
};

// 창마다 다른 내용을 `offset`에서 바로 만든다. 파일 전체를 들고 있지 않는다.
function patterned(offset: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = (offset + i) * 7 + ((offset + i) >> 18) & 0xff;
  }
  return out;
}

function hashOf(total: number): string {
  const digest = createHash("sha256");
  for (let at = 0; at < total; at += WINDOW) {
    digest.update(patterned(at, Math.min(WINDOW, total - at)));
  }
  return digest.digest("hex");
}

function servingHandler(
  total: number,
  hash: string,
  flip?: { at: number },
) {
  let reads = 0;
  let current = true;
  const handlers = storedFileStreams({
    readers: {
      read: () =>
        Promise.resolve(ok({ hash, bytes: total, media_type: "text/plain" })),
      health: () => ["healthy"],
    },
    current: () =>
      current ? ok(CTX) : err({ code: "unauthorized", message: "x" }),
    readBlob: (blob, offset, length) => {
      reads++;
      const bytes = patterned(offset, length);
      if (flip && offset <= flip.at && flip.at < offset + length) {
        bytes[flip.at - offset] ^= 0x01;
      }
      return Promise.resolve(ok({ hash: blob, sizeBytes: total, bytes }));
    },
    blobReady: () => true,
  });
  const handler = handlers.get("documents/file")!;
  return {
    open: () => handler(CTX, { version: "v", path: "p" }),
    reads: () => reads,
    revoke: () => (current = false),
  };
}

Deno.test("documents/versions#R8: 64 MiB 파일은 소비자가 당기는 만큼만 창을 읽고 core가 쥔 양이 창 한두 개로 묶인다", async () => {
  const total = 64 * 1024 * 1024;
  const serving = servingHandler(total, hashOf(total));
  const opened = await serving.open();
  assert(opened.ok);
  assertEquals(opened.value.contentType, "text/plain");
  assertEquals(opened.value.length, total);
  // 응답을 열기 전에는 첫 창만 읽었다.
  assertEquals(serving.reads(), 1);
  const reader = opened.value.body.getReader();
  const digest = createHash("sha256");
  let consumed = 0;
  let ahead = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    digest.update(next.value);
    consumed++;
    // 소비한 창보다 core가 더 읽어 둔 창 수. 파일 전체(256창)와 무관하게 묶인다.
    ahead = Math.max(ahead, serving.reads() - consumed);
  }
  assertEquals(consumed, total / WINDOW);
  assertEquals(serving.reads(), total / WINDOW);
  assert(ahead <= 1, `소비 앞서 읽은 창이 ${ahead}개다`);
  assertEquals(digest.digest("hex"), hashOf(total));
});

Deno.test("documents/versions#R8: 64 MiB 파일의 마지막 창이 어긋나면 그 창을 내보내지 않고 stream을 오류로 끝낸다", async () => {
  const total = 64 * 1024 * 1024;
  const serving = servingHandler(total, hashOf(total), { at: total - 5 });
  const opened = await serving.open();
  assert(opened.ok);
  const reader = opened.value.body.getReader();
  let windows = 0;
  await assertRejects(
    async () => {
      for (;;) {
        const next = await reader.read();
        if (next.done) return;
        windows++;
      }
    },
    Error,
    "do not match",
  );
  // 255개 창은 나갔고 어긋난 마지막 창은 나가지 않았다.
  assertEquals(windows, total / WINDOW - 1);
});

Deno.test("documents/versions#R8: 읽는 도중 credential이 회수되면 stream이 끊긴다", async () => {
  const total = 8 * WINDOW;
  const serving = servingHandler(total, hashOf(total));
  const opened = await serving.open();
  assert(opened.ok);
  const reader = opened.value.body.getReader();
  assert(!(await reader.read()).done);
  serving.revoke();
  await assertRejects(
    async () => {
      for (;;) {
        if ((await reader.read()).done) return;
      }
    },
    Error,
    "no longer current",
  );
});

Deno.test("documents/versions#R8: 문서 upload 상한(256 MiB)까지의 파일을 서빙하고 그보다 큰 판은 unavailable이다", async () => {
  const limit = DOCUMENT_UPLOAD_MAX_BYTES;
  assertEquals(STORED_FILE_MAX_BYTES, limit);
  const within = servingHandler(limit, "a".repeat(64));
  const served = await within.open();
  assert(served.ok);
  assertEquals(served.value.length, limit);
  await served.value.body.cancel();
  const over = servingHandler(limit + 1, "a".repeat(64));
  const refused = await over.open();
  assert(!refused.ok);
  assertEquals(refused.error.code, "unavailable");
  assertEquals(over.reads(), 0);
});
