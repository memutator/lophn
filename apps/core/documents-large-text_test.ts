// documents/versions#R1·R8, documents/formats#R3·R4·R5, documents/file-tracking#R3·R4: 큰
// 텍스트 문서가 실제 core, documents worker(format 검사·관측), I/O worker(blob 준비)를 지나
// 저장되고 원문 그대로 읽힌다. 한도는 셋이다: upload 상한(256 MiB), format 검사가 읽는
// 대표 파일 상한(1 MiB), 읽기 stream(upload 상한까지). 검사 한도를 넘는 문서는 명시 format이
// 아니면 검사 생략 warning으로 저장되고, 명시 format이면 거절된다. 데이터 root와 폴더는 모두
// temp dir다. 사람 데이터 root(~/.lophn, ~/.config/lophn)는 열지 않는다.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import {
  DOCUMENT_UPLOAD_MAX_BYTES,
  FORMAT_CHECK_CONTENT_MAX_BYTES,
  formatList,
} from "../../packages/contracts/documents/mod.ts";
import {
  type AuthenticatedContext,
  UPLOAD_INPUT_HEADER,
} from "../../packages/contracts/platform/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import {
  saveFromPaths,
  uploadPrepareBytes,
} from "../../packages/coding-agent/connection/mod.ts";
import { createFormatTool } from "../../packages/coding-agent/mcp-server/tools/format.ts";
import { resolveRoute } from "../../packages/coding-agent/mcp-server/registry.ts";
import { previewTracking } from "../../packages/documents/projects/work.ts";
import { directoryScanner } from "../../packages/documents/projects/scan.ts";
import { type Core, startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";
import { lophnAgentDefinitions } from "./lophn-agent.ts";

const MIB = 1024 * 1024;
const teams: TeamModule[] = [
  { lophnAgentDefinitions },
  { createLedgerRegistration },
];
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const AGENT_TOKEN = "a".repeat(43);
const USER_TOKEN = "c".repeat(43);
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const TRACKED = "prj_01kq12a1pha000000000000000";

// 줄마다 내용이 달라 밀리거나 건너뛴 구간이 hash에 드러나는 ASCII 텍스트.
function textOfSize(size: number): Uint8Array {
  const out = new Uint8Array(size);
  const encoder = new TextEncoder();
  let at = 0;
  for (let line = 0; at < size; line++) {
    const bytes = encoder.encode(
      `line ${line} ${(line * 2654435761 >>> 0).toString(36)} the quick fox\n`,
    );
    const take = Math.min(bytes.length, size - at);
    out.set(bytes.subarray(0, take), at);
    at += take;
  }
  return out;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function digestOf(
  response: Response,
): Promise<{ hash: string; length: number }> {
  const digest = createHash("sha256");
  let length = 0;
  for await (const chunk of response.body!) {
    digest.update(chunk);
    length += chunk.length;
  }
  return { hash: digest.digest("hex"), length };
}

// ---- upload 경로: 코딩 에이전트가 저장 ----

type Opened = {
  core: Core;
  home: string;
  work: string;
  dispose(): Promise<void>;
};

async function openUpload(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-large-text-" });
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-large-text-work-" }),
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
    random: seededRandom(31),
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
          "document.history",
          "document.file",
          "format.list",
          "format.get",
          "format.validate",
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

function agent(opened: Opened) {
  const client = createCoreClient({
    baseUrl: `http://127.0.0.1:${opened.core.port}`,
    connection: CAC,
    provider: () =>
      Promise.resolve({ ok: true, value: { token: AGENT_TOKEN } }),
  });
  return {
    client,
    deps: {
      client,
      scope: { root: opened.work, forbidden: [opened.home] },
      prepareBytes: uploadPrepareBytes(client),
    },
  };
}

function postJson(
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

async function writeText(
  opened: Opened,
  name: string,
  size: number,
): Promise<Uint8Array> {
  const bytes = textOfSize(size);
  await Deno.writeFile(`${opened.work}/${name}`, bytes);
  return bytes;
}

for (const size of [2 * MIB, 32 * MIB]) {
  Deno.test(
    `documents/versions#R1 #R8, documents/formats#R5: ${
      size / MIB
    } MiB 텍스트 문서는 upload 경로로 저장되고 검사 생략 warning과 함께 원문 그대로 읽힌다`,
    async () => {
      const opened = await openUpload();
      try {
        const bytes = await writeText(opened, "big.txt", size);
        const { deps } = agent(opened);
        const saved = await saveFromPaths(deps, {
          paths: ["big.txt"],
          place: { kind: "project" as const, id: PROJECT },
          slug: "big",
        });
        assert(saved.ok, saved.ok ? "" : JSON.stringify(saved.error));
        assertEquals(saved.value.saved.status, "saved");
        // 검사를 하지 못한 사실이 한도와 함께 warning으로 남는다. 통과로 꾸미지 않았다.
        const warnings = saved.value.saved.warnings as {
          severity: string;
          code: string;
          message: string;
        }[];
        assertEquals(warnings.length, 1);
        assertEquals(warnings[0].severity, "warning");
        assertEquals(warnings[0].code, "check_skipped");
        assert(
          warnings[0].message.includes(String(FORMAT_CHECK_CONTENT_MAX_BYTES)),
        );
        assert(warnings[0].message.includes(String(size)));
        const response = await postJson(opened.core, "documents/file", {
          version: saved.value.saved.version,
          path: "big.txt",
        }, AGENT_TOKEN);
        assertEquals(response.status, 200);
        assertEquals(response.headers.get("content-type"), "text/plain");
        assertEquals(response.headers.get("content-length"), String(size));
        assertEquals(await digestOf(response), {
          hash: sha256(bytes),
          length: size,
        });
      } finally {
        await opened.dispose();
      }
    },
  );
}

Deno.test("documents/formats#R4 #R5: 검사 한도 정확히까지의 대표 파일은 실제 format 검사를 거치고 1 바이트 넘으면 검사 생략 warning이다", async () => {
  const opened = await openUpload();
  try {
    const { deps } = agent(opened);
    const place = { kind: "project" as const, id: PROJECT };
    await writeText(opened, "exact.txt", FORMAT_CHECK_CONTENT_MAX_BYTES);
    const exact = await saveFromPaths(deps, {
      paths: ["exact.txt"],
      place,
      slug: "exact",
    });
    assert(exact.ok, exact.ok ? "" : JSON.stringify(exact.error));
    assertEquals(exact.value.saved.warnings, []);
    await writeText(opened, "over.txt", FORMAT_CHECK_CONTENT_MAX_BYTES + 1);
    const over = await saveFromPaths(deps, {
      paths: ["over.txt"],
      place,
      slug: "over",
    });
    assert(over.ok, over.ok ? "" : JSON.stringify(over.error));
    assertEquals(
      (over.value.saved.warnings as { code: string }[]).map((w) => w.code),
      ["check_skipped"],
    );
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/formats#R3: 검사가 바이트를 읽지 않는 큰 파일과 큰 첨부는 한도 없이 저장되고 읽힌다", async () => {
  const opened = await openUpload();
  try {
    const { deps } = agent(opened);
    const place = { kind: "project" as const, id: PROJECT };
    // 5 MiB 이미지(data·image format)와, 작은 HTML에 붙은 5 MiB 첨부.
    const image = await writeText(opened, "photo.png", 5 * MIB);
    const html = await writeText(opened, "index.html", 2000);
    const attachment = await writeText(opened, "extra.bin", 5 * MIB);
    const savedImage = await saveFromPaths(deps, {
      paths: ["photo.png"],
      place,
      slug: "photo",
    });
    assert(
      savedImage.ok,
      savedImage.ok ? "" : JSON.stringify(savedImage.error),
    );
    assertEquals(savedImage.value.saved.warnings, []);
    const savedHtml = await saveFromPaths(deps, {
      paths: ["index.html", "extra.bin"],
      place,
      slug: "page",
    });
    assert(savedHtml.ok, savedHtml.ok ? "" : JSON.stringify(savedHtml.error));
    assertEquals(savedHtml.value.saved.warnings, []);
    const read = async (version: string, path: string) => {
      const response = await postJson(
        opened.core,
        "documents/file",
        { version, path },
        AGENT_TOKEN,
      );
      assertEquals(response.status, 200);
      return await digestOf(response);
    };
    assertEquals(await read(savedImage.value.saved.version, "photo.png"), {
      hash: sha256(image),
      length: image.length,
    });
    assertEquals(await read(savedHtml.value.saved.version, "extra.bin"), {
      hash: sha256(attachment),
      length: attachment.length,
    });
    assertEquals(await read(savedHtml.value.saved.version, "index.html"), {
      hash: sha256(html),
      length: html.length,
    });
  } finally {
    await opened.dispose();
  }
});

Deno.test("documents/formats#R4: 명시한 document format은 검사 한도를 넘는 대표 파일을 invalid_input으로 거절하고 사전 검사는 한도를 밝힌다", async () => {
  const opened = await openUpload();
  try {
    const { client, deps } = agent(opened);
    const formats = await client.read(formatList, {});
    assert(formats.ok);
    const document = (formats.value as {
      formats: { name: string; module_hash: string }[];
    }).formats.find((format) => format.name === "document");
    assert(document);
    await writeText(opened, "big.md", 2 * MIB);
    const refused = await saveFromPaths(deps, {
      paths: ["big.md"],
      place: { kind: "project" as const, id: PROJECT },
      slug: "big",
      format: {
        name: "document",
        module_hash: document.module_hash,
        explicit: true,
      },
    });
    assert(!refused.ok);
    assertEquals(refused.error.code, "invalid_input");
    // 무저장: 문서가 생기지 않았다.
    const listed = await postJson(
      opened.core,
      "documents/list",
      {},
      AGENT_TOKEN,
    );
    assertEquals(
      ((await listed.json()) as { documents: unknown[] }).documents.length,
      0,
    );
    // 사전 검사는 같은 입력의 거절 이유로 한도를 밝힌 error 진단을 낸다.
    const route = resolveRoute("lophn_format", "validate")!.route;
    const validated = await createFormatTool(deps)("lophn_format", route, {
      op: "validate",
      name: "document",
      module_hash: document.module_hash,
      paths: ["big.md"],
    });
    assertEquals(validated.isError, undefined, validated.summary);
    const page = validated.data as {
      status: string;
      diagnostics: { severity: string; code: string; message: string }[];
    };
    assertEquals(page.status, "failed");
    assertEquals(page.diagnostics[0].severity, "error");
    assertEquals(page.diagnostics[0].code, "check_skipped");
    assert(
      page.diagnostics[0].message.includes(
        String(FORMAT_CHECK_CONTENT_MAX_BYTES),
      ),
    );
  } finally {
    await opened.dispose();
  }
});

Deno.test("platform/api#R4: upload 상한(256 MiB)을 넘는 Content-Length는 본문을 읽기 전에 한도를 밝힌 invalid_input이다", async () => {
  const opened = await openUpload();
  try {
    const input = btoa(JSON.stringify({ blob_hash: "ab".repeat(32), bytes: 1 }))
      .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    const connection = await Deno.connect({
      hostname: "127.0.0.1",
      port: opened.core.port,
    });
    try {
      await connection.write(
        new TextEncoder().encode(
          [
            "POST /v1/documents/upload HTTP/1.1",
            `Host: 127.0.0.1:${opened.core.port}`,
            `Authorization: Bearer ${AGENT_TOKEN}`,
            "Content-Type: application/octet-stream",
            `${UPLOAD_INPUT_HEADER}: ${input}`,
            `Content-Length: ${DOCUMENT_UPLOAD_MAX_BYTES + 1}`,
            "Connection: close",
            "",
            "",
          ].join("\r\n"),
        ),
      );
      // 서버는 선언한 본문을 기다리며 연결을 닫지 않을 수 있다. 응답의 Content-Length만큼
      // 읽으면 끝낸다.
      let text = "";
      const decoder = new TextDecoder();
      const buffer = new Uint8Array(4096);
      for (;;) {
        const read = await connection.read(buffer);
        if (read === null) break;
        text += decoder.decode(buffer.subarray(0, read), { stream: true });
        const split = text.indexOf("\r\n\r\n");
        if (split < 0) continue;
        const length = /content-length: *(\d+)/i.exec(text.slice(0, split));
        if (length && text.length - split - 4 >= Number(length[1])) break;
      }
      assert(text.startsWith("HTTP/1.1 400"), text);
      const body = JSON.parse(text.slice(text.indexOf("\r\n\r\n") + 4)) as {
        error: { code: string; message: string };
      };
      assertEquals(body.error.code, "invalid_input");
      assert(
        body.error.message.includes(String(DOCUMENT_UPLOAD_MAX_BYTES)),
        text,
      );
    } finally {
      connection.close();
    }
  } finally {
    await opened.dispose();
  }
});

// ---- 관측 경로: 추적 폴더의 파일 ----

type Json = Record<string, unknown>;

function ledger<T>(home: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    return run(db);
  } finally {
    db.close();
  }
}

async function until<T>(
  what: string,
  read: () => T | undefined,
  timeoutMs = 120_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = read();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out: ${what}`);
}

for (const size of [2 * MIB, 32 * MIB]) {
  Deno.test(
    `documents/file-tracking#R4 documents/versions#R8: 추적 폴더의 ${
      size / MIB
    } MiB 텍스트 파일은 관측 경로로 새 Version이 되고 원문 그대로 읽힌다`,
    async () => {
      const home = await Deno.makeTempDir({ prefix: "lophn-large-observe-" });
      const folder = await Deno.realPath(
        await Deno.makeTempDir({ prefix: "lophn-large-observe-folder-" }),
      );
      const bytes = textOfSize(size);
      await Deno.writeFile(`${folder}/big.md`, bytes);
      const started = await startCore({
        lophnHome: home,
        port: 0,
        teams,
        teamModules: [new URL("./documents.ts", import.meta.url).href],
        clock: manualClock(Date.UTC(2024, 0, 1)),
        random: seededRandom(37),
        testCredentials: true,
      });
      assert(started.ok, started.ok ? "" : started.error.message);
      const core = started.value;
      try {
        const context: AuthenticatedContext = {
          principal: "user",
          actor: "user",
          credential_ref: "cred_observe_large",
          scope: {
            operations: [
              "project.create",
              "project.set_tracking",
              "document.file",
            ],
            targets: {},
          },
          conditions: {},
        };
        assert(core.acceptTestCredential);
        const accepted = await core.acceptTestCredential(context, USER_TOKEN);
        assert(accepted.ok);
        assert((await core.record(context)).ok);
        const created = await postJson(core, "projects/create", {
          input: {
            id: TRACKED,
            name: "alpha",
            title: "Alpha",
            purpose: "",
            folders: [{ path: folder, description: "a" }],
            tracking: { enabled: false, patterns: [], use_gitignore: false },
          },
          idempotency_key: "create-alpha",
          compare: {},
          prepared: [],
        }, USER_TOKEN);
        const createdBody = await created.json() as Json;
        assertEquals(created.status, 200, JSON.stringify(createdBody));
        const folders = [{ path: folder, description: "a" }];
        const tracking = {
          enabled: true,
          patterns: [{ effect: "include" as const, glob: "**/*.md" }],
          use_gitignore: false,
        };
        const preview = previewTracking(directoryScanner(), {
          project: TRACKED,
          baseRevision: String(createdBody["revision"]),
          folders,
          tracking,
          observedAt: "2026-10-06T00:00:00.000Z",
        });
        assert(preview.ok);
        const applied = await postJson(core, "projects/set_tracking", {
          input: {
            project: TRACKED,
            folders,
            tracking,
            preview: preview.value,
          },
          idempotency_key: "track-alpha",
          compare: { base_revision: String(createdBody["revision"]) },
          prepared: [],
        }, USER_TOKEN);
        assertEquals(applied.status, 200, JSON.stringify(await applied.json()));
        const version = await until("version 1", () => {
          const row = ledger(
            home,
            (db) =>
              db.prepare("SELECT id FROM versions ORDER BY number").get() as
                | { id: string }
                | undefined,
          );
          return row?.id;
        });
        const files = ledger(
          home,
          (db) =>
            db.prepare(
              "SELECT path, bytes FROM version_files WHERE version = ?",
            )
              .all(version) as unknown as { path: string; bytes: number }[],
        );
        assertEquals(files, [{ path: "big.md", bytes: size }]);
        const response = await postJson(core, "documents/file", {
          version,
          path: "big.md",
        }, USER_TOKEN);
        assertEquals(response.status, 200);
        assertEquals(response.headers.get("content-type"), "text/markdown");
        assertEquals(await digestOf(response), {
          hash: sha256(bytes),
          length: size,
        });
      } finally {
        await core.shutdown();
        await Deno.remove(home, { recursive: true });
        await Deno.remove(folder, { recursive: true });
      }
    },
  );
}
