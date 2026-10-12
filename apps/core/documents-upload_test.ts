// `/v1/documents/upload`(coding-agent#T14): 제출 파일의 바이트가 실제 core와 I/O worker를
// 지나 준비된 blob 참조가 되는지 본다. coding agent client가 realpath로 검사한 파일을
// HTTP body stream으로 보내고, core는 해석 없이 blob 준비 중계로 흘려 보낸다. 데이터
// root는 temp dir다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import {
  manualClock,
  seededRandom,
  sha256Hex,
} from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/platform/mod.ts";
import {
  createCoreClient,
} from "../../packages/coding-agent/connection/client/core.ts";
import {
  resolveSubmission,
  uploadPrepareBytes,
} from "../../packages/coding-agent/connection/mod.ts";
import { type Core, startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

const teams: TeamModule[] = [{ createLedgerRegistration }];
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const TOKEN = "u".repeat(43);
const PRINCIPAL = `coding_agent:${CAC}`;

type Opened = {
  core: Core;
  home: string;
  work: string;
  dispose(): Promise<void>;
};

async function open(
  options: { superviseIo?: boolean; operations?: string[] } = {},
): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-upload-" });
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-upload-work-" }),
  );
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [new URL("./documents.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(11),
    testCredentials: true,
    superviseIo: options.superviseIo ?? true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
    await Deno.remove(home, { recursive: true });
    await Deno.remove(work, { recursive: true });
  });
  const context: AuthenticatedContext = {
    principal: PRINCIPAL,
    actor: `coding_agent:${CAC}`,
    scope: {
      operations: options.operations ?? ["document.upload"],
      targets: {},
    },
    conditions: {},
    credential_ref: "cred-upload",
  };
  const accepted = await started.value.acceptTestCredential?.(context, TOKEN);
  assert(accepted?.ok);
  const recorded = await started.value.record(context);
  assert(recorded.ok);
  guard.keep();
  return {
    core: started.value,
    home,
    work,
    async dispose() {
      await started.value.shutdown();
      await Deno.remove(home, { recursive: true });
      await Deno.remove(work, { recursive: true });
    },
  };
}

function client(opened: Opened) {
  return createCoreClient({
    baseUrl: `http://127.0.0.1:${opened.core.port}`,
    connection: CAC,
    provider: () => Promise.resolve({ ok: true, value: { token: TOKEN } }),
  });
}

async function blobFiles(home: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string) {
    try {
      for await (const entry of Deno.readDir(dir)) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory) await walk(path);
        else found.push(path);
      }
    } catch { /* blob 폴더가 아직 없다 */ }
  }
  await walk(`${home}/blobs/sha256`);
  return found;
}

Deno.test("coding-agent/mcp-server#R13 coding-agent/connection#R10: 검사한 파일의 바이트가 실제 core와 I/O worker를 지나 요청 credential 주체의 준비 참조가 된다", async () => {
  const opened = await open();
  try {
    const text = "# 제출한 문서\n본문\n".repeat(1000);
    await Deno.writeTextFile(`${opened.work}/plan.md`, text);
    const submitted = await resolveSubmission([`${opened.work}/plan.md`], {
      root: opened.work,
      forbidden: [opened.home],
    });
    assert(submitted.ok);
    const file = submitted.value[0];
    const prepared = await uploadPrepareBytes(client(opened))(file);
    assert(prepared.ok, prepared.ok ? "" : prepared.error.message);
    const blob = prepared.value;
    assertEquals(blob.hash, await sha256Hex(text));
    assertEquals(blob.size_bytes, new TextEncoder().encode(text).length);
    assertEquals(blob.purpose, "document_file");
    // 준비 주체는 요청 credential이다. 호출자가 주장한 값이 아니다.
    assertEquals(blob.principal, PRINCIPAL);
    assert(blob.preparation.length > 0);
    // I/O worker가 같은 바이트를 설치했다.
    const stored = await blobFiles(opened.home);
    assertEquals(stored.length, 1);
    assertEquals(await Deno.readTextFile(stored[0]), text);
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R13: 선언한 hash나 크기와 다른 바이트는 blob을 만들지 않고 거절된다", async () => {
  const opened = await open();
  try {
    await Deno.writeTextFile(`${opened.work}/plan.md`, "원본");
    const submitted = await resolveSubmission([`${opened.work}/plan.md`], {
      root: opened.work,
      forbidden: [],
    });
    assert(submitted.ok);
    const file = submitted.value[0];
    const core = client(opened);
    const { documentUpload } = await import(
      "../../packages/protocol/projects/mod.ts"
    );
    // 읽은 뒤 파일이 바뀐 것과 같다: hash는 옛 바이트, body는 새 바이트(같은 길이).
    const changed = await core.upload(
      documentUpload,
      { blob_hash: file.blob_hash, bytes: file.bytes },
      new Blob([new Uint8Array(file.bytes).fill(65)]).stream(),
    );
    assert(!changed.ok);
    // 입력 크기와 body 길이가 다르면 바이트를 읽지 않는다.
    const sized = await core.upload(
      documentUpload,
      { blob_hash: file.blob_hash, bytes: file.bytes + 1 },
      file.open(),
    );
    assert(!sized.ok);
    assertEquals(sized.error.code, "invalid_input");
    assertEquals(await blobFiles(opened.home), []);
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/connection#R10: upload scope가 없는 credential은 바이트를 보내도 blob이 생기지 않는다", async () => {
  const opened = await open({ operations: ["document.list"] });
  try {
    await Deno.writeTextFile(`${opened.work}/plan.md`, "내용");
    const submitted = await resolveSubmission([`${opened.work}/plan.md`], {
      root: opened.work,
      forbidden: [],
    });
    assert(submitted.ok);
    const prepared = await uploadPrepareBytes(client(opened))(
      submitted.value[0],
    );
    assert(!prepared.ok);
    assertEquals(prepared.error.code, "forbidden");
    assertEquals(await blobFiles(opened.home), []);
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R13: I/O worker가 없으면 upload는 unavailable이고 성공으로 꾸미지 않는다", async () => {
  const opened = await open({ superviseIo: false });
  try {
    await Deno.writeTextFile(`${opened.work}/plan.md`, "내용");
    const submitted = await resolveSubmission([`${opened.work}/plan.md`], {
      root: opened.work,
      forbidden: [],
    });
    assert(submitted.ok);
    const prepared = await uploadPrepareBytes(client(opened))(
      submitted.value[0],
    );
    assert(!prepared.ok);
    assertEquals(prepared.error.code, "unavailable");
  } finally {
    await opened.dispose();
  }
});
